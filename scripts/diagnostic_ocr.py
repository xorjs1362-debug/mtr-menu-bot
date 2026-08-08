# diagnostic rerun 2026-08-09
import json
import re
from pathlib import Path
from urllib.parse import quote

import requests
import pytesseract
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

POST_URL = "https://pf.kakao.com/_QpxgJn/114201684"
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
DATA.mkdir(parents=True, exist_ok=True)
IMG = DATA / "diagnostic_menu.png"
OUT = ROOT / "diagnostic_result.txt"

headers = {"User-Agent": "Mozilla/5.0"}
logs = []

image_url = None
try:
    r = requests.get("https://api.microlink.io/", params={"url": POST_URL}, headers=headers, timeout=60)
    logs.append(f"metadata_status={r.status_code}")
    data = r.json().get("data", {})
    image_url = (data.get("image") or {}).get("url")
    logs.append(f"metadata_image_url={image_url}")
except Exception as e:
    logs.append(f"metadata_error={type(e).__name__}: {e}")

if image_url:
    try:
        ir = requests.get(image_url, headers=headers, timeout=60, allow_redirects=True)
        logs.append(f"image_status={ir.status_code}")
        logs.append(f"image_content_type={ir.headers.get('content-type')}")
        logs.append(f"image_bytes={len(ir.content)}")
        ir.raise_for_status()
        IMG.write_bytes(ir.content)
    except Exception as e:
        logs.append(f"image_error={type(e).__name__}: {e}")

if not IMG.exists() or IMG.stat().st_size < 10000:
    try:
        embed = f"https://api.microlink.io/?url={quote(POST_URL, safe='')}&embed=image.url"
        er = requests.get(embed, headers=headers, timeout=90, allow_redirects=True)
        logs.append(f"embed_status={er.status_code}")
        logs.append(f"embed_final_url={er.url}")
        logs.append(f"embed_content_type={er.headers.get('content-type')}")
        logs.append(f"embed_bytes={len(er.content)}")
        er.raise_for_status()
        IMG.write_bytes(er.content)
    except Exception as e:
        logs.append(f"embed_error={type(e).__name__}: {e}")

ocr_text = ""
if IMG.exists() and IMG.stat().st_size > 1000:
    try:
        img = Image.open(IMG).convert("RGB")
        logs.append(f"pil_size={img.width}x{img.height}")
        if img.width < 1800:
            scale = max(2, int(1800 / max(img.width, 1)))
            img = img.resize((img.width * scale, img.height * scale), Image.Resampling.LANCZOS)
        gray = ImageOps.grayscale(img)
        gray = ImageOps.autocontrast(gray)
        gray = ImageEnhance.Contrast(gray).enhance(1.4)
        gray = gray.filter(ImageFilter.SHARPEN)
        candidates = []
        for psm in (6, 11, 4):
            text = pytesseract.image_to_string(gray, lang="kor+eng", config=f"--oem 1 --psm {psm}")
            clean = "\n".join(x.strip() for x in text.splitlines() if x.strip())
            score = len(re.findall(r"[가-힣]", clean))
            candidates.append((score, psm, clean))
        candidates.sort(reverse=True)
        best = candidates[0]
        logs.append(f"best_psm={best[1]}")
        logs.append(f"hangul_chars={best[0]}")
        ocr_text = best[2]
    except Exception as e:
        logs.append(f"ocr_error={type(e).__name__}: {e}")

OUT.write_text("\n".join(logs) + "\n\n=== OCR ===\n" + (ocr_text or "(empty)") + "\n", encoding="utf-8")
print(OUT.read_text(encoding="utf-8"))
