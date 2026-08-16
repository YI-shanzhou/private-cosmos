# -*- coding: utf-8 -*-
"""下载 APOD 真实图片到本地（V4 · M5-D 恢复重建）

TODO.md 第二项引用的脚本曾缺失，本文件为其恢复版：
- 读取 data/apod.json，仅下载 local_path 已登记但文件缺失的条目
- 只保存真实图片（校验 JPEG/PNG 魔数 + 最小体积），严禁任何模拟生成
- 失败条目打印清单（不虚标完成），可反复重跑直到补全

用法: python scripts/download_apod.py [--timeout 20] [--retries 2]
"""
import argparse
import json
import sys
import time
from pathlib import Path

import requests

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = PROJECT_ROOT / "data" / "apod.json"
WEB_DIR = PROJECT_ROOT / "web"
UA = {"User-Agent": "private-cosmos/4.0 (APOD image fetcher; contact: local)"}


def is_real_image(data: bytes) -> bool:
    """JPEG/PNG 魔数 + 最小 10KB（过滤错误页/占位小图）"""
    if len(data) < 10240:
        return False
    return data[:3] == b"\xff\xd8\xff" or data[:4] == b"\x89PNG"


def main() -> int:
    parser = argparse.ArgumentParser(description="下载缺失的 APOD 真实图片")
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--retries", type=int, default=2)
    args = parser.parse_args()

    entries = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    targets = []
    for a in entries:
        lp = a.get("local_path") or ""
        url = a.get("url") or a.get("hdurl") or ""
        if not lp or not url:
            continue
        if (WEB_DIR / lp).exists():
            continue
        targets.append((a.get("date"), url, lp))

    print(f"=== APOD 下载器：{len(targets)} 张待补全 ===")
    if not targets:
        print("全部图片已在本地，无需下载")
        return 0

    ok, failed = [], []
    for date, url, lp in targets:
        dest = WEB_DIR / lp
        dest.parent.mkdir(parents=True, exist_ok=True)
        got = False
        for attempt in range(1, args.retries + 2):
            try:
                print(f"  [{date}] 第 {attempt} 次尝试 {url}")
                r = requests.get(url, headers=UA, timeout=args.timeout)
                r.raise_for_status()
                if not is_real_image(r.content):
                    print(f"    [!] 非真实图片（魔数/体积不符，{len(r.content)}B），跳过")
                    break
                dest.write_bytes(r.content)
                print(f"    [OK] {dest.name} ({len(r.content)} B)")
                got = True
                break
            except Exception as e:
                print(f"    [!] {type(e).__name__}: {str(e)[:100]}")
                time.sleep(1.5)
        (ok if got else failed).append(date)

    print(f"=== 完成：成功 {len(ok)} / 失败 {len(failed)} ===")
    if failed:
        print("失败清单（下次网络窗口重跑本脚本补全）：")
        for d in failed:
            print(f"  - {d}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())