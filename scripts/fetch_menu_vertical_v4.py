import re
from difflib import SequenceMatcher

import cv2
import pytesseract

import fetch_menu_vertical_v3 as v3


def levenshtein(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(cur[-1] + 1, prev[j] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def improved_fuzzy(text, confidence=100.0):
    ranked = []
    for term in v3.COMMON:
        dist = levenshtein(text, term)
        ranked.append((dist, abs(len(text) - len(term)), -SequenceMatcher(None, text, term).ratio(), term))
    ranked.sort()
    if not ranked:
        return text, None

    dist, len_diff, neg_ratio, term = ranked[0]
    ratio = -neg_ratio
    apply = False

    # One-character OCR mistakes are very common and safe to normalize against a cafeteria lexicon.
    if dist == 1 and len(text) >= 4:
        apply = True
    # Two-character errors are accepted only on longer dish names.
    elif dist == 2 and len(text) >= 6 and len_diff <= 1:
        apply = True
    # For a low-confidence row, allow a three-character recovery only when the best term has
    # exactly the same length and still shares a substantial ordered character pattern.
    elif dist == 3 and confidence < 60 and len_diff == 0 and ratio >= 0.48:
        apply = True

    if apply:
        return term, {"from": text, "to": term, "distance": dist, "ratio": round(ratio, 3)}
    return text, None


def improved_choose(cands):
    unique = {}
    for cand in cands:
        cand = dict(cand)
        text, correction = improved_fuzzy(cand["text"], float(cand.get("confidence", 0)))
        cand["text"] = text
        cand["correction"] = correction
        key = text.replace(" ", "")
        old = unique.get(key)
        if old is None or cand["confidence"] > old["confidence"]:
            unique[key] = cand

    cands = list(unique.values())
    if not cands:
        return None

    for cand in cands:
        hangul = len(re.findall(r"[가-힣]", cand["text"]))
        weird = len(re.findall(r"[A-Za-z0-9\[\]{}<>]", cand["text"]))
        score = float(cand["confidence"]) + hangul * 5 - weird * 7
        if cand.get("correction"):
            dist = cand["correction"]["distance"]
            score += {1: 25, 2: 16, 3: 8}.get(dist, 0)
        if cand["text"] in v3.COMMON:
            score += 8
        for other in cands:
            if other is cand:
                continue
            r = SequenceMatcher(None, cand["text"], other["text"]).ratio()
            if r >= 0.90:
                score += 16
            elif r >= 0.75:
                score += 8
        cand["score"] = score

    cands.sort(key=lambda x: x["score"], reverse=True)
    best = cands[0]
    return {
        "text": best["text"],
        "confidence": round(float(best["confidence"]), 1),
        "score": round(float(best["score"]), 1),
        "engine": best["engine"],
        "alternatives": [x["text"] for x in cands[1:5] if x["text"] != best["text"]],
        "correction": best.get("correction"),
    }


def improved_extract_date(image):
    h = image.shape[0]
    crops = [image[:max(150, int(h * 0.35)), :], image]
    for crop in crops:
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, None, fx=2.5, fy=2.5, interpolation=cv2.INTER_CUBIC)
        clahe = cv2.createCLAHE(clipLimit=2.4, tileGridSize=(8, 8)).apply(gray)
        _, otsu = cv2.threshold(clahe, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        adaptive = cv2.adaptiveThreshold(
            clahe, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 41, 11
        )
        for img in (clahe, otsu, adaptive):
            for psm in (4, 6, 11, 12):
                text = pytesseract.image_to_string(img, lang="kor+eng", config=f"--oem 1 --psm {psm}")
                m = v3.DATE_RE.search(text)
                if m:
                    try:
                        return v3.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
                    except ValueError:
                        pass
    return None


# Patch v3 pipeline with stronger correction/date recovery while preserving the tested
# column ordering and coordinate-based row detection.
v3.choose = improved_choose
v3.extract_date = improved_extract_date


if __name__ == "__main__":
    raise SystemExit(v3.main())
