"""
evolve.py — 私宇宙 · 演化引擎（薄 CLI 入口）

四阶段演化，每次运行诞生一个新天体：
  1. 规则演化  — engine.pairing.stage_rule_evolve
  2. 语义碰撞  — engine.collider.collide
  3. 受控随机  — engine.body_factory.stage_controlled_random
  4. 时间发酵  — engine.chronicler.stage_ferment

用法:
  python engine/evolve.py            # 演化 1 个天体
  python engine/evolve.py --count 3  # 连续演化 3 个
  python engine/evolve.py --dry-run  # 只预览不写入
"""
import os
import sys
import argparse
import random
from datetime import datetime

# 将项目根目录加入 sys.path，支持 `python engine/evolve.py` 直接运行（以 engine 为包）
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine import config
from engine.utils import _short, load_json
from engine.source_loader import load_all_sources
from engine.pairing import stage_rule_evolve
from engine.collider import collide
from engine.body_factory import stage_controlled_random
from engine.chronicler import stage_ferment, generate_daily_report, save_daily_report


def merge_tags(a, b, mood, c=None):
    """合并两个或三个素材的标签。"""
    tags_a = a.get("tags", {})
    tags_b = b.get("tags", {})
    moods = list(dict.fromkeys([mood] + tags_a.get("moods", []) + tags_b.get("moods", [])))
    raw_themes = [tags_a.get("theme"), tags_b.get("theme")]
    int_a = tags_a.get("intensity", 2)
    int_b = tags_b.get("intensity", 2)
    domains = [a["_domain"], b["_domain"]]
    era_a = tags_a.get("era", "")
    era_b = tags_b.get("era", "")
    eras = list(dict.fromkeys([e for e in [era_a, era_b] if e]))

    if c:
        tags_c = c.get("tags", {})
        moods = list(dict.fromkeys(moods + tags_c.get("moods", [])))
        raw_themes.append(tags_c.get("theme"))
        int_c = tags_c.get("intensity", 2)
        intensity = max(int_a, int_b, int_c)
        domains.append(c["_domain"])
        era_c = tags_c.get("era", "")
        eras = list(dict.fromkeys(eras + [e for e in [era_c] if e]))
    else:
        intensity = max(int_a, int_b)

    themes = list(dict.fromkeys([t for t in raw_themes if t]))
    return {
        "moods": moods[:4], "themes": themes[:4],
        "domains": domains[:3],
        "intensity": intensity, "eras": eras[:3],
    }


