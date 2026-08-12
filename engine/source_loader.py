"""
source_loader.py — 素材加载与预处理

从原 engine/evolve.py 提取 load_all_sources()。
"""
from engine import config
from engine.utils import load_json


def load_all_sources():
    """加载所有领域素材，打平成统一结构并标记 _domain。"""
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
