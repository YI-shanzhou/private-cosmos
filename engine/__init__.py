"""
engine — 私宇宙演化引擎（Python 包）

模块结构（单一数据流，无循环依赖）：
    source_loader → pairing → collider → body_factory → chronicler
    ↑                                  ↑
    └──── config ──┴── utils（公共工具）─┘

对外 CLI：engine.evolve（薄入口）
"""
