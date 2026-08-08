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

REPLACEMENTS = {
    "고주장": "고추장",
    "포기김지": "포기김치",
    "콩나물무짐": "콩나물무침",
    "미스커피": "믹스커피",
    "오덩": "오뎅",
    "스테이ㅋ": "스테이크",
}
COMMON = [
    "김치제육볶음", "제육볶음", "함박스테이크", "오뎅떡볶이", "어묵떡볶이", "떡볶이",
    "콩나물무침", "고추장멸치볶음", "멸치볶음", "쌈상추겉절이", "상추겉절이",
    "포기김치", "배추김치", "깍두기", "유부된장국", "된장국", "미역국", "북어국",
    "열무국수", "잔치국수", "비빔국수", "샐러드", "라면", "계란후라이", "원두커피",
    "믹스커피", "매실차", "식혜", "잡채", "돈까스", "생선까스", "카레", "짜장",
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
    urls = [
        f"https://pf.kakao.com/rocket-web/web/profiles/{CHANNEL_ID}/posts",
        f"https://pf.kakao.com/rocket-web/web/profiles/{CHANNEL_ID}/posts/recent",
    ]
    errors = []
    for url in urls:
        try:
            params = {"size": 20} if url.endswith("recent") else {"includePinnedPost": "true"}
            r = requests.get(url, params=params, headers=HEADERS, timeout=30)
            print(f"FEED {r.url} status={r.status_code}")
            if r.status_code != 200:
                errors.append(f"{url}: HTTP {r.status_code}")
                continue
            ids = candidate_ids(r.json())
            ids |= {int(x) for x in re.findall(rf"/{re.escape(CHANNEL_ID)}/(\d+)", r.text)}
            print(f"candidate_ids={sorted(ids, reverse=True)[:10]}")
            if ids:
                pid = max(ids)
                return f"{CHANNEL_URL}/{pid}", url
        except Exception as e:
            errors.append(f"{type(e).__name__}: {e}")
    raise RuntimeError("No Kakao post id: " + " | ".join(errors))


def download_image(post_url):
    r = requests.get("https://api.microlink.io/", params={"url": post_url, "force": "true"}, headers=HEADERS, timeout=75)
    r.raise_for_status()
    image_url = ((r.json().get("data") or {}).get("image") or {}).get("url")
    if image_url:
        ir = requests.get(image_url, headers=HEADERS, timeout=60, allow_redirects=True)
        ir.raise_for_status()
        IMAGE_FILE.write_bytes(ir.content)
        return image_url, "microlink_metadata"
    embed = f"https://api.microlink.io/?url={quote(post_url, safe='')}&force=true&embed=image.url"
    er = requests.get(embed, headers=HEADERS, timeout=90, allow_redirects=True)
    er.raise_for_status()
    IMAGE_FILE.write_bytes(er.content)
    return er.url, "microlink_embed"


def normalize(text):
    text = str(text).replace("＊", " ").replace("•", " ").replace("·", " ")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"^[^가-힣A-Za-z0-9]+", "", text)
    text = re.sub(r"[^가-힣A-Za-z0-9]+$", "", text)
    prev = None
    while prev != text:
        prev = text
        text = re.sub(r"(?<=[가-힣])\s+(?=[가-힣])", "", text)
    for bad, good in REPLACEMENTS.items():
        text = text.replace(bad, good)
    text = re.sub(r"볶은$", "볶음", text)
    text = re.sub(r"멸치(?:복|북|볶)$", "멸치볶음", text)
    return text.strip()


def valid(text):
    if not text or len(text) < 2 or DATE_RE.search(text):
        return False
    return len(re.findall(r"[가-힣]", text)) >= 1


def fuzzy(text):
    best, ratio = None, 0.0
    for term in COMMON:
        r = SequenceMatcher(None, text, term).ratio()
        if r > ratio:
            best, ratio = term, r
    if best and ratio >= 0.88 and abs(len(best)-len(text)) <= 2:
        return best, round(ratio, 3)
    return text, None


