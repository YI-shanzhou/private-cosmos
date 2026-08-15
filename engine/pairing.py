"""
pairing.py — 配对策略（随机/共振/反差/三体）

从原 engine/evolve.py 提取 stage_rule_evolve 及私有
_pair_resonance / _pair_contrast（必须同迁，否则运行时 NameError）。
"""
import random


def _pair_resonance(sources, by_domain, domains):
    """共振配对：寻找跨领域但有共同情绪的素材对。"""
    # 收集所有 (mood, source) 并按情绪分组
    mood_index = {}
    for s in sources:
        for m in s.get("tags", {}).get("moods", []):
            mood_index.setdefault(m, []).append(s)

    # 找有跨领域共同情绪的组合
    candidates = []
    for mood, items in mood_index.items():
        by_dom = {}
        for item in items:
            by_dom.setdefault(item["_domain"], []).append(item)
        doms = list(by_dom.keys())
        if len(doms) >= 2:
            dom_a, dom_b = random.sample(doms, 2)
            a = random.choice(by_dom[dom_a])
            b = random.choice(by_dom[dom_b])
            candidates.append((a, b))

    if candidates:
        return random.choice(candidates)
    return None


def _pair_contrast(sources, by_domain, domains):
    """反差配对：寻找情绪不同、强度差异大的跨领域素材对。"""
    # 按强度分层
    high = [s for s in sources if s.get("tags", {}).get("intensity", 2) >= 4]
    low = [s for s in sources if s.get("tags", {}).get("intensity", 2) <= 2]

    if not high or not low:
        return None

    # 尝试找跨领域的高低组合
    for _ in range(20):
        a = random.choice(high)
        b = random.choice(low)
        if a["_domain"] != b["_domain"]:
            # 确认情绪不重叠
            moods_a = set(a.get("tags", {}).get("moods", []))
            moods_b = set(b.get("tags", {}).get("moods", []))
            if not moods_a & moods_b:
                return a, b

    # fallback: 任意跨领域高低组合
    for _ in range(10):
        a = random.choice(high)
        b = random.choice(low)
        if a["_domain"] != b["_domain"]:
            return a, b
    return None


def stage_rule_evolve(sources, force_mode=None):
    """阶段一·规则演化：跨领域配对选材。

    四种配对模式随机切换：
    - random: 纯随机跨领域（原始模式）
    - resonance: 情绪共振——找有共同情绪的跨领域素材
    - contrast: 情绪反差——找情绪完全不同、强度差异大的素材
    - triple: 三体碰撞——从三个不同领域各选一个素材

    force_mode（调试/验收用，None 保持默认随机行为）：
    - "triple": 强制三体碰撞（域不足3个时返回 None）
    - "dual":   强制两体碰撞（跳过三体概率）
    """
    by_domain = {}
    for s in sources:
        by_domain.setdefault(s["_domain"], []).append(s)
    domains = list(by_domain.keys())
    if len(domains) < 2:
        if len(sources) >= 2:
            return random.sample(sources, 2)
        return None

    # 强制三体但域不足 3 个：按声明返回 None（由上游打印配对失败）
    if force_mode == "triple" and len(domains) < 3:
        return None

    # 三体碰撞：force_mode="triple" 必走；"dual" 必不走；默认 30% 概率
    if force_mode != "dual" and len(domains) >= 3 and (
        force_mode == "triple" or random.random() < 0.3
    ):
        doms = random.sample(domains, 3)
        a = random.choice(by_domain[doms[0]])
        b = random.choice(by_domain[doms[1]])
        c = random.choice(by_domain[doms[2]])
        return a, b, c

    mode = random.choice(["random", "resonance", "contrast"])

    if mode == "resonance":
        pair = _pair_resonance(sources, by_domain, domains)
        if pair:
            return pair
    elif mode == "contrast":
        pair = _pair_contrast(sources, by_domain, domains)
        if pair:
            return pair

    # fallback: 原始随机配对
    dom_a, dom_b = random.sample(domains, 2)
    a = random.choice(by_domain[dom_a])
    b = random.choice(by_domain[dom_b])
    return a, b
