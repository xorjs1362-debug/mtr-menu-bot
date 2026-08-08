import json
import re
import sys
from datetime import date, datetime
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import quote
from zoneinfo import ZoneInfo

import cv2
import easyocr
import numpy as np
import pytesseract
import requests
from pytesseract import Output

CHANNEL_ID = "_QpxgJn"
CHANNEL_URL = f"https://pf.kakao.com/{CHANNEL_ID}"
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUT_JSON = ROOT / "latest_menu.json"
OUT_TXT = ROOT / "latest_menu.txt"
IMAGE_FILE = DATA_DIR / "latest_menu.png"
MODEL_DIR = ROOT / ".easyocr-models"
TZ = ZoneInfo("Asia/Seoul")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
HEADERS = {"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8"}
POST_RE = re.compile(rf"(?:https?://pf\.kakao\.com)?/{re.escape(CHANNEL_ID)}/(\d+)")
DATE_RE = re.compile(r"(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일")

# Only high-confidence, common OCR confusions are normalized here.
DIRECT_REPLACEMENTS = {
    "고주장": "고추장",
    "포기김지": "포기김치",
    "콩나물무짐": "콩나물무침",
    "미스커피": "믹스커피",
    "오덩": "오뎅",
    "스테이ㅋ": "스테이크",
}

COMMON_MENU_TERMS = [
    "김치제육볶음", "제육볶음", "함박스테이크", "오뎅떡볶이", "어묵떡볶이",
    "떡볶이", "콩나물무침", "고추장멸치볶음", "멸치볶음", "쌈상추겉절이",
    "상추겉절이", "부추겉절이", "포기김치", "배추김치", "깍두기", "유부된장국",
    "된장국", "미역국", "북어국", "육개장", "열무국수", "잔치국수", "비빔국수",
    "샐러드", "라면", "계란후라이", "계란후라이", "원두커피", "믹스커피", "매실차", "식혜",
    "잡채", "김치찌개", "된장찌개", "순두부찌개", "카레", "짜장", "돈까스", "생선까스",
    "닭볶음탕", "소불고기", "돼지불고기", "오징어볶음", "감자조림", "두부조림",
    "시금치나물", "숙주나물", "무생채", "도라지무침", "오이무침", "계란찜",
]


def now_kst():
    return datetime.now(TZ)


def candidate_ids(value, path=()):
    found = set()
    if isinstance(value, dict):
        for k, v in value.items():
            key = str(k).lower()
            new_path = path + (key,)
            context = "/".join(new_path)
            if isinstance(v, int) or (isinstance(v, str) and v.isdigit()):
                n = int(v)
                if 1_000_000 < n < 1_000_000_000:
                    if key in {"postid", "post_id", "articleid", "article_id", "contentid", "content_id"}:
                        found.add(n)
                    elif key == "id" and any(x in context for x in ("post", "feed", "article", "content")):
                        found.add(n)
            found |= candidate_ids(v, new_path)
    elif isinstance(value, list):
        for item in value:
            found |= candidate_ids(item, path + ("[]",))
    elif isinstance(value, str):
        for m in POST_RE.finditer(value):
            found.add(int(m.group(1)))
    return found


