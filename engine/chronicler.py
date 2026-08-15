"""
chronicler.py — 编年史与日报生成

从原 engine/evolve.py 提取 stage_ferment + generate_daily_report + save_daily_report。
"""
import json
from datetime import datetime

import requests

from engine import config
from engine.utils import load_json, save_json


def stage_ferment(body, dry_run=False, parent_body=None):
    """阶段四·时间发酵：写入天体总表 + 编年史。"""
    if dry_run:
        return body
    cosmos = load_json(config.COSMOS_FILE)
    cosmos.append(body)
    save_json(config.COSMOS_FILE, cosmos)

    chronicle = load_json(config.CHRONICLE_FILE)
    if parent_body:
        summary = (
            f"第{body['epoch']}纪元：{parent_body['type_cn']}「{parent_body['name']}」"
            f"繁衍出第{body.get('lineage', {}).get('generation', 1)}代子嗣"
            f"——{body['type_cn']}「{body['name']}」"
        )
    else:
        summary = (
            f"第{body['epoch']}纪元：{body['composition']['a']['domain']}"
            f"×{body['composition']['b']['domain']}碰撞，"
            f"诞生{body['type_cn']}「{body['name']}」"
        )
    chronicle.append({
        "epoch": body["epoch"],
        "timestamp": body["born_at"],
        "event": "genesis" if not parent_body else "lineage",
        "body_id": body["id"],
        "summary": summary,
    })
    save_json(config.CHRONICLE_FILE, chronicle)
    return body


def generate_daily_report(bodies):
    """生成每日宇宙报告（使用 DeepSeek 或本地模板）。"""
    if not bodies:
        return None

    today = datetime.now().strftime("%Y-%m-%d")
    body_count = len(bodies)
    types = [b["type_cn"] for b in bodies]
    names = [b["name"] for b in bodies]
    moods = [b["tags"]["moods"][0] if b["tags"].get("moods") else "未知" for b in bodies]
    domains_set = set()
    for b in bodies:
        for d in b["tags"].get("domains", []):
            domains_set.add(d)
    lineage_count = sum(1 for b in bodies if b.get("lineage"))
    triple_count = sum(1 for b in bodies if b.get("collision_type") == "triple")

    # 尝试 DeepSeek 生成摘要
    summary = None
    if config.deepseek_available():
        try:
            prompt = (
                "你是「私宇宙」的宇宙日报编辑。今天宇宙中诞生了新的天体，"
                "请根据以下信息写一段50-80字的宇宙日报摘要，描述今日宇宙变化。"
                "要求：富有诗意，有宇宙感和叙事感，中文。只输出摘要文本。\n\n"
                f"今日诞生天体数：{body_count}\n"
                f"天体名称：{', '.join(names)}\n"
                f"天体类型：{', '.join(types)}\n"
                f"主导情绪：{', '.join(moods)}\n"
                f"涉及领域：{', '.join(domains_set)}\n"
                f"世代繁衍：{lineage_count}颗\n"
                f"三体碰撞：{triple_count}次\n"
            )
            resp = requests.post(
                f"{config.DEEPSEEK_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {config.DEEPSEEK_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": config.DEEPSEEK_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 150,
                    "temperature": 0.8,
                },
                timeout=30,
            )
            resp.raise_for_status()
            summary = resp.json()["choices"][0]["message"]["content"].strip()
        except Exception as e:
            print(f"  [日报摘要生成失败，使用模板] {e}")

    if not summary:
        if lineage_count > 0:
            summary = f"今日宇宙诞生了{body_count}颗新天体，其中{lineage_count}颗源自古老天体的血脉延续。{'、'.join(types)}在{'、'.join(domains_set)}的碰撞中绽放，情绪以{'、'.join(moods[:3])}为主导。"
        elif triple_count > 0:
            summary = f"今日宇宙经历了{triple_count}次三体混沌碰撞，{body_count}颗新天体在{'、'.join(domains_set)}的交叉中诞生。{'、'.join(types)}携带着{'、'.join(moods[:3])}的情绪，加入了星空。"
        else:
            summary = f"今日宇宙又长大了——{body_count}颗新天体在{'、'.join(domains_set)}领域的碰撞中诞生。{'、'.join(types)}们带着{'、'.join(moods[:3])}的情绪，在星空中找到了自己的位置。"

    report = {
        "date": today,
        "summary": summary,
        "body_count": body_count,
        "new_bodies": [{"name": b["name"], "type_cn": b["type_cn"], "id": b["id"]} for b in bodies],
        "mood_distribution": {m: moods.count(m) for m in set(moods)},
        "domain_distribution": {d: sum(1 for b in bodies if d in b["tags"].get("domains", [])) for d in domains_set},
        "lineage_count": lineage_count,
        "triple_count": triple_count,
    }
    return report


def _absorb_reports(base, extra):
    """把 extra 合并进 base：计数/清单/分布求和，摘要取 extra（较新）的值。"""
    base["body_count"] = base.get("body_count", 0) + extra.get("body_count", 0)
    base["new_bodies"] = base.get("new_bodies", []) + extra.get("new_bodies", [])
    base["lineage_count"] = base.get("lineage_count", 0) + extra.get("lineage_count", 0)
    base["triple_count"] = base.get("triple_count", 0) + extra.get("triple_count", 0)
    for key in ("mood_distribution", "domain_distribution"):
        dist = dict(base.get(key) or {})
        for k, v in (extra.get(key) or {}).items():
            dist[k] = dist.get(k, 0) + v
        base[key] = dist
    base["summary"] = extra["summary"]
    return base


def merge_same_day(reports, report):
    """将 report 并入 reports：同 date 的全部条目（含历史重复）收敛为一条。

    返回新列表，不修改入参；合并条目置于末尾。
    """
    same_day = [r for r in reports if r.get("date") == report["date"]]
    if not same_day:
        return reports + [report]
    merged = dict(same_day[0])
    for r in same_day[1:]:
        merged = _absorb_reports(merged, r)
    merged = _absorb_reports(merged, report)
    rest = [r for r in reports if r.get("date") != report["date"]]
    return rest + [merged]


def save_daily_report(report, dry_run=False):
    """保存每日宇宙报告（同日幂等：同一天多次运行合并为一条，历史同日重复一并收敛）。"""
    if dry_run or not report:
        return
    report_path = config.DATA_DIR / "daily_reports.json"
    reports = []
    if report_path.exists():
        reports = json.loads(report_path.read_text(encoding="utf-8"))

    reports = merge_same_day(reports, report)

    # 只保留最近30天
    reports = reports[-30:]
    report_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = report_path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(reports, f, ensure_ascii=False, indent=2)
    tmp.replace(report_path)
    print(f"  [日报] 已保存到 {report_path}")
