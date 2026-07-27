"""
deepseek_client.py — DeepSeek 语义碰撞引擎

让两个不同领域的内容"撞"在一起，诞生新的意象。
- 优先调用 DeepSeek API 做真正的语义碰撞
- key 缺失或调用失败时，自动降级为本地规则碰撞

对外接口:
    collide(content_a, content_b) -> {"text", "mode", "mood"}
"""
import os
import sys
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config

import requests

# ---- 本地降级碰撞模板 ----
_LOCAL_TEMPLATES = [
    "「{a}」撞上「{b}」，碎成一团{mood}的星尘。",
    "当「{a}」遇见「{b}」，{mood}的引力把它们拧成了新的轨道。",
    "「{a}」与「{b}」在虚空中相撞，迸出{mood}的光。",
    "「{a}」倒映在「{b}」里，裂成一片{mood}的星云。",
    "「{a}」吞下「{b}」，吐出一段{mood}的回响。",
    "「{a}」穿过「{b}」，留下一道{mood}的尾迹。",
    "「{a}」与「{b}」相互缠绕，坍缩成一粒{mood}的奇点。",
    "「{a}」在「{b}」的引力下弯曲，折成{mood}的弧线。",
    "「{a}」被「{b}」点燃，烧成一片{mood}的余烬。",
    "「{a}」沉入「{b}」，泛起{mood}的涟漪。",
]


def _pick_mood(moods_a, moods_b):
    """从两组情绪里挑一个碰撞后的主导情绪（优先交集）"""
    common = [m for m in moods_a if m in moods_b]
    if common:
        return random.choice(common)
    pool = list(moods_a) + list(moods_b)
    return random.choice(pool) if pool else "未知"


def _short(text, n=22):
    """截断文本用于展示"""
    text = (text or "?").strip()
    return text[:n] + ("…" if len(text) > n else "")


def collide_local(content_a, content_b):
    """本地降级碰撞：用模板拼接两个内容，产出新意象文本"""
    text_a = _short(content_a.get("text") or content_a.get("title", "?"))
    text_b = _short(content_b.get("text") or content_b.get("title", "?"))
    moods_a = content_a.get("tags", {}).get("moods", [])
    moods_b = content_b.get("tags", {}).get("moods", [])
    mood = _pick_mood(moods_a, moods_b)
    tpl = random.choice(_LOCAL_TEMPLATES)
    text = tpl.format(a=text_a, b=text_b, mood=mood)
    return {"text": text, "mode": "local", "mood": mood}


def collide_api(content_a, content_b):
    """调用 DeepSeek 做语义碰撞，返回新意象文本（含重试）"""
    text_a = content_a.get("text") or content_a.get("title", "")
    text_b = content_b.get("text") or content_b.get("title", "")
    src_a = content_a.get("source") or content_a.get("composer", "")
    src_b = content_b.get("source") or content_b.get("composer", "")
    tags_a = content_a.get("tags", {})
    tags_b = content_b.get("tags", {})
    dom_a = tags_a.get("domain", "?")
    dom_b = tags_b.get("domain", "?")
    mood_a = tags_a.get("moods", [])
    mood_b = tags_b.get("moods", [])
    theme_a = tags_a.get("theme", "")
    theme_b = tags_b.get("theme", "")
    era_a = tags_a.get("era", "")
    era_b = tags_b.get("era", "")
    int_a = tags_a.get("intensity", 2)
    int_b = tags_b.get("intensity", 2)

    # 判断碰撞类型
    common_moods = set(mood_a) & set(mood_b)
    collision_type = "共振" if common_moods else "反差"
    era_gap = f"{era_a}×{era_b}" if era_a and era_b and era_a != era_b else ""

    prompt = (
        "你是「私宇宙」的语义碰撞引擎。两个来自不同领域的素材相撞，"
        "会诞生一个新的宇宙意象。\n\n"
        f"素材甲（{dom_a}·{era_a}）：「{text_a}」—— {src_a}\n"
        f"  情绪：{mood_a}，主题：{theme_a}，强度：{int_a}/5\n"
        f"素材乙（{dom_b}·{era_b}）：「{text_b}」—— {src_b}\n"
        f"  情绪：{mood_b}，主题：{theme_b}，强度：{int_b}/5\n"
        f"碰撞类型：{collision_type}" + (f"，时空跨度：{era_gap}" if era_gap else "") + "\n\n"
        "请融合两者的主题与情绪，生成一句新的意象文本。要求：\n"
        "1. 富有诗意与宇宙感，让两个素材的意象在碰撞中变形、融合、升华\n"
        "2. 如果是共振碰撞，强化共同情绪；如果是反差碰撞，让对立产生张力\n"
        "3. 中文，15-50 字\n"
        "4. 只输出这一句话，不要解释、不要引号、不要标点以外的符号"
    )

    last_err = None
    for attempt in range(3):
        try:
            resp = requests.post(
                f"{config.DEEPSEEK_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {config.DEEPSEEK_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": config.DEEPSEEK_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 200,
                    "temperature": 0.85,
                },
                timeout=60,
            )
            resp.raise_for_status()
            data = resp.json()
            text = data["choices"][0]["message"]["content"].strip().strip("「」\"'""''")
            if text:
                mood = _pick_mood(mood_a, mood_b)
                return {"text": text, "mode": "deepseek", "mood": mood}
            # 空文本则重试
            print(f"  [DeepSeek 返回空文本，第{attempt+1}次重试…]")
        except Exception as e:
            last_err = e
            print(f"  [DeepSeek 调用失败，第{attempt+1}次重试] {e}")
    if last_err:
        raise last_err
    raise RuntimeError("DeepSeek 连续3次返回空文本")


def collide(content_a, content_b):
    """
    语义碰撞入口。优先 DeepSeek，失败降级本地。
    返回 {"text": str, "mode": "deepseek"|"local", "mood": str}
    """
    if config.deepseek_available():
        try:
            return collide_api(content_a, content_b)
        except Exception as e:
            print(f"  [DeepSeek 调用失败，降级本地] {e}")
    return collide_local(content_a, content_b)
