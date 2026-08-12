"""
body_factory.py — 天体工厂（类型/颜色/命名/世代）

从原 engine/evolve.py 提取常量 + stage_controlled_random
及辅助函数 _get_type_family / _get_child_type / _adjust_color。
"""
import random


# ---- 天体类型库：主导情绪 → 候选天体 (英文, 中文) ----
BODY_TYPES = {
    "壮阔": [("nebula", "星云"), ("galaxy", "星系"), ("supervoid", "超空洞")],
    "辽阔": [("galaxy", "星系"), ("cluster", "星团"), ("supervoid", "超空洞")],
    "苍凉": [("white_dwarf", "白矮星"), ("remnant", "遗迹"), ("void", "虚空")],
    "孤寂": [("comet", "彗星"), ("rogue_planet", "流浪行星"), ("void", "虚空")],
    "宁静": [("planet", "行星"), ("moon", "卫星"), ("dust_cloud", "尘埃云")],
    "诡谲": [("black_hole", "黑洞"), ("dark_matter", "暗物质"), ("wormhole", "虫洞")],
    "激烈": [("supernova", "超新星"), ("magnetar", "磁星"), ("kilonova", "千新星")],
    "激越": [("pulsar", "脉冲星"), ("quasar", "类星体"), ("blazar", "耀变体")],
    "神秘": [("dark_matter", "暗物质"), ("wormhole", "虫洞"), ("dark_nebula", "暗星云")],
    "希望": [("star", "恒星"), ("protostar", "原恒星"), ("blue_giant", "蓝巨星")],
    "未知": [("dust_cloud", "尘埃云"), ("rogue_planet", "流浪行星"), ("void", "虚空")],
}

# 情绪 → 主色（与项目美学一致：星海深空 × 暗物质）
MOOD_COLORS = {
    "壮阔": "#6D5AE6", "辽阔": "#0EA5E9", "苍凉": "#64748B",
    "孤寂": "#475569", "宁静": "#14B8A6", "诡谲": "#7C3AED",
    "激烈": "#F2715E", "激越": "#F2C94C", "神秘": "#8B5CF6",
    "希望": "#FBBF24", "未知": "#8A86A8",
}

# 命名词缀
NAME_PREFIXES = ["幽", "寂", "焰", "渊", "辉", "尘", "弦", "墟", "澜", "渺", "魄", "茫"]

# 天体类型家族（用于世代继承）
TYPE_FAMILIES = {
    "stellar": ["star", "protostar", "blue_giant", "white_dwarf", "supernova", "kilonova", "pulsar", "magnetar", "blazar", "quasar"],
    "void": ["black_hole", "dark_matter", "wormhole", "dark_nebula", "void", "supervoid"],
    "nebulous": ["nebula", "dust_cloud", "galaxy", "cluster"],
    "wandering": ["comet", "rogue_planet", "planet", "moon", "remnant"],
}


def _get_type_family(type_en):
    """获取天体类型所属家族。"""
    for family, types in TYPE_FAMILIES.items():
        if type_en in types:
            return family
    return "wandering"


def _get_child_type(parent_type_en, parent_mood):
    """从父代类型家族中选取子代类型（可能相同或变异）。"""
    family = _get_type_family(parent_type_en)
    family_types = TYPE_FAMILIES.get(family, ["dust_cloud"])
    # 60% 保持同类型，40% 变异到同家族其他类型
    if random.random() < 0.6:
        return parent_type_en
    others = [t for t in family_types if t != parent_type_en]
    if others:
        return random.choice(others)
    return parent_type_en


def _adjust_color(hex_color, delta=30):
    """微调色相（在 RGB 空间简单随机偏移）。"""
    hex_color = hex_color.lstrip("#")
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    r = max(0, min(255, r + random.randint(-delta, delta)))
    g = max(0, min(255, g + random.randint(-delta, delta)))
    b = max(0, min(255, b + random.randint(-delta, delta)))
    return f"#{r:02x}{g:02x}{b:02x}"


def stage_controlled_random(result, a, b, parent_body=None):
    """阶段三·受控随机：决定天体类型、颜色、亮度、命名。

    如果提供 parent_body，则进入世代模式（子代继承父代特征）。
    """
    mood = result["mood"]

    if parent_body:
        # 世代模式：继承父代特征
        parent_type = parent_body.get("type", "dust_cloud")
        child_type_en = _get_child_type(parent_type, mood)
        # 找中文名
        child_type_cn = "尘埃云"
        for types_list in BODY_TYPES.values():
            for te, tc in types_list:
                if te == child_type_en:
                    child_type_cn = tc
                    break
        parent_color = parent_body.get("visual", {}).get("color", MOOD_COLORS.get(mood, "#8A86A8"))
        color = _adjust_color(parent_color, 25)
        size = round(max(0.15, parent_body.get("visual", {}).get("size", 0.5) + random.uniform(-0.2, 0.2)), 2)
        luminosity = round(max(0.1, min(1.0, parent_body.get("visual", {}).get("luminosity", 0.5) + random.uniform(-0.15, 0.15))), 2)

        # 命名：父代核心 + 新情绪
        parent_name = parent_body.get("name", "无名")
        name_core = parent_name.split("·")[0] if "·" in parent_name else parent_name[:2]
        name = f"{name_core}·{mood}·子"
        return {
            "type_en": child_type_en, "type_cn": child_type_cn,
            "color": color, "size": size, "luminosity": luminosity,
            "name": name, "mood": mood,
        }

    # 正常模式
    type_en, type_cn = random.choice(BODY_TYPES.get(mood, [("dust_cloud", "尘埃云")]))
    color = MOOD_COLORS.get(mood, "#8A86A8")
    size = round(random.uniform(0.3, 1.0), 2)
    luminosity = round(random.uniform(0.2, 1.0), 2)

    # 命名：前缀 + 主题首两字 + 情绪
    prefix = random.choice(NAME_PREFIXES)
    theme_a = a.get("tags", {}).get("theme", "")
    theme_b = b.get("tags", {}).get("theme", "")
    core = (theme_a or theme_b or "无名")
    core = core[:2] if len(core) >= 2 else core
    name = f"{prefix}{core}·{mood}"

    return {
        "type_en": type_en, "type_cn": type_cn,
        "color": color, "size": size, "luminosity": luminosity,
        "name": name, "mood": mood,
    }