def discover_latest_post():
    endpoints = [
        f"https://pf.kakao.com/rocket-web/web/profiles/{CHANNEL_ID}/posts",
        f"https://pf.kakao.com/rocket-web/web/profiles/{CHANNEL_ID}/posts/recent",
        f"https://pf.kakao.com/rocket-web/web/v2/profiles/{CHANNEL_ID}/posts",
        f"https://pf.kakao.com/rocket-web/web/v2/profiles/{CHANNEL_ID}/posts/recent",
    ]
    errors = []
    for url in endpoints:
        try:
            params = {"size": 20} if url.endswith("/recent") else {"includePinnedPost": "true"}
            r = requests.get(url, params=params, headers=HEADERS, timeout=30)
            print(f"FEED {r.url} status={r.status_code}")
            if r.status_code != 200:
                errors.append(f"{url}: HTTP {r.status_code}")
                continue
            payload = r.json()
            ids = candidate_ids(payload)
            ids |= {int(x) for x in re.findall(rf"/{re.escape(CHANNEL_ID)}/(\d+)", r.text)}
            print("candidate_ids=" + repr(sorted(ids, reverse=True)[:10]))
            if ids:
                post_id = max(ids)
                return f"{CHANNEL_URL}/{post_id}", url
        except Exception as e:
            errors.append(f"{url}: {type(e).__name__}: {e}")
    raise RuntimeError("No post id from Kakao feed APIs | " + " | ".join(errors))


def download_image(post_url):
    errors = []
    try:
        r = requests.get("https://api.microlink.io/", params={"url": post_url, "force": "true"}, headers=HEADERS, timeout=75)
        r.raise_for_status()
        image_url = ((r.json().get("data") or {}).get("image") or {}).get("url")
        if image_url:
            ir = requests.get(image_url, headers=HEADERS, timeout=60, allow_redirects=True)
            ir.raise_for_status()
            if "image" in ir.headers.get("content-type", "") or len(ir.content) > 10_000:
                IMAGE_FILE.write_bytes(ir.content)
                return image_url, "microlink_metadata"
        errors.append("metadata image missing")
    except Exception as e:
        errors.append(f"metadata: {type(e).__name__}: {e}")

    try:
        embed = f"https://api.microlink.io/?url={quote(post_url, safe='')}&force=true&embed=image.url"
        er = requests.get(embed, headers=HEADERS, timeout=90, allow_redirects=True)
        er.raise_for_status()
        if "image" in er.headers.get("content-type", "") or len(er.content) > 10_000:
            IMAGE_FILE.write_bytes(er.content)
            return er.url, "microlink_embed"
        errors.append("embed response was not an image")
    except Exception as e:
        errors.append(f"embed: {type(e).__name__}: {e}")
    raise RuntimeError(" | ".join(errors))


def normalize_text(text):
    text = str(text).replace("＊", " ").replace("•", " ").replace("·", " ")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"^[^가-힣A-Za-z0-9]+", "", text)
    text = re.sub(r"[^가-힣A-Za-z0-9]+$", "", text)
    # OCR often inserts spaces between every Hangul syllable. Menu items are easier to compare without them.
    prev = None
    while prev != text:
        prev = text
        text = re.sub(r"(?<=[가-힣])\s+(?=[가-힣])", "", text)
    for bad, good in DIRECT_REPLACEMENTS.items():
        text = text.replace(bad, good)
    text = re.sub(r"볶은$", "볶음", text)
    text = re.sub(r"멸치(?:복|북|볶)$", "멸치볶음", text)
    return text.strip()


def has_menu_text(text):
    if not text or len(text) < 2:
        return False
    if DATE_RE.search(text):
        return False
    if any(x in text for x in ["카카오톡채널", "스마트시티퀀텀", "오늘의구내식당"]):
        return False
    return len(re.findall(r"[가-힣]", text)) >= 1


def fuzzy_common_term(text):
    # Only correct when the OCR string is already very close to a known cafeteria term.
    if not text or len(text) < 3:
        return text, None
    best = None
    best_ratio = 0.0
    for term in COMMON_MENU_TERMS:
        ratio = SequenceMatcher(None, text, term).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best = term
    if best and best_ratio >= 0.88 and abs(len(best) - len(text)) <= 2:
        return best, {"from": text, "to": best, "ratio": round(best_ratio, 3)}
    return text, None


