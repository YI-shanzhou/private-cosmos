"""导出数据到 web/ 目录（本地和 GitHub Actions 通用）"""
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

js_content = "// 自动生成的私宇宙数据\n"
js_content += "window.COSMOS_DATA = " + json.dumps(cosmos, ensure_ascii=False, indent=2) + ";\n"
js_content += "window.CHRONICLE_DATA = " + json.dumps(chronicle, ensure_ascii=False, indent=2) + ";\n"
js_content += "window.APOD_DATA = " + json.dumps(apod, ensure_ascii=False, indent=2) + ";\n"

WEB_DIR.mkdir(parents=True, exist_ok=True)
(WEB_DIR / "assets").mkdir(parents=True, exist_ok=True)
(WEB_DIR / "_shared" / "js").mkdir(parents=True, exist_ok=True)


out_path = WEB_DIR / "assets" / "cosmos-data.js"
out_path.write_text(js_content, encoding="utf-8")
print(f"已导出: {out_path}")
print(f"天体: {len(cosmos)}, 编年史: {len(chronicle)}, APOD: {len(apod)}")
