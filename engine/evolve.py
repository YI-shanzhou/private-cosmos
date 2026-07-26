"""
evolve.py — 私宇宙 · 演化引擎

四阶段演化，每次运行诞生一个新天体：
  1. 规则演化  — 从各领域素材中跨领域配对选材
  2. 语义碰撞  — 两个素材相撞，诞生新意象（DeepSeek / 本地降级）
  3. 受控随机  — 根据碰撞情绪决定天体类型、颜色、亮度、命名
  4. 时间发酵  — 写入天体总表 cosmos.json + 编年史 chronicle.json

用法:
  python engine/evolve.py            # 演化 1 个天体
  python engine/evolve.py --count 3  # 连续演化 3 个
  python engine/evolve.py --dry-run  # 只预览不写入
"""
import json
import os
import sys
import random
import argparse
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config
import deepseek_client


# ---- 天体类型库：主导情绪 → 候选天体 (英文, 中文) ----
BODY_TYPES = {
    "壮阔": [("nebula", "星云"), ("galaxy", "星系")],
    "辽阔": [("galaxy", "星系"), ("cluster", "星团")],
    "苍凉": [("white_dwarf", "白矮星"), ("remnant", "遗迹")],
    "孤寂": [("comet", "彗星"), ("rogue_planet", "流浪行星")],
    "宁静": [("planet", "行星"), ("moon", "卫星")],
    "诡谲": [("black_hole", "黑洞"), ("dark_matter", "暗物质")],
    "激烈": [("supernova", "超新星")],
    "激越": [("pulsar", "脉冲星"), ("quasar", "类星体")],
    "神秘": [("dark_matter", "暗物质"), ("wormhole", "虫洞")],
    "希望": [("star", "恒星"), ("protostar", "原恒星")],
    "未知": [("dust_cloud", "尘埃云")],
}

# 情绪 → 主色（与项目美学一致：星海深空 × 暗物质）
MOOD_COLORS = {
    "壮阔": "#6D5AE6", "辽阔": "#0EA5E9", "苍凉": "#64748B",
    "孤寂": "#475569", "宁静": "#14B8A6", "诡谲": "#7C3AED",
    "激烈": "#F2715E", "激越": "#F2C94C", "神秘": "#8B5CF6",
    "希望": "#FBBF24", "未知": "#8A86A8",
}

# 命名词缀
NAME_PREFIXES = ["幽", "寂", "焰", "渊", "辉", "尘", "弦", "墟", "澜", "渺", "魄", "茫"]


# ---- 数据读写 ----
def load_json(path):
    if not path.exists():
        return []
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(path)


def load_all_sources():
    """加载所有领域素材，打平成统一结构并标记 _domain"""
    sources = []
    for domain, filename in config.DOMAIN_FILES.items():
        path = config.DATA_DIR / filename
        items = load_json(path)
        for idx, item in enumerate(items):
            entry = dict(item)
            entry["_domain"] = domain
            # 适配 APOD 天文数据格式
            if domain == "astronomy":
                if "id" not in entry:
                    entry["id"] = f"apo_{idx+1:02d}"
                if "text" not in entry:
                    entry["text"] = entry.get("title", "")
                if "source" not in entry:
                    entry["source"] = f"NASA APOD {entry.get('date', '')}"
                # 将 themes 对象数组转为 theme 字符串
                tags = entry.get("tags", {})
                themes_obj = tags.get("themes", [])
                if themes_obj and isinstance(themes_obj[0], dict):
                    tags["theme"] = themes_obj[0].get("cn", "")
            sources.append(entry)
    return sources


# ---- 四阶段演化 ----
def stage_rule_evolve(sources):
    """阶段一·规则演化：跨领域配对选材"""
    by_domain = {}
    for s in sources:
        by_domain.setdefault(s["_domain"], []).append(s)
    domains = list(by_domain.keys())
    if len(domains) < 2:
        if len(sources) >= 2:
            return random.sample(sources, 2)
        return None
    dom_a, dom_b = random.sample(domains, 2)
    a = random.choice(by_domain[dom_a])
    b = random.choice(by_domain[dom_b])
    return a, b


def stage_semantic_collide(a, b):
    """阶段二·语义碰撞"""
    return deepseek_client.collide(a, b)


def stage_controlled_random(result, a, b):
    """阶段三·受控随机：决定天体类型、颜色、亮度、命名"""
    mood = result["mood"]
    type_en, type_cn = random.choice(BODY_TYPES.get(mood, [("dust_cloud", "尘埃云")]))
    color = MOOD_COLORS.get(mood, "#8A86A8")
    size = round(random.uniform(0.3, 1.0), 2)
    luminosity = round(random.uniform(0.2, 1.0), 2)

    # 命名：前缀 + 主题首两字 + 情绪
    prefix = random.choice(NAME_PREFIXES)
    theme_a = a.get("tags", {}).get("theme", "")
    theme_b = b.get("tags", {}).get("theme", "")
    core = (theme_a or theme_b or "无名")
    core = core[:2] if len(core) >= 2 else core
    name = f"{prefix}{core}·{mood}"

    return {
        "type_en": type_en, "type_cn": type_cn,
        "color": color, "size": size, "luminosity": luminosity,
        "name": name, "mood": mood,
    }


