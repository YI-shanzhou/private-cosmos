"""
models.py — 私宇宙数据模型（dataclass）

定义 Source / CelestialBody / ChronicleEntry / DailyReport。
天体实际以 dict 落盘（与现有 cosmos.json 结构一致），
dataclass 用于类型契约与可测试性，不承担序列化职责。
"""
from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass
class Source:
    """领域素材。"""
    id: str
    text: str = ""
    title: str = ""
    source: str = ""
    composer: str = ""
    domain: str = ""
    tags: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CelestialBody:
    """天体（对应 cosmos.json 单条记录）。"""
    id: str
    type: str
    type_cn: str
    name: str
    epoch: int
    born_at: str
    collision_text: str
    collision_mode: str
    parents: List[str] = field(default_factory=list)
    composition: Dict[str, Any] = field(default_factory=dict)
    tags: Dict[str, Any] = field(default_factory=dict)
    visual: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ChronicleEntry:
    """编年史条目（对应 chronicle.json 单条记录）。"""
    epoch: int
    timestamp: str
    event: str
    body_id: str
    summary: str = ""


@dataclass
class DailyReport:
    """每日宇宙报告。"""
    date: str
    summary: str = ""
    body_count: int = 0
    new_bodies: List[Dict[str, str]] = field(default_factory=list)
    mood_distribution: Dict[str, int] = field(default_factory=dict)
    domain_distribution: Dict[str, int] = field(default_factory=dict)
    lineage_count: int = 0
    triple_count: int = 0
