"""
config.py — 私宇宙配置加载器
从项目根目录的 .env 读取环境变量，无需 python-dotenv 依赖。
"""
import os
from pathlib import Path

# 项目根目录
PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _load_env():
    """手动解析 .env 文件，注入 os.environ（不覆盖已存在的环境变量）"""
    env_file = PROJECT_ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


# 启动时自动加载
_load_env()

# ---- 配置项 ----
NASA_API_KEY = os.environ.get("NASA_API_KEY", "DEMO_KEY")
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash")

# 目录
DATA_DIR = PROJECT_ROOT / "data"
ASSETS_DIR = PROJECT_ROOT / "assets"
APOD_IMG_DIR = ASSETS_DIR / "apod"

# 核心数据文件
COSMOS_FILE = DATA_DIR / "cosmos.json"      # 天体总表
CHRONICLE_FILE = DATA_DIR / "chronicle.json"  # 演化编年史
APOD_FILE = DATA_DIR / "apod.json"

# 领域数据文件映射
DOMAIN_FILES = {
    "astronomy": "apod.json",
    "literature": "literature.json",
    "philosophy": "philosophy.json",
    "art": "music.json",
    "myth": "myth.json",
}


def deepseek_available():
    """DeepSeek key 是否可用（非空且以 sk- 开头）"""
    return bool(DEEPSEEK_API_KEY) and DEEPSEEK_API_KEY.startswith("sk-")