def merge_tags(a, b, mood):
    """合并两个素材的标签"""
    tags_a = a.get("tags", {})
    tags_b = b.get("tags", {})
    moods = list(dict.fromkeys([mood] + tags_a.get("moods", []) + tags_b.get("moods", [])))
    raw_themes = [tags_a.get("theme"), tags_b.get("theme")]
    themes = list(dict.fromkeys([t for t in raw_themes if t]))
    return {"moods": moods[:4], "themes": themes[:4], "domains": [a["_domain"], b["_domain"]]}


def stage_ferment(body, dry_run=False):
    """阶段四·时间发酵：写入天体总表 + 编年史"""
    if dry_run:
        return body
    cosmos = load_json(config.COSMOS_FILE)
    cosmos.append(body)
    save_json(config.COSMOS_FILE, cosmos)

    chronicle = load_json(config.CHRONICLE_FILE)
    chronicle.append({
        "epoch": body["epoch"],
        "timestamp": body["born_at"],
        "event": "genesis",
        "body_id": body["id"],
        "summary": (
            f"第{body['epoch']}纪元：{body['composition']['a']['domain']}"
            f"×{body['composition']['b']['domain']}碰撞，"
            f"诞生{body['type_cn']}「{body['name']}」"
        ),
    })
    save_json(config.CHRONICLE_FILE, chronicle)
    return body


def evolve_once(dry_run=False):
    """执行一次完整演化，返回新天体（或 None）"""
    sources = load_all_sources()
    if len(sources) < 2:
        print("  × 素材不足，至少需要 2 条")
        return None

    # 阶段一
    pair = stage_rule_evolve(sources)
    if not pair:
        print("  × 无法完成跨领域配对")
        return None
    a, b = pair
    print(f"  [规则演化] {a['_domain']} × {b['_domain']}")
    print(f"    甲: {_short(a.get('text') or a.get('title','?'))}")
    print(f"    乙: {_short(b.get('text') or b.get('title','?'))}")

    # 阶段二
    result = stage_semantic_collide(a, b)
    print(f"  [语义碰撞·{result['mode']}] {result['text']}")

    # 阶段三
    cr = stage_controlled_random(result, a, b)
    print(f"  [受控随机] {cr['type_cn']}「{cr['name']}」 色{cr['color']} 径{cr['size']} 亮{cr['luminosity']}")

    # 组装天体
    cosmos = load_json(config.COSMOS_FILE)
    epoch = len(cosmos) + 1
    body = {
        "id": f"body_{epoch:04d}",
        "type": cr["type_en"],
        "type_cn": cr["type_cn"],
        "name": cr["name"],
        "epoch": epoch,
        "born_at": datetime.now().isoformat(timespec="seconds"),
        "collision_text": result["text"],
        "collision_mode": result["mode"],
        "parents": [a.get("id", "?"), b.get("id", "?")],
        "composition": {
            "a": {
                "domain": a["_domain"],
                "text": a.get("text") or a.get("title", ""),
                "source": a.get("source") or a.get("composer", ""),
            },
            "b": {
                "domain": b["_domain"],
                "text": b.get("text") or b.get("title", ""),
                "source": b.get("source") or b.get("composer", ""),
            },
        },
        "tags": merge_tags(a, b, cr["mood"]),
        "visual": {
            "color": cr["color"],
            "size": cr["size"],
            "luminosity": cr["luminosity"],
        },
    }

    # 阶段四
    stage_ferment(body, dry_run)
    if dry_run:
        print("  [dry-run] 未写入")
    else:
        print(f"  [时间发酵] cosmos.json 共 {len(cosmos)+1} 体，已写入编年史")
    return body


def _short(text, n=26):
    text = (text or "?").strip()
    return text[:n] + ("…" if len(text) > n else "")


def main():
    parser = argparse.ArgumentParser(description="私宇宙·演化引擎")
    parser.add_argument("--count", type=int, default=1, help="连续演化次数")
    parser.add_argument("--dry-run", action="store_true", help="只预览不写入")
    args = parser.parse_args()

    mode_label = "DeepSeek 真实碰撞" if config.deepseek_available() else "本地降级碰撞"
    print("=== 私宇宙·演化引擎启动 ===")
    print(f"  碰撞模式: {mode_label}")
    print(f"  目标: 诞生 {args.count} 个天体\n")

    born = 0
    for i in range(args.count):
        print(f"--- 第 {i+1}/{args.count} 次演化 ---")
        body = evolve_once(dry_run=args.dry_run)
        if body:
            born += 1
            print(f"  ✓ 诞生: {body['type_cn']}「{body['name']}」\n")
        else:
            print(f"  × 失败\n")

    print(f"=== 完成：共诞生 {born} 个天体 ===")


if __name__ == "__main__":
    main()
