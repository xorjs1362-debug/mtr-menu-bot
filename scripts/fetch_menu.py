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
EASYOCR_MODEL_DIR = ROOT / ".easyocr-models"
TZ = ZoneInfo("Asia/Seoul")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
POST_RE = re.compile(rf"(?:https?://pf\.kakao\.com)?/{re.escape(CHANNEL_ID)}/(\d+)")
DATE_RE = re.compile(r"(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일")
HEADERS = {"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8"}


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
        r = requests.get(
            "https://api.microlink.io/",
            params={"url": post_url, "force": "true"},
            headers=HEADERS,
            timeout=75,
        )
        r.raise_for_status()
        data = r.json().get("data", {})
        image_url = (data.get("image") or {}).get("url")
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


def normalize_line(text):
    text = text.replace("＊", "*").replace("•", "*").replace("·", " ")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"^[\s*\-_=~|:;,.]+", "", text)
    text = re.sub(r"[\s*\-_=~|:;,.]+$", "", text)
    return text.strip()


def is_menu_text(text):
    if not text or len(text) < 2:
        return False
    if DATE_RE.search(text):
        return False
    if any(x in text for x in ["카카오톡채널", "오늘의 구내식당", "스마트시티퀀텀"]):
        return False
    return len(re.findall(r"[가-힣]", text)) >= 1


def text_quality(text, conf):
    hangul = len(re.findall(r"[가-힣]", text))
    weird = len(re.findall(r"[A-Za-z0-9\[\]{}<>\\|]", text))
    replacement = text.count("?") + text.count("�")
    return float(conf) + hangul * 5.0 - weird * 5.5 - replacement * 20.0


