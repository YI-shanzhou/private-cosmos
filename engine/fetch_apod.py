"""
fetch_apod.py — 从 NASA APOD 拉取每日天文图+说明
运行: python engine/fetch_apod.py
"""
import json, os, sys, re
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config

import requests
from PIL import Image

# ---- 配置 ----
API_KEY = config.NASA_API_KEY
APOD_URL = "https://api.nasa.gov/planetary/apod"
PROJECT_ROOT = config.PROJECT_ROOT
IMG_DIR = config.APOD_IMG_DIR
DATA_FILE = config.APOD_FILE

# 天文主题关键词表（从 explanation 里提取）
THEME_KEYWORDS = [
    "nebula", "galaxy", "star", "planet", "moon", "sun", "comet", "asteroid",
    "supernova", "black hole", "cluster", "cosmic", "milky way", "saturn",
    "jupiter", "mars", "venus", "aurora", "eclipse", "meteor", "quasar",
    "pulsar", "constellation", "horizon", "twilight", "dawn", "dust",
    "spiral", "remnant", "orbit", "telescope", "hubble", "jwst",
]
THEME_CN = {
    "nebula": "星云", "galaxy": "星系", "star": "恒星", "planet": "行星",
    "moon": "月球", "sun": "太阳", "comet": "彗星", "asteroid": "小行星",
    "supernova": "超新星", "black hole": "黑洞", "cluster": "星团",
    "cosmic": "宇宙", "milky way": "银河", "saturn": "土星",
    "jupiter": "木星", "mars": "火星", "venus": "金星", "aurora": "极光",
    "eclipse": "食", "meteor": "流星", "quasar": "类星体",
    "pulsar": "脉冲星", "constellation": "星座", "dust": "尘埃",
    "spiral": "螺旋", "remnant": "遗迹", "orbit": "轨道",
}

# 情绪映射（根据关键词推断）
MOOD_MAP = {
    "nebula": "壮阔", "galaxy": "辽阔", "supernova": "激烈", "black hole": "诡谲",
    "aurora": "宁静", "dawn": "希望", "twilight": "苍凉", "dust": "苍凉",
    "remnant": "孤寂", "cluster": "热闹", "comet": "孤寂", "eclipse": "神秘",
}


def get_dominant_color(img_path, n=3):
    """取图片主色调，返回 hex 列表"""
    img = Image.open(img_path).convert("RGB")
    img = img.resize((100, 100))
    pixels = list(img.getdata())
    # 简化聚类：按 RGB 分桶
    buckets = {}
    for r, g, b in pixels:
        key = (r // 32, g // 32, b // 32)
        buckets[key] = buckets.get(key, 0) + 1
    top = sorted(buckets.items(), key=lambda x: -x[1])[:n]
    colors = []
    for (r, g, b), _ in top:
        hr, hg, hb = r * 32 + 16, g * 32 + 16, b * 32 + 16
        colors.append(f"#{hr:02x}{hg:02x}{hb:02x}")
    return colors


def extract_themes(explanation):
    """从说明文字提取主题标签"""
    text = explanation.lower()
    found = []
    for kw in THEME_KEYWORDS:
        if kw in text:
            found.append({"en": kw, "cn": THEME_CN.get(kw, kw)})
    # 去重，最多 5 个
    seen = set()
    unique = []
    for t in found:
        if t["en"] not in seen:
            seen.add(t["en"])
            unique.append(t)
    return unique[:5]


def infer_mood(themes):
    """根据主题推断情绪"""
    moods = []
    for t in themes:
        m = MOOD_MAP.get(t["en"])
        if m and m not in moods:
            moods.append(m)
    return moods if moods else ["未知"]


def load_existing():
    """加载已有数据"""
    if DATA_FILE.exists():
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_data(data):
    """原子化保存"""
    tmp = DATA_FILE.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(DATA_FILE)


def fetch_apod(date=None):
    """拉取一天的 APOD"""
    params = {"api_key": API_KEY}
    if date:
        params["date"] = date
    else:
        params["count"] = 1  # 随机一天

    print(f"  请求 APOD API...")
    r = requests.get(APOD_URL, params=params, timeout=30)
    r.raise_for_status()
    data = r.json()
    if isinstance(data, list):
        data = data[0]

    # 只处理图片，跳过视频
    if data.get("media_type") != "image":
        print(f"  今天是视频，跳过: {data.get('title','?')}")
        return None

    apod_date = data["date"]
    title = data.get("title", "未命名")
    explanation = data.get("explanation", "")
    img_url = data.get("hdurl") or data.get("url", "")

    # 下载图片
    img_name = f"apod_{apod_date}.jpg"
    img_path = IMG_DIR / img_name
    print(f"  下载图片: {title}")
    print(f"  日期: {apod_date}")
    img_resp = requests.get(img_url, timeout=60)
    img_resp.raise_for_status()
    with open(img_path, "wb") as f:
        f.write(img_resp.content)

    # 提取标签
    colors = get_dominant_color(img_path)
    themes = extract_themes(explanation)
    moods = infer_mood(themes)

    record = {
        "date": apod_date,
        "title": title,
        "url": img_url,
        "local_path": f"assets/apod/{img_name}",
        "explanation": explanation[:500],
        "tags": {
            "colors": colors,
            "themes": themes,
            "moods": moods,
            "domain": "astronomy",
        },
        "fetched_at": datetime.now().isoformat(),
    }

    # 追加到数据文件（按 date 去重）
    existing = load_existing()
    existing = [e for e in existing if e["date"] != apod_date]
    existing.append(record)
    existing.sort(key=lambda x: x["date"])
    save_data(existing)

    print(f"  主色: {colors}")
    print(f"  主题: {[t['cn'] for t in themes]}")
    print(f"  情绪: {moods}")
    print(f"  已保存到 data/apod.json (共 {len(existing)} 条)")
    return record


if __name__ == "__main__":
    print("=== 私宇宙 · APOD 捞取 ===")
    try:
        result = fetch_apod()
        if result:
            print(f"\n✓ 完成: {result['title']} ({result['date']})")
        else:
            print("\n× 今日为视频，未保存")
    except Exception as e:
        print(f"\n× 失败: {e}", file=sys.stderr)
        sys.exit(1)
