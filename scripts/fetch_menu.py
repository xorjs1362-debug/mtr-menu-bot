# mtr-menu-bot: scheduled Kakao cafeteria menu OCR
# full pipeline trigger 2026-08-09
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import quote, urljoin
from zoneinfo import ZoneInfo

import requests
import pytesseract
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from playwright.sync_api import sync_playwright

CHANNEL_URL = "https://pf.kakao.com/_QpxgJn"
POST_RE = re.compile(r"https://pf\.kakao\.com/_QpxgJn/(\d+)")
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
STATE_FILE = DATA_DIR / "state.json"
OUT_JSON = ROOT / "latest_menu.json"
OUT_TXT = ROOT / "latest_menu.txt"
IMAGE_FILE = DATA_DIR / "latest_menu.png"
TZ = ZoneInfo("Asia/Seoul")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"


def now_kst():
    return datetime.now(TZ)


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {"last_post_url": "https://pf.kakao.com/_QpxgJn/114201684"}


def save_state(state):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def normalize_post_urls(raw_urls):
    found = {}
    for raw in raw_urls:
        if not raw:
            continue
        u = urljoin(CHANNEL_URL, raw)
        m = POST_RE.search(u)
        if m:
            found[int(m.group(1))] = m.group(0)
    return [found[k] for k in sorted(found, reverse=True)]