def preprocess_variants(crop):
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    scale = 3.0 if crop.shape[1] < 900 else 2.0
    gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8)).apply(gray)
    blur = cv2.GaussianBlur(clahe, (0, 0), 1.0)
    sharp = cv2.addWeighted(clahe, 1.7, blur, -0.7, 0)
    _, otsu = cv2.threshold(sharp, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    adaptive = cv2.adaptiveThreshold(
        sharp, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 41, 11
    )
    return [("clahe", sharp), ("otsu", otsu), ("adaptive", adaptive)]


def tesseract_lines(crop):
    candidates = []
    for variant_name, img in preprocess_variants(crop):
        for psm in (6, 4, 11):
            data = pytesseract.image_to_data(
                img,
                lang="kor+eng",
                config=f"--oem 1 --psm {psm} -c preserve_interword_spaces=1",
                output_type=Output.DICT,
            )
            groups = {}
            n = len(data["text"])
            for i in range(n):
                raw = str(data["text"][i]).strip()
                if not raw:
                    continue
                try:
                    conf = float(data["conf"][i])
                except Exception:
                    conf = -1
                if conf < 0:
                    continue
                key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
                item = groups.setdefault(key, {"words": [], "confs": [], "tops": [], "bottoms": []})
                item["words"].append(raw)
                item["confs"].append(conf)
                item["tops"].append(data["top"][i])
                item["bottoms"].append(data["top"][i] + data["height"][i])
            for item in groups.values():
                text = normalize_line(" ".join(item["words"]))
                if not is_menu_text(text):
                    continue
                y = ((min(item["tops"]) + max(item["bottoms"])) / 2.0) / img.shape[0]
                candidates.append({
                    "y": y,
                    "text": text,
                    "conf": sum(item["confs"]) / max(1, len(item["confs"])),
                    "engine": f"tesseract-{variant_name}-psm{psm}",
                })
    return candidates


def easyocr_lines(crop, reader):
    results = reader.readtext(
        crop,
        detail=1,
        paragraph=False,
        decoder="beamsearch",
        beamWidth=8,
        mag_ratio=2.0,
        text_threshold=0.45,
        low_text=0.25,
        link_threshold=0.3,
        width_ths=0.8,
    )
    raw = []
    h = max(1, crop.shape[0])
    for bbox, text, conf in results:
        text = normalize_line(text)
        if not is_menu_text(text):
            continue
        ys = [float(p[1]) for p in bbox]
        xs = [float(p[0]) for p in bbox]
        raw.append({
            "y": (min(ys) + max(ys)) / 2.0 / h,
            "x": min(xs),
            "text": text,
            "conf": float(conf) * 100.0,
        })

    # EasyOCR may return a bullet and dish name as separate boxes. Merge boxes on the same row.
    raw.sort(key=lambda x: (x["y"], x["x"]))
    rows = []
    for item in raw:
        target = None
        for row in rows:
            if abs(row["y"] - item["y"]) <= 0.026:
                target = row
                break
        if target is None:
            rows.append({"y": item["y"], "parts": [item]})
        else:
            target["parts"].append(item)
            target["y"] = sum(p["y"] for p in target["parts"]) / len(target["parts"])

    out = []
    for row in rows:
        parts = sorted(row["parts"], key=lambda x: x["x"])
        text = normalize_line(" ".join(p["text"] for p in parts))
        if not is_menu_text(text):
            continue
        out.append({
            "y": row["y"],
            "text": text,
            "conf": sum(p["conf"] for p in parts) / len(parts),
            "engine": "easyocr",
        })
    return out


def cluster_candidates(candidates, tolerance=0.033):
    candidates = sorted(candidates, key=lambda x: x["y"])
    clusters = []
    for cand in candidates:
        nearest = None
        nearest_dist = None
        for cluster in clusters:
            d = abs(cluster["y"] - cand["y"])
            if d <= tolerance and (nearest_dist is None or d < nearest_dist):
                nearest = cluster
                nearest_dist = d
        if nearest is None:
            clusters.append({"y": cand["y"], "items": [cand]})
        else:
            nearest["items"].append(cand)
            nearest["y"] = sum(x["y"] for x in nearest["items"]) / len(nearest["items"])
    return sorted(clusters, key=lambda x: x["y"])


def candidate_consensus_bonus(candidate, items):
    bonus = 0.0
    a = re.sub(r"\s+", "", candidate["text"])
    for other in items:
        if other is candidate:
            continue
        b = re.sub(r"\s+", "", other["text"])
        if not a or not b:
            continue
        ratio = SequenceMatcher(None, a, b).ratio()
        if ratio >= 0.85:
            bonus += 18
        elif ratio >= 0.65:
            bonus += 9
    return min(bonus, 36)


def select_cluster(cluster):
    unique = {}
    for cand in cluster["items"]:
        key = re.sub(r"\s+", "", cand["text"])
        prev = unique.get(key)
        if prev is None or cand["conf"] > prev["conf"]:
            unique[key] = cand
    items = list(unique.values())
    for cand in items:
        cand["score"] = text_quality(cand["text"], cand["conf"]) + candidate_consensus_bonus(cand, items)
    items.sort(key=lambda x: x["score"], reverse=True)
    best = items[0]
    alternatives = [x["text"] for x in items[1:5] if x["text"] != best["text"]]
    return {
        "y": cluster["y"],
        "text": best["text"],
        "confidence": round(best["conf"], 1),
        "score": round(best["score"], 1),
        "engine": best["engine"],
        "alternatives": alternatives,
    }


def refine_line_with_tesseract(crop, y, half_height_ratio=0.045):
    h = crop.shape[0]
    cy = int(y * h)
    hh = max(18, int(h * half_height_ratio))
    y0, y1 = max(0, cy - hh), min(h, cy + hh)
    band = crop[y0:y1, :]
    candidates = []
    for variant_name, img in preprocess_variants(band):
        for psm in (7, 13):
            text = pytesseract.image_to_string(
                img,
                lang="kor+eng",
                config=f"--oem 1 --psm {psm} -c preserve_interword_spaces=1",
            )
            text = normalize_line(text)
            if is_menu_text(text):
                candidates.append({
                    "y": y,
                    "text": text,
                    "conf": 65.0,
                    "engine": f"tesseract-line-{variant_name}-psm{psm}",
                })
    return candidates


def add_gap_rechecks(crop, selected, all_candidates):
    if len(selected) < 2:
        return all_candidates
    ys = sorted(x["y"] for x in selected)
    gaps = [ys[i + 1] - ys[i] for i in range(len(ys) - 1) if ys[i + 1] - ys[i] > 0.01]
    if not gaps:
        return all_candidates
    median_gap = float(np.median(gaps))
    if median_gap <= 0:
        return all_candidates
    targets = []
    for i in range(len(ys) - 1):
        gap = ys[i + 1] - ys[i]
        if gap > median_gap * 1.65:
            missing = max(1, int(round(gap / median_gap)) - 1)
            step = gap / (missing + 1)
            for j in range(missing):
                targets.append(ys[i] + step * (j + 1))
    for y in targets:
        all_candidates.extend(refine_line_with_tesseract(crop, y))
    return all_candidates


def detect_column_split(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    roi = gray[int(h * 0.16):int(h * 0.94), :]
    dark = (roi < 190).astype(np.float32)
    density = dark.mean(axis=0)
    kernel = np.ones(21, dtype=np.float32) / 21.0
    smooth = np.convolve(density, kernel, mode="same")
    lo, hi = int(w * 0.38), int(w * 0.62)
    split = int(np.argmin(smooth[lo:hi]) + lo)
    if not (int(w * 0.40) <= split <= int(w * 0.60)):
        split = w // 2
    return split


def read_column(crop, reader, name):
    all_candidates = tesseract_lines(crop)
    try:
        all_candidates.extend(easyocr_lines(crop, reader))
    except Exception as e:
        print(f"EasyOCR {name} failed: {type(e).__name__}: {e}")

    clusters = cluster_candidates(all_candidates)
    selected = [select_cluster(c) for c in clusters if c["items"]]
    selected = [x for x in selected if is_menu_text(x["text"])]

    # Re-OCR every suspicious row as a single text line.
    for row in selected:
        if row["score"] < 90 or len(re.findall(r"[A-Za-z0-9\[\]{}]", row["text"])) > 0:
            all_candidates.extend(refine_line_with_tesseract(crop, row["y"]))

    all_candidates = add_gap_rechecks(crop, selected, all_candidates)
    clusters = cluster_candidates(all_candidates)
    selected = [select_cluster(c) for c in clusters if c["items"]]
    selected = [x for x in selected if is_menu_text(x["text"])]
    selected.sort(key=lambda x: x["y"])

    # Remove near-duplicate rows caused by OCR engines splitting one printed row twice.
    deduped = []
    for row in selected:
        if deduped and abs(row["y"] - deduped[-1]["y"]) < 0.018:
            if row["score"] > deduped[-1]["score"]:
                deduped[-1] = row
            continue
        deduped.append(row)
    return deduped


def extract_menu_date(image):
    h, w = image.shape[:2]
    top = image[: max(120, int(h * 0.28)), :]
    gray = cv2.cvtColor(top, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=2.5, fy=2.5, interpolation=cv2.INTER_CUBIC)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    texts = []
    for psm in (6, 11, 12):
        texts.append(pytesseract.image_to_string(gray, lang="kor+eng", config=f"--oem 1 --psm {psm}"))
    for text in texts:
        m = DATE_RE.search(text)
        if m:
            try:
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                pass
    return None


def extract_menu_columns(image):
    h, w = image.shape[:2]
    split = detect_column_split(image)
    y0, y1 = int(h * 0.13), int(h * 0.96)
    side_margin = int(w * 0.025)
    center_gap = max(8, int(w * 0.012))
    left = image[y0:y1, side_margin:max(side_margin + 10, split - center_gap)]
    right = image[y0:y1, min(w - side_margin - 10, split + center_gap):w - side_margin]

    EASYOCR_MODEL_DIR.mkdir(parents=True, exist_ok=True)
    reader = easyocr.Reader(
        ["ko", "en"],
        gpu=False,
        verbose=False,
        model_storage_directory=str(EASYOCR_MODEL_DIR),
        user_network_directory=str(EASYOCR_MODEL_DIR),
    )

    left_rows = read_column(left, reader, "left")
    right_rows = read_column(right, reader, "right")
    return split, left_rows, right_rows


def suspicious_rows(rows):
    out = []
    for row in rows:
        text = row["text"]
        weird = len(re.findall(r"[A-Za-z0-9\[\]{}<>]", text))
        if row["score"] < 78 or weird > 0 or len(re.findall(r"[가-힣]", text)) < 2:
            out.append(row)
    return out


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
    lines += ["", "LEFT COLUMN:"]
    for row in payload.get("left_column", []):
        alt = " | alternatives: " + " / ".join(row.get("alternatives", [])[:3]) if row.get("alternatives") else ""
        lines.append(f"- {row['text']} [score={row['score']}, engine={row['engine']}]{alt}")
    lines += ["", "RIGHT COLUMN:"]
    for row in payload.get("right_column", []):
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
    checked_at = now_kst()
    payload = {
        "status": "error",
        "date": None,
        "checked_at": checked_at.isoformat(timespec="seconds"),
        "post_url": None,
        "discovery": None,
        "image_source": None,
        "image_method": None,
        "column_split_x": None,
        "left_column": [],
        "right_column": [],
        "menu_items": [],
        "uncertain_rows": [],
        "error": None,
    }

    try:
        post_url, discovery = discover_latest_post()
        payload["post_url"] = post_url
        payload["discovery"] = discovery
        print(f"Latest post: {post_url}")

        image_source, image_method = download_image(post_url)
        payload["image_source"] = image_source
        payload["image_method"] = image_method
        print(f"Image: {image_source} via {image_method}")

        image = cv2.imread(str(IMAGE_FILE), cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError("Downloaded menu image could not be decoded")

        menu_date = extract_menu_date(image)
        payload["date"] = menu_date.isoformat() if menu_date else None

        split, left_rows, right_rows = extract_menu_columns(image)
        payload["column_split_x"] = split
        payload["left_column"] = left_rows
        payload["right_column"] = right_rows
        payload["menu_items"] = [x["text"] for x in left_rows] + [x["text"] for x in right_rows]
        payload["uncertain_rows"] = suspicious_rows(left_rows) + suspicious_rows(right_rows)

        if menu_date is None or len(payload["menu_items"]) < 6:
            payload["status"] = "ocr_failed"
        elif menu_date != checked_at.date():
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