def extract_date(image):
    h = image.shape[0]
    top = image[: max(130, int(h * 0.30)), :]
    gray = cv2.cvtColor(top, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=2.5, fy=2.5, interpolation=cv2.INTER_CUBIC)
    gray = cv2.createCLAHE(2.0, (8, 8)).apply(gray)
    for psm in (6, 11, 12):
        text = pytesseract.image_to_string(gray, lang="kor+eng", config=f"--oem 1 --psm {psm}")
        m = DATE_RE.search(text)
        if m:
            try:
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                pass
    return None


def split_columns(image):
    h, w = image.shape[:2]
    # The restaurant menu template is a two-column layout. Search only very close to the true center
    # so interior whitespace inside a menu name can never be mistaken for the column divider.
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    roi = gray[int(h * 0.15):int(h * 0.95), :]
    ink = (roi < 190).astype(np.float32).mean(axis=0)
    smooth = np.convolve(ink, np.ones(17) / 17.0, mode="same")
    lo, hi = int(w * 0.47), int(w * 0.53)
    candidate = int(lo + np.argmin(smooth[lo:hi]))
    if abs(candidate - w / 2) > w * 0.03:
        candidate = w // 2
    split = candidate
    y0, y1 = int(h * 0.13), int(h * 0.965)
    outer = int(w * 0.025)
    gap = max(6, int(w * 0.008))
    left = image[y0:y1, outer:split-gap]
    right = image[y0:y1, split+gap:w-outer]
    return split, left, right