def evolve_once(dry_run=False, force_mode=None):
    """执行一次完整演化，返回新天体（或 None）。

    force_mode（调试/验收用）："triple" 强制三体、"dual" 强制两体、
    "lineage" 强制世代繁衍；None 保持默认随机行为。
    """
    sources = load_all_sources()
    if len(sources) < 2:
        print("  × 素材不足，至少需要 2 条")
        return None

    # 25% 概率触发世代模式（需要已有天体）；force_mode="lineage" 必走，
    # 强制 dual/triple 时禁用随机世代（保证强制路径不被抢占）
    parent_body = None
    cosmos = load_json(config.COSMOS_FILE)
    lineage_wanted = force_mode == "lineage" or (
        force_mode is None and random.random() < 0.25
    )
    if cosmos and lineage_wanted:
        # 限制世代深度：最多3代
        eligible = [b for b in cosmos if b.get("lineage", {}).get("generation", 0) < 3]
        if eligible:
            parent_body = random.choice(eligible)
        elif force_mode == "lineage":
            print("  × [force-mode=lineage] 无可繁衍父代（均已满3代），回退常规配对")

    if parent_body:
        print(f"  [世代模式] 父代: {parent_body['type_cn']}「{parent_body['name']}」")
        # 从素材中随机选两个作为"碰撞"基础（用于生成碰撞文本）
        a, b = random.sample(sources, 2) if len(sources) >= 2 else (sources[0], sources[0])
        c = None
    else:
        # 阶段一
        pair = stage_rule_evolve(
            sources, force_mode=force_mode if force_mode in ("dual", "triple") else None
        )
        if not pair:
            print("  × 无法完成跨领域配对")
            return None

        # 判断是两体还是三体
        if len(pair) == 3:
            a, b, c = pair
            print(f"  [规则演化·三体] {a['_domain']} × {b['_domain']} × {c['_domain']}")
            print(f"    甲: {_short(a.get('text') or a.get('title','?'))}")
            print(f"    乙: {_short(b.get('text') or b.get('title','?'))}")
            print(f"    丙: {_short(c.get('text') or c.get('title','?'))}")
        else:
            a, b = pair
            c = None
            print(f"  [规则演化] {a['_domain']} × {b['_domain']}")
            print(f"    甲: {_short(a.get('text') or a.get('title','?'))}")
            print(f"    乙: {_short(b.get('text') or b.get('title','?'))}")

    # 阶段二
    result = collide(a, b, c)
    collision_label = "三体·DeepSeek" if result['mode'] == 'deepseek' and c else ("DeepSeek" if result['mode'] == 'deepseek' else "本地")
    if parent_body:
        collision_label = f"世代·{collision_label}"
    print(f"  [语义碰撞·{collision_label}] {result['text']}")

    # 阶段三
    cr = stage_controlled_random(result, a, b, parent_body)
    print(f"  [受控随机] {cr['type_cn']}「{cr['name']}」 色{cr['color']} 径{cr['size']} 亮{cr['luminosity']}")

    # 组装天体
    epoch = len(cosmos) + 1
    parents = [a.get("id", "?"), b.get("id", "?")]
    composition = {
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
    }
    if c:
        parents.append(c.get("id", "?"))
        composition["c"] = {
            "domain": c["_domain"],
            "text": c.get("text") or c.get("title", ""),
            "source": c.get("source") or c.get("composer", ""),
        }

    body = {
        "id": f"body_{epoch:04d}",
        "type": cr["type_en"],
        "type_cn": cr["type_cn"],
        "name": cr["name"],
        "epoch": epoch,
        "born_at": datetime.now().isoformat(timespec="seconds"),
        "collision_text": result["text"],
        "collision_mode": result["mode"],
        "collision_type": "triple" if c else "dual",
        "parents": parents,
        "composition": composition,
        "tags": merge_tags(a, b, cr["mood"], c),
        "visual": {
            "color": cr["color"],
            "size": cr["size"],
            "luminosity": cr["luminosity"],
        },
    }

    # 世代信息
    if parent_body:
        parent_gen = parent_body.get("lineage", {}).get("generation", 0)
        body["lineage"] = {
            "parent_id": parent_body["id"],
            "generation": parent_gen + 1,
            "inherited_traits": ["type_family", "color"],
        }

    # 阶段四
    stage_ferment(body, dry_run, parent_body)
    if dry_run:
        print("  [dry-run] 未写入")
    else:
        print(f"  [时间发酵] cosmos.json 共 {len(cosmos)+1} 体，已写入编年史")
    return body


def main():
    parser = argparse.ArgumentParser(description="私宇宙·演化引擎")
    parser.add_argument("--count", type=int, default=1, help="连续演化次数")
    parser.add_argument("--dry-run", action="store_true", help="只预览不写入")
    parser.add_argument(
        "--force-mode", choices=["dual", "triple", "lineage"], default=None,
        help="强制演化路径（调试/验收用）：triple=三体 dual=两体 lineage=世代繁衍",
    )
    parser.add_argument("--seed", type=int, default=None, help="随机种子（复现实验用）")
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    mode_label = "DeepSeek 真实碰撞" if config.deepseek_available() else "本地降级碰撞"
    print("=== 私宇宙·演化引擎启动 ===")
    print(f"  碰撞模式: {mode_label}")
    if args.force_mode:
        print(f"  强制模式: {args.force_mode}")
    print(f"  目标: 诞生 {args.count} 个天体\n")

    born = 0
    new_bodies = []
    for i in range(args.count):
        print(f"--- 第 {i+1}/{args.count} 次演化 ---")
        body = evolve_once(dry_run=args.dry_run, force_mode=args.force_mode)
        if body:
            born += 1
            new_bodies.append(body)
            print(f"  ✓ 诞生: {body['type_cn']}「{body['name']}」\n")
        else:
            print(f"  × 失败\n")

    print(f"=== 完成：共诞生 {born} 个天体 ===")

    # 生成每日宇宙报告
    if new_bodies and not args.dry_run:
        print("\n--- 生成宇宙日报 ---")
        report = generate_daily_report(new_bodies)
        if report:
            print(f"  {report['summary']}")
            save_daily_report(report, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
