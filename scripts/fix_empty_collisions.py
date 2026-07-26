"""修复碰撞文本为空的天体（GitHub Actions 用）"""
import json
import sys
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "engine"))

import config
import deepseek_client
from evolve import load_all_sources, _short

sources = load_all_sources()
source_map = {}
for s in sources:
    sid = s.get("id", "")
    if sid:
        source_map[sid] = s

cosmos_path = config.COSMOS_FILE
if not cosmos_path.exists():
    print("cosmos.json 不存在，跳过")
    sys.exit(0)

cosmos = json.loads(cosmos_path.read_text(encoding="utf-8"))

fixed = 0
failed = 0
for body in cosmos:
    text = body.get("collision_text", "").strip()
    if text:
        continue
    parents = body.get("parents", [])
    if len(parents) < 2:
        failed += 1
        continue
    pa = source_map.get(parents[0])
    pb = source_map.get(parents[1])
    if not pa or not pb:
        failed += 1
        continue
    try:
        result = deepseek_client.collide(pa, pb)
        new_text = result["text"].strip()
        if new_text:
            body["collision_text"] = new_text
            body["collision_mode"] = result["mode"]
            fixed += 1
    except Exception:
        failed += 1

cosmos_path.write_text(json.dumps(cosmos, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"修复完成：成功 {fixed}，失败 {failed}")
