import json
import re
import sys
from datetime import date, datetime
from pathlib import Path
from urllib.parse import quote
from zoneinfo import ZoneInfo

import requests
import pytesseract
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

CHANNEL_ID = "_QpxgJn"
CHANNEL_URL = f"https://pf.kakao.com/{CHANNEL_ID}"
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUT_JSON = ROOT / "latest_menu.json"
OUT_TXT = ROOT / "latest_menu.txt"
IMAGE_FILE = DATA_DIR / "latest_menu.png"
TZ = ZoneInfo("Asia/Seoul")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
POST_RE = re.compile(rf"(?:https?://pf\.kakao\.com)?/{re.escape(CHANNEL_ID)}/(\d+)")
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
        f"https://pf.kakao.com/rocket-web/web/v2/profiles/{CHANNEL_ID}/posts",
        f"https://pf.kakao.com/rocket-web/web/v2/profiles/{CHANNEL_ID}/posts/recent",
        f"https://pf.kakao.com/rocket-web/web/profiles/{CHANNEL_ID}/posts",
        f"https://pf.kakao.com/rocket-web/web/profiles/{CHANNEL_ID}/posts/recent",
    ]
    errors = []
    for url in endpoints:
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            print(f"FEED {url} status={r.status_code} type={r.headers.get('content-type')}")
            if r.status_code != 200:
                errors.append(f"{url}: HTTP {r.status_code}")
                continue
            payload = r.json()
            if isinstance(payload, dict):
                print("  keys=" + ",".join(payload.keys()))
            ids = candidate_ids(payload)
            ids |= {int(x) for x in re.findall(rf"/{re.escape(CHANNEL_ID)}/(\d+)", r.text)}
            print("  candidate_ids=" + repr(sorted(ids, reverse=True)[:20]))
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


def clean_ocr(text):
    lines = []
    seen = set()
    for raw in text.splitlines():
        line = re.sub(r"\s+", " ", raw).strip(" |·•-_=~")
        if len(line) < 2:
            continue
        if line not in seen:
            seen.add(line)
            lines.append(line)
    return "\n".join(lines)


def make_variants(path):
    img = Image.open(path).convert("RGB")
    if img.width < 1800:
        scale = max(2, int(1800 / max(img.width, 1)))
        img = img.resize((img.width * scale, img.height * scale), Image.Resampling.LANCZOS)
    gray = ImageOps.grayscale(img)
    gray = ImageOps.autocontrast(gray)
    gray = ImageEnhance.Contrast(gray).enhance(1.35)
    gray = gray.filter(ImageFilter.SHARPEN)
    strong = ImageEnhance.Contrast(gray).enhance(1.7)
    binary = strong.point(lambda p: 255 if p > 170 else 0)
    return [("gray", gray), ("strong", strong), ("binary", binary)]


def ocr_candidates(path):
    attempts = []
    for variant_name, img in make_variants(path):
        for psm in (4, 6, 11):
            text = pytesseract.image_to_string(img, lang="kor+eng", config=f"--oem 1 --psm {psm}")
            cleaned = clean_ocr(text)
            hangul = len(re.findall(r"[가-힣]", cleaned))
            date_bonus = 50 if re.search(r"20\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일", cleaned) else 0
            menu_markers = cleaned.count("*") + cleaned.count("•")
            attempts.append({"variant": variant_name, "psm": psm, "score": hangul * 3 + date_bonus + menu_markers * 2, "hangul_chars": hangul, "text": cleaned})
    attempts.sort(key=lambda x: x["score"], reverse=True)
    return attempts[:5]


def extract_menu_date(candidates):
    date_re = re.compile(r"(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일")
    for item in candidates:
        m = date_re.search(item["text"])
        if m:
            try:
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                pass
    return None


def write_output(payload):
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    OUT_TXT.write_text("\n".join([
        f"status: {payload['status']}",
        f"date: {payload.get('date') or ''}",
        f"checked_at: {payload['checked_at']}",
        f"post_url: {payload.get('post_url') or ''}",
        f"discovery: {payload.get('discovery') or ''}",
        f"image_method: {payload.get('image_method') or ''}",
        "",
        "OCR BEST:",
        payload.get("ocr_text") or "(empty)",
        "",
    ]), encoding="utf-8")


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    checked_at = now_kst()
    payload = {"status": "error", "date": None, "checked_at": checked_at.isoformat(timespec="seconds"), "post_url": None, "discovery": None, "image_source": None, "image_method": None, "ocr_text": "", "ocr_candidates": [], "error": None}
    try:
        post_url, discovery = discover_latest_post()
        payload["post_url"] = post_url
        payload["discovery"] = discovery
        print(f"Latest post: {post_url}")
        image_source, image_method = download_image(post_url)
        payload["image_source"] = image_source
        payload["image_method"] = image_method
        print(f"Image: {image_source} via {image_method}")
        candidates = ocr_candidates(IMAGE_FILE)
        payload["ocr_candidates"] = candidates
        payload["ocr_text"] = candidates[0]["text"] if candidates else ""
        menu_date = extract_menu_date(candidates)
        payload["date"] = menu_date.isoformat() if menu_date else None
        if not candidates or candidates[0]["hangul_chars"] < 8 or menu_date is None:
            payload["status"] = "ocr_failed"
        elif menu_date != checked_at.date():
            payload["status"] = "stale"
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