def extract_date(image):
    top = image[:max(120, int(image.shape[0]*0.3)), :]
    gray = cv2.cvtColor(top, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=2.5, fy=2.5, interpolation=cv2.INTER_CUBIC)
    for psm in (6, 11, 12):
        text = pytesseract.image_to_string(gray, lang="kor+eng", config=f"--oem 1 --psm {psm}")
        m = DATE_RE.search(text)
        if m:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def split_columns(image):
    h, w = image.shape[:2]
    split = w // 2
    y0, y1 = int(h*0.13), int(h*0.965)
    outer = int(w*0.025)
    gap = max(5, int(w*0.006))
    return split, image[y0:y1, outer:split-gap], image[y0:y1, split+gap:w-outer]


def tesseract_seed_lines(column):
    gray = cv2.cvtColor(column, cv2.COLOR_BGR2GRAY)
    scale = 3.0
    gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    clahe = cv2.createCLAHE(2.2, (8,8)).apply(gray)
    outs = []
    for psm in (6, 4, 11):
        data = pytesseract.image_to_data(clahe, lang="kor+eng", config=f"--oem 1 --psm {psm}", output_type=Output.DICT)
        groups = {}
        for i, raw in enumerate(data["text"]):
            raw = str(raw).strip()
            if not raw:
                continue
            try: conf = float(data["conf"][i])
            except Exception: conf = -1
            if conf < 0:
                continue
            key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
            g = groups.setdefault(key, {"words":[], "confs":[], "tops":[], "bottoms":[]})
            g["words"].append(raw); g["confs"].append(conf)
            g["tops"].append(data["top"][i]); g["bottoms"].append(data["top"][i]+data["height"][i])
        for g in groups.values():
            text = normalize(" ".join(g["words"]))
            if valid(text):
                y = ((min(g["tops"])+max(g["bottoms"]))/2.0)/clahe.shape[0]
                outs.append({"y":y,"text":text,"confidence":sum(g["confs"])/len(g["confs"]),"engine":f"tess-seed-{psm}"})
    return outs


def easy_seed_lines(column, reader):
    out=[]
    try:
        res = reader.readtext(column, detail=1, paragraph=False, decoder="beamsearch", beamWidth=8, mag_ratio=1.8, text_threshold=0.35, low_text=0.20, link_threshold=0.25, width_ths=0.8)
        h=max(1,column.shape[0])
        for bbox,text,conf in res:
            text=normalize(text)
            if valid(text):
                ys=[float(p[1]) for p in bbox]
                out.append({"y":(min(ys)+max(ys))/2/h,"text":text,"confidence":float(conf)*100,"engine":"easy-seed"})
    except Exception as e:
        print(f"easy seed failed: {e}")
    return out


def cluster_y(cands, tol=0.035):
    clusters=[]
    for c in sorted(cands,key=lambda x:x["y"]):
        target=None
        for cl in clusters:
            if abs(cl["y"]-c["y"])<=tol:
                target=cl; break
        if target is None:
            clusters.append({"y":c["y"],"items":[c]})
        else:
            target["items"].append(c)
            target["y"]=sum(x["y"] for x in target["items"])/len(target["items"])
    return clusters


def infer_missing_centers(centers):
    ys=sorted(centers)
    if len(ys)<4:
        return ys
    gaps=[ys[i+1]-ys[i] for i in range(len(ys)-1) if ys[i+1]-ys[i]>0.02]
    if not gaps:
        return ys
    med=float(np.median(gaps))
    if med<=0: return ys
    extra=[]
    for i in range(len(ys)-1):
        gap=ys[i+1]-ys[i]
        if gap>med*1.6:
            n=max(1,int(round(gap/med))-1)
            step=gap/(n+1)
            extra += [ys[i]+step*(j+1) for j in range(n)]
    return sorted(ys+extra)