def detect_text_bands(column):
    gray = cv2.cvtColor(column, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    # Light opening removes isolated image noise while keeping glyph strokes.
    bw = cv2.morphologyEx(bw, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    density = (bw > 0).mean(axis=1)
    density = np.convolve(density, np.ones(5) / 5.0, mode="same")
    positive = density[density > 0]
    dynamic = float(np.percentile(positive, 35)) if len(positive) else 0.0
    threshold = max(0.008, dynamic * 0.55)
    active = density > threshold

    bands = []
    start = None
    for y, on in enumerate(active):
        if on and start is None:
            start = y
        elif not on and start is not None:
            bands.append([start, y - 1])
            start = None
    if start is not None:
        bands.append([start, len(active) - 1])

    # Merge components belonging to the same printed line.
    merged = []
    for band in bands:
        if not merged or band[0] - merged[-1][1] > 11:
            merged.append(band)
        else:
            merged[-1][1] = band[1]

    h, w = column.shape[:2]
    out = []
    for y0, y1 in merged:
        height = y1 - y0 + 1
        if height < 8 or height > int(h * 0.13):
            continue
        pad = max(7, int(height * 0.55))
        a, b = max(0, y0 - pad), min(h, y1 + pad + 1)
        band_img = column[a:b, :]
        band_gray = cv2.cvtColor(band_img, cv2.COLOR_BGR2GRAY)
        ink_ratio = float((band_gray < 205).mean())
        if ink_ratio < 0.005:
            continue
        out.append({"y0": a, "y1": b, "center": (a + b) / 2.0 / h, "image": band_img})

    # Remove accidental duplicates produced by overlapping bands.
    deduped = []
    for band in out:
        if deduped and abs(band["center"] - deduped[-1]["center"]) < 0.035:
            prev_h = deduped[-1]["y1"] - deduped[-1]["y0"]
            this_h = band["y1"] - band["y0"]
            if this_h > prev_h:
                deduped[-1] = band
        else:
            deduped.append(band)
    return deduped


def tesseract_row_candidates(row_image):
    gray = cv2.cvtColor(row_image, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=4.0, fy=4.0, interpolation=cv2.INTER_CUBIC)
    clahe = cv2.createCLAHE(2.3, (8, 8)).apply(gray)
    blur = cv2.GaussianBlur(clahe, (0, 0), 1.0)
    sharp = cv2.addWeighted(clahe, 1.7, blur, -0.7, 0)
    _, otsu = cv2.threshold(sharp, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    adaptive = cv2.adaptiveThreshold(sharp, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 41, 11)
    variants = [("clahe", sharp), ("otsu", otsu), ("adaptive", adaptive)]
    out = []
    for variant_name, img in variants:
        for psm in (7, 13):
            data = pytesseract.image_to_data(
                img, lang="kor+eng", config=f"--oem 1 --psm {psm}", output_type=Output.DICT
            )
            words = []
            confs = []
            for text, conf in zip(data["text"], data["conf"]):
                text = str(text).strip()
                try:
                    c = float(conf)
                except Exception:
                    c = -1
                if text and c >= 0:
                    words.append(text)
                    confs.append(c)
            text = normalize_text(" ".join(words))
            if has_menu_text(text):
                out.append({
                    "text": text,
                    "confidence": sum(confs) / len(confs) if confs else 40.0,
                    "engine": f"tesseract-{variant_name}-psm{psm}",
                })
    return out


def easyocr_row_candidates(row_image, reader):
    out = []
    try:
        results = reader.readtext(
            row_image,
            detail=1,
            paragraph=False,
            decoder="beamsearch",
            beamWidth=10,
            mag_ratio=2.5,
            text_threshold=0.35,
            low_text=0.20,
            link_threshold=0.25,
            width_ths=1.0,
        )
        if results:
            results = sorted(results, key=lambda r: min(p[0] for p in r[0]))
            text = normalize_text(" ".join(str(r[1]) for r in results))
            conf = sum(float(r[2]) for r in results) / len(results) * 100.0
            if has_menu_text(text):
                out.append({"text": text, "confidence": conf, "engine": "easyocr"})
    except Exception as e:
        print(f"EasyOCR row failed: {type(e).__name__}: {e}")
    return out


def score_candidate(candidate, all_candidates):
    text = candidate["text"]
    hangul = len(re.findall(r"[가-힣]", text))
    weird = len(re.findall(r"[A-Za-z0-9\[\]{}<>|]", text))
    score = float(candidate["confidence"]) + hangul * 5.0 - weird * 7.0
    for other in all_candidates:
        if other is candidate:
            continue
        ratio = SequenceMatcher(None, text, other["text"]).ratio()
        if ratio >= 0.90:
            score += 16
        elif ratio >= 0.75:
            score += 8
    return score


def read_row(row_image, reader):
    candidates = tesseract_row_candidates(row_image) + easyocr_row_candidates(row_image, reader)
    unique = {}
    corrections = []
    for cand in candidates:
        text, correction = fuzzy_common_term(cand["text"])
        if correction:
            corrections.append(correction)
        cand = dict(cand)
        cand["text"] = text
        key = text.replace(" ", "")
        old = unique.get(key)
        if old is None or cand["confidence"] > old["confidence"]:
            unique[key] = cand
    candidates = list(unique.values())
    if not candidates:
        return None
    for cand in candidates:
        cand["score"] = score_candidate(cand, candidates)
    candidates.sort(key=lambda x: x["score"], reverse=True)
    best = candidates[0]
    alternatives = [x["text"] for x in candidates[1:5] if x["text"] != best["text"]]
    return {
        "text": best["text"],
        "confidence": round(float(best["confidence"]), 1),
        "score": round(float(best["score"]), 1),
        "engine": best["engine"],
        "alternatives": alternatives,
        "corrections": corrections[:3],
    }


def read_column(column, reader, name):
    bands = detect_text_bands(column)
    print(f"{name}_bands={len(bands)} centers={[round(b['center'],3) for b in bands]}")
    rows = []
    for band in bands:
        result = read_row(band["image"], reader)
        if not result or not has_menu_text(result["text"]):
            # Last attempt with a wider crop so a lightly printed menu line is not dropped.
            h = column.shape[0]
            c = int(band["center"] * h)
            half = max(30, int(h * 0.055))
            wider = column[max(0, c-half):min(h, c+half), :]
            result = read_row(wider, reader)
        if result and has_menu_text(result["text"]):
            result["y"] = round(float(band["center"]), 4)
            rows.append(result)
    rows.sort(key=lambda r: r["y"])

    # Deduplicate OCR repeats while preserving physical top-to-bottom order.
    final = []
    for row in rows:
        if final and SequenceMatcher(None, final[-1]["text"], row["text"]).ratio() > 0.88:
            if row["score"] > final[-1]["score"]:
                final[-1] = row
        else:
            final.append(row)
    return final


def suspicious(row):
    text = row["text"]
    if row["score"] < 75:
        return True
    if len(re.findall(r"[A-Za-z0-9\[\]{}<>]", text)) > 0:
        return True
    if len(re.findall(r"[가-힣]", text)) < 2:
        return True
    return False


def write_output(payload):
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"status: {payload['status']}",
        f"date: {payload.get('date') or ''}",
        f"checked_at: {payload['checked_at']}",
        f"post_url: {payload.get('post_url') or ''}",
        f"image_source: {payload.get('image_source') or ''}",
        f"column_split_x: {payload.get('column_split_x') or ''}",
        "",
        "MENU ORDER: LEFT TOP->BOTTOM, THEN RIGHT TOP->BOTTOM",
    ]
    for i, item in enumerate(payload.get("menu_items", []), 1):
        lines.append(f"{i}. {item}")
    for label, key in [("LEFT COLUMN", "left_column"), ("RIGHT COLUMN", "right_column")]:
        lines += ["", label + ":"]
        for row in payload.get(key, []):
            alt = " | alternatives: " + " / ".join(row.get("alternatives", [])[:3]) if row.get("alternatives") else ""
            lines.append(f"- {row['text']} [score={row['score']}, engine={row['engine']}]{alt}")
    if payload.get("uncertain_rows"):
        lines += ["", "UNCERTAIN ROWS:"]
        for row in payload["uncertain_rows"]:
            lines.append(json.dumps(row, ensure_ascii=False))
    if payload.get("error"):
        lines += ["", "ERROR:", payload["error"]]
    OUT_TXT.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    checked = now_kst()
    payload = {
        "status": "error", "date": None, "checked_at": checked.isoformat(timespec="seconds"),
        "post_url": None, "image_source": None, "image_method": None, "column_split_x": None,
        "left_column": [], "right_column": [], "menu_items": [], "uncertain_rows": [], "error": None,
    }
    try:
        post_url, discovery = discover_latest_post()
        payload["post_url"] = post_url
        payload["discovery"] = discovery
        image_source, image_method = download_image(post_url)
        payload["image_source"] = image_source
        payload["image_method"] = image_method
        image = cv2.imread(str(IMAGE_FILE), cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError("Downloaded image could not be decoded")

        menu_date = extract_date(image)
        payload["date"] = menu_date.isoformat() if menu_date else None
        split, left, right = split_columns(image)
        payload["column_split_x"] = split

        reader = easyocr.Reader(
            ["ko", "en"], gpu=False, verbose=False,
            model_storage_directory=str(MODEL_DIR), user_network_directory=str(MODEL_DIR),
        )
        left_rows = read_column(left, reader, "left")
        right_rows = read_column(right, reader, "right")
        payload["left_column"] = left_rows
        payload["right_column"] = right_rows
        payload["menu_items"] = [r["text"] for r in left_rows] + [r["text"] for r in right_rows]
        payload["uncertain_rows"] = [r for r in left_rows + right_rows if suspicious(r)]

        if menu_date is None or len(payload["menu_items"]) < 8:
            payload["status"] = "ocr_failed"
        elif menu_date != checked.date():
            payload["status"] = "stale"
        elif payload["uncertain_rows"]:
            payload["status"] = "review_needed"
        else:
            payload["status"] = "ready"
    except Exception as e:
        payload["error"] = f"{type(e).__name__}: {e}"
        print(payload["error"])

    write_output(payload)
    print(OUT_TXT.read_text(encoding="utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
