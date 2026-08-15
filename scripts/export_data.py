"""导出数据到 web/ 目录（本地和 GitHub Actions 通用）

导出 5 个全局变量到 web/assets/cosmos-data.js：
  COSMOS_DATA / CHRONICLE_DATA / APOD_DATA / DAILY_REPORTS / COSMOS_STATS
"""
import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
WEB_DIR = PROJECT_ROOT / "web"

# 加载数据
cosmos = json.loads((DATA_DIR / "cosmos.json").read_text(encoding="utf-8"))
chronicle = json.loads((DATA_DIR / "chronicle.json").read_text(encoding="utf-8"))

apod = []
apod_path = DATA_DIR / "apod.json"
if apod_path.exists():
    apod = json.loads(apod_path.read_text(encoding="utf-8"))

daily_reports = []
reports_path = DATA_DIR / "daily_reports.json"
if reports_path.exists():
    daily_reports = json.loads(reports_path.read_text(encoding="utf-8"))


def _sorted_desc(dist):
    """按计数降序排列分布字典；计数并列时按键名升序，保证输出与输入顺序无关（字节级确定）。"""
    return dict(sorted(dist.items(), key=lambda kv: (-kv[1], kv[0])))


def build_stats(bodies, chronicle_entries, reports):
    """汇总宇宙统计：天体总数、类型分布、情绪分布、领域分布、世代深度。"""
    type_dist = {}
    mood_dist = {}
    domain_dist = {}
    gen_dist = {}
    lineage_bodies = 0
    max_generation = 0

    for b in bodies:
        type_cn = b.get("type_cn") or "未知"
        type_dist[type_cn] = type_dist.get(type_cn, 0) + 1

        tags = b.get("tags") or {}
        for mood in tags.get("moods", []):
            mood_dist[mood] = mood_dist.get(mood, 0) + 1
        for domain in tags.get("domains", []):
            domain_dist[domain] = domain_dist.get(domain, 0) + 1

        lineage = b.get("lineage")
        if lineage:
            lineage_bodies += 1
            gen = int(lineage.get("generation") or 1)
            max_generation = max(max_generation, gen)
            gen_key = f"第{gen}代"
            gen_dist[gen_key] = gen_dist.get(gen_key, 0) + 1

    return {
        "total_bodies": len(bodies),
        "chronicle_entries": len(chronicle_entries),
        "daily_report_count": len(reports),
        "type_distribution": _sorted_desc(type_dist),
        "mood_distribution": _sorted_desc(mood_dist),
        "domain_distribution": _sorted_desc(domain_dist),
        "generation": {
            "max_generation": max_generation,
            "lineage_bodies": lineage_bodies,
            "distribution": _sorted_desc(gen_dist),
        },
    }


stats = build_stats(cosmos, chronicle, daily_reports)

js_content = "// 自动生成的私宇宙数据\n"
js_content += "window.COSMOS_DATA = " + json.dumps(cosmos, ensure_ascii=False, indent=2) + ";\n"
js_content += "window.CHRONICLE_DATA = " + json.dumps(chronicle, ensure_ascii=False, indent=2) + ";\n"
js_content += "window.APOD_DATA = " + json.dumps(apod, ensure_ascii=False, indent=2) + ";\n"
js_content += "window.DAILY_REPORTS = " + json.dumps(daily_reports, ensure_ascii=False, indent=2) + ";\n"
js_content += "window.COSMOS_STATS = " + json.dumps(stats, ensure_ascii=False, indent=2) + ";\n"

WEB_DIR.mkdir(parents=True, exist_ok=True)
(WEB_DIR / "assets").mkdir(parents=True, exist_ok=True)

out_path = WEB_DIR / "assets" / "cosmos-data.js"
out_path.write_text(js_content, encoding="utf-8")
print(f"已导出: {out_path}")
print(
    f"天体: {len(cosmos)}, 编年史: {len(chronicle)}, APOD: {len(apod)}, "
    f"日报: {len(daily_reports)}"
)
print(
    f"COSMOS_STATS: 类型{len(stats['type_distribution'])}种, "
    f"情绪{len(stats['mood_distribution'])}种, "
    f"领域{len(stats['domain_distribution'])}个, "
    f"最深世代: 第{stats['generation']['max_generation']}代"
)