def row_candidates(band, reader):
    gray=cv2.cvtColor(band,cv2.COLOR_BGR2GRAY)
    gray=cv2.resize(gray,None,fx=4.0,fy=4.0,interpolation=cv2.INTER_CUBIC)
    clahe=cv2.createCLAHE(2.3,(8,8)).apply(gray)
    blur=cv2.GaussianBlur(clahe,(0,0),1.0)
    sharp=cv2.addWeighted(clahe,1.7,blur,-0.7,0)
    _,otsu=cv2.threshold(sharp,0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)
    adaptive=cv2.adaptiveThreshold(sharp,255,cv2.ADAPTIVE_THRESH_GAUSSIAN_C,cv2.THRESH_BINARY,41,11)
    cands=[]
    for name,img in [("clahe",sharp),("otsu",otsu),("adaptive",adaptive)]:
        for psm in (7,13):
            data=pytesseract.image_to_data(img,lang="kor+eng",config=f"--oem 1 --psm {psm}",output_type=Output.DICT)
            words=[]; confs=[]
            for t,c in zip(data["text"],data["conf"]):
                t=str(t).strip()
                try: cf=float(c)
                except Exception: cf=-1
                if t and cf>=0: words.append(t); confs.append(cf)
            text=normalize(" ".join(words))
            if valid(text): cands.append({"text":text,"confidence":sum(confs)/len(confs) if confs else 40,"engine":f"tess-{name}-{psm}"})
    try:
        res=reader.readtext(band,detail=1,paragraph=False,decoder="beamsearch",beamWidth=10,mag_ratio=2.5,text_threshold=0.30,low_text=0.15,link_threshold=0.20,width_ths=1.0)
        if res:
            res=sorted(res,key=lambda r:min(p[0] for p in r[0]))
            text=normalize(" ".join(str(r[1]) for r in res))
            conf=sum(float(r[2]) for r in res)/len(res)*100
            if valid(text): cands.append({"text":text,"confidence":conf,"engine":"easy-row"})
    except Exception as e:
        print(f"easy row failed: {e}")
    return cands


def choose(cands):
    uniq={}
    for c in cands:
        text,ratio=fuzzy(c["text"])
        c=dict(c); c["text"]=text; c["fuzzy_ratio"]=ratio
        key=text.replace(" ","")
        if key not in uniq or c["confidence"]>uniq[key]["confidence"]: uniq[key]=c
    cands=list(uniq.values())
    if not cands: return None
    for c in cands:
        hang=len(re.findall(r"[가-힣]",c["text"]))
        weird=len(re.findall(r"[A-Za-z0-9\[\]{}<>]",c["text"]))
        score=float(c["confidence"])+hang*5-weird*7
        for o in cands:
            if o is c: continue
            r=SequenceMatcher(None,c["text"],o["text"]).ratio()
            if r>=0.9: score+=16
            elif r>=0.75: score+=8
        c["score"]=score
    cands.sort(key=lambda x:x["score"],reverse=True)
    b=cands[0]
    return {"text":b["text"],"confidence":round(float(b["confidence"]),1),"score":round(float(b["score"]),1),"engine":b["engine"],"alternatives":[x["text"] for x in cands[1:5] if x["text"]!=b["text"]]}


def read_column(column, reader, label):
    seeds=tesseract_seed_lines(column)+easy_seed_lines(column,reader)
    clusters=cluster_y(seeds)
    centers=infer_missing_centers([c["y"] for c in clusters])
    print(f"{label}_seed_clusters={len(clusters)} centers={[round(y,3) for y in centers]}")
    h=column.shape[0]
    rows=[]
    for y in centers:
        cy=int(y*h); half=max(26,int(h*0.055))
        band=column[max(0,cy-half):min(h,cy+half),:]
        r=choose(row_candidates(band,reader))
        if r and valid(r["text"]):
            r["y"]=round(float(y),4); rows.append(r)
    rows.sort(key=lambda x:x["y"])
    final=[]
    for r in rows:
        if final and abs(r["y"]-final[-1]["y"])<0.025:
            if r["score"]>final[-1]["score"]: final[-1]=r
        elif final and SequenceMatcher(None,r["text"],final[-1]["text"]).ratio()>0.92:
            if r["score"]>final[-1]["score"]: final[-1]=r
        else:
            final.append(r)
    return final


