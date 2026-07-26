"""为 GitHub Pages 整理 web/ 目录"""
import shutil
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = PROJECT_ROOT / "web"
SKYMAP_SOURCE = PROJECT_ROOT.parent / "private-cosmos-skymap"

WEB_DIR.mkdir(parents=True, exist_ok=True)

# 如果星空页面源文件存在于上级目录，复制过来
if SKYMAP_SOURCE.exists():
    for item in SKYMAP_SOURCE.iterdir():
        dest = WEB_DIR / item.name
        if item.is_file():
            shutil.copy2(item, dest)
        elif item.is_dir():
            if dest.exists():
                shutil.rmtree(dest)
            shutil.copytree(item, dest)

# 确保数据文件是最新的
import export_data  # 调用同目录的导出脚本

print("GitHub Pages 文件整理完成")