def discover_latest_post():
    headers = {"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8"}
    candidates = []

    try:
        r = requests.get(CHANNEL_URL, headers=headers, timeout=25)
        r.raise_for_status()
        candidates.extend(re.findall(r"(?:https://pf\.kakao\.com)?(/_QpxgJn/\d+)", r.text))
    except Exception as e:
        print(f"Static channel fetch failed: {e}")

    urls = normalize_post_urls(candidates)
    if urls:
        return urls[0]

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(user_agent=UA, locale="ko-KR", viewport={"width": 1280, "height": 1800})
        page.goto(CHANNEL_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(7000)
        try:
            page.mouse.wheel(0, 1400)
            page.wait_for_timeout(2000)
        except Exception:
            pass
        hrefs = page.locator("a").evaluate_all("els => els.map(e => e.href || e.getAttribute('href'))")
        html = page.content()
        browser.close()

    hrefs.extend(re.findall(r"(?:https://pf\.kakao\.com)?(/_QpxgJn/\d+)", html))
    urls = normalize_post_urls(hrefs)
    if not urls:
        raise RuntimeError("Kakao channel에서 게시물 링크를 찾지 못했습니다.")
    return urls[0]


def download_image_via_microlink(post_url):
    headers = {"User-Agent": UA}
    api = "https://api.microlink.io/"
    try:
        r = requests.get(api, params={"url": post_url}, headers=headers, timeout=60)
        r.raise_for_status()
        data = r.json().get("data", {})
        image_url = (data.get("image") or {}).get("url")
        if image_url:
            img = requests.get(image_url, headers=headers, timeout=60)
            img.raise_for_status()
            ctype = img.headers.get("content-type", "")
            if "image" in ctype or len(img.content) > 20_000:
                IMAGE_FILE.write_bytes(img.content)
                return image_url
    except Exception as e:
        print(f"Microlink JSON image fetch failed: {e}")

    embed_url = f"https://api.microlink.io/?url={quote(post_url, safe='')}&embed=image.url"
    try:
        img = requests.get(embed_url, headers=headers, timeout=90, allow_redirects=True)
        img.raise_for_status()
        ctype = img.headers.get("content-type", "")
        if "image" in ctype or len(img.content) > 20_000:
            IMAGE_FILE.write_bytes(img.content)
            return img.url
    except Exception as e:
        print(f"Microlink embed image fetch failed: {e}")
    return None


def capture_image_via_browser(post_url):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(user_agent=UA, locale="ko-KR", viewport={"width": 1280, "height": 2200})
        page.goto(post_url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(7000)

        imgs = page.locator("img")
        best = None
        best_area = 0
        for i in range(imgs.count()):
            loc = imgs.nth(i)
            try:
                info = loc.evaluate("e => ({w:e.naturalWidth||0,h:e.naturalHeight||0,src:e.currentSrc||e.src||''})")
                area = info["w"] * info["h"]
                if info["w"] >= 400 and info["h"] >= 300 and area > best_area:
                    best = (loc, info)
                    best_area = area
            except Exception:
                continue

        if best:
            loc, info = best
            loc.scroll_into_view_if_needed()
            page.wait_for_timeout(500)
            loc.screenshot(path=str(IMAGE_FILE))
            browser.close()
            return info.get("src") or post_url

        page.screenshot(path=str(IMAGE_FILE), full_page=True)
        browser.close()
        return post_url


def preprocess(path):
    img = Image.open(path).convert("RGB")
    if img.width < 1800:
        scale = max(2, int(1800 / max(img.width, 1)))
        img = img.resize((img.width * scale, img.height * scale), Image.Resampling.LANCZOS)
    gray = ImageOps.grayscale(img)
    gray = ImageOps.autocontrast(gray)
    gray = ImageEnhance.Contrast(gray).enhance(1.35)
    gray = gray.filter(ImageFilter.SHARPEN)
    return gray


def clean_ocr(text):
    lines = []
    seen = set()
    for raw in text.splitlines():
        line = re.sub(r"\s+", " ", raw).strip(" |·•-_=~")
        if len(line) < 2:
            continue
        if any(x in line for x in ["카카오톡채널", "채널 홈", "소식", "정보", "친구", "공유"]):
            continue
        if line not in seen:
            seen.add(line)
            lines.append(line)
    return "\n".join(lines)


def ocr_menu(path):
    img = preprocess(path)
    attempts = []
    for psm in (6, 11, 4):
        config = f"--oem 1 --psm {psm}"
        text = pytesseract.image_to_string(img, lang="kor+eng", config=config)
        cleaned = clean_ocr(text)
        hangul = len(re.findall(r"[가-힣]", cleaned))
        useful = len(re.findall(r"[가-힣A-Za-z0-9]", cleaned))
        score = hangul * 3 + useful
        attempts.append((score, cleaned))
    attempts.sort(key=lambda x: x[0], reverse=True)
    return attempts[0][1] if attempts else ""


def write_output(status, post_url, image_source=None, ocr_text=""):
    today = now_kst().date().isoformat()
    payload = {
        "status": status,
        "date": today,
        "checked_at": now_kst().isoformat(timespec="seconds"),
        "post_url": post_url,
        "image_source": image_source,
        "ocr_text": ocr_text,
    }
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    txt = [
        f"status: {status}",
        f"date: {today}",
        f"post_url: {post_url}",
        "",
        "OCR:",
        ocr_text if ocr_text else "(empty)",
        "",
    ]
    OUT_TXT.write_text("\n".join(txt), encoding="utf-8")


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    state = load_state()
    latest = discover_latest_post()
    print(f"Latest post: {latest}")
    print(f"Last processed: {state.get('last_post_url')}")

    if latest == state.get("last_post_url") and OUT_JSON.exists():
        print("No new post. Nothing to update.")
        return 0

    image_source = download_image_via_microlink(latest)
    if not IMAGE_FILE.exists() or IMAGE_FILE.stat().st_size < 10_000:
        image_source = capture_image_via_browser(latest)

    try:
        ocr_text = ocr_menu(IMAGE_FILE)
    except Exception as e:
        print(f"OCR failed: {e}")
        ocr_text = ""

    if len(re.findall(r"[가-힣]", ocr_text)) < 8:
        write_output("ocr_failed", latest, image_source, ocr_text)
    else:
        write_output("ready", latest, image_source, ocr_text)

    state["last_post_url"] = latest
    state["processed_at"] = now_kst().isoformat(timespec="seconds")
    save_state(state)
    print(OUT_TXT.read_text(encoding="utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
