import re
import requests
from urllib.parse import urljoin

CHANNEL_ID = "_QpxgJn"
POSTS_URL = f"https://pf.kakao.com/{CHANNEL_ID}/posts"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
headers = {"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8"}

r = requests.get(POSTS_URL, headers=headers, timeout=30)
r.raise_for_status()
html = r.text
print(f"posts_status={r.status_code}")

scripts = re.findall(r'<script[^>]+src=["\']([^"\']+\.js[^"\']*)["\']', html, flags=re.I)
print("scripts:")
for s in scripts:
    print(" ", s)

main = None
for s in scripts:
    if "index-" in s and "legacy" not in s:
        main = urljoin(POSTS_URL, s)
        break
if not main:
    raise RuntimeError("main JS bundle not found")

print(f"main_js={main}")
j = requests.get(main, headers=headers, timeout=60)
j.raise_for_status()
text = j.text
print(f"js_status={j.status_code} bytes={len(text)}")

# Literal URL/path candidates.
patterns = [
    r'["\']([^"\']*rocket-web[^"\']*)["\']',
    r'["\']([^"\']*/web/v\d+/[^"\']*)["\']',
    r'["\']([^"\']*/profiles/[^"\']*)["\']',
    r'["\']([^"\']*(?:posts|post|feeds|feed|news|articles|article)[^"\']*)["\']',
]
seen = set()
print("\nLITERAL CANDIDATES:")
for pat in patterns:
    for m in re.finditer(pat, text, flags=re.I):
        val = m.group(1)
        if len(val) > 500 or val in seen:
            continue
        seen.add(val)
        print(val)

# Context around interesting words catches concatenated endpoints.
print("\nCONTEXT SNIPPETS:")
contexts = []
for token in ["rocket-web", "/posts", "posts", "postList", "feed", "news", "article", "profiles/"]:
    for m in re.finditer(re.escape(token), text, flags=re.I):
        start = max(0, m.start() - 220)
        end = min(len(text), m.end() + 320)
        snippet = text[start:end].replace("\n", " ")
        key = snippet[:250]
        if key not in {x[:250] for x in contexts}:
            contexts.append(snippet)
        if len(contexts) >= 80:
            break
    if len(contexts) >= 80:
        break
for i, s in enumerate(contexts, 1):
    print(f"[{i}] {s}")