def suspicious(row):
    return row["score"]<75 or len(re.findall(r"[A-Za-z0-9\[\]{}<>]",row["text"]))>0 or len(re.findall(r"[가-힣]",row["text"]))<2


def write(payload):
    OUT_JSON.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    lines=[f"status: {payload['status']}",f"date: {payload.get('date') or ''}",f"checked_at: {payload['checked_at']}",f"post_url: {payload.get('post_url') or ''}",f"image_source: {payload.get('image_source') or ''}",f"column_split_x: {payload.get('column_split_x') or ''}","","MENU ORDER: LEFT TOP->BOTTOM, THEN RIGHT TOP->BOTTOM"]
    for i,x in enumerate(payload.get("menu_items",[]),1): lines.append(f"{i}. {x}")
    for title,key in [("LEFT COLUMN","left_column"),("RIGHT COLUMN","right_column")]:
        lines += ["",title+":"]
        for r in payload.get(key,[]):
            alt=" | alternatives: "+" / ".join(r.get("alternatives",[])[:3]) if r.get("alternatives") else ""
            lines.append(f"- {r['text']} [score={r['score']}, engine={r['engine']}]{alt}")
    if payload.get("uncertain_rows"):
        lines += ["","UNCERTAIN ROWS:"]+[json.dumps(r,ensure_ascii=False) for r in payload["uncertain_rows"]]
    if payload.get("error"): lines += ["","ERROR:",payload["error"]]
    OUT_TXT.write_text("\n".join(lines)+"\n",encoding="utf-8")


def main():
    DATA_DIR.mkdir(parents=True,exist_ok=True); MODEL_DIR.mkdir(parents=True,exist_ok=True)
    checked=now_kst()
    p={"status":"error","date":None,"checked_at":checked.isoformat(timespec="seconds"),"post_url":None,"image_source":None,"image_method":None,"column_split_x":None,"left_column":[],"right_column":[],"menu_items":[],"uncertain_rows":[],"error":None}
    try:
        post,disc=discover_latest_post(); p["post_url"]=post; p["discovery"]=disc
        src,method=download_image(post); p["image_source"]=src; p["image_method"]=method
        image=cv2.imread(str(IMAGE_FILE));
        if image is None: raise RuntimeError("image decode failed")
        d=extract_date(image); p["date"]=d.isoformat() if d else None
        split,left,right=split_columns(image); p["column_split_x"]=split
        reader=easyocr.Reader(["ko","en"],gpu=False,verbose=False,model_storage_directory=str(MODEL_DIR),user_network_directory=str(MODEL_DIR))
        l=read_column(left,reader,"left"); r=read_column(right,reader,"right")
        p["left_column"]=l; p["right_column"]=r; p["menu_items"]=[x["text"] for x in l]+[x["text"] for x in r]
        p["uncertain_rows"]=[x for x in l+r if suspicious(x)]
        if d is None or len(p["menu_items"])<8: p["status"]="ocr_failed"
        elif d!=checked.date(): p["status"]="stale"
        elif p["uncertain_rows"]: p["status"]="review_needed"
        else: p["status"]="ready"
    except Exception as e:
        p["error"]=f"{type(e).__name__}: {e}"; print(p["error"])
    write(p); print(OUT_TXT.read_text(encoding="utf-8")); return 0

if __name__=="__main__": sys.exit(main())
