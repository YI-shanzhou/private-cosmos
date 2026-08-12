"""
utils.py — 私宇宙引擎公共工具

统一收敛原 evolve.py 与 deepseek_client.py 中重复定义的
load_json / save_json / _short，避免循环导入。
"""
import json


def load_json(path):
    """读取 JSON 文件，不存在时返回空列表。"""
    if not path.exists():
        return []
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    """原子化写入 JSON 文件。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(path)


def _short(text, n=26):
    """截断文本用于展示。"""
    text = (text or "?").strip()
    return text[:n] + ("…" if len(text) > n else "")
