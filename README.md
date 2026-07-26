# 🌌 私宇宙 Private Cosmos

> 一个会自己长大的生成式宇宙。每一颗天体，都诞生自两个不同领域素材的 AI 语义碰撞。

## 这是什么

「私宇宙」是一个生成式艺术项目。它每天自动运行：

1. **捞取** — 从 NASA APOD 拉取每日天文图片
2. **碰撞** — 从文学、哲学、艺术、神话、天文五个领域随机抽取两个素材
3. **生成** — 调用 DeepSeek V4 大模型，让两个素材"撞"出一个新的宇宙意象
4. **诞生** — 根据碰撞结果生成一颗新天体（星云、黑洞、脉冲星…），写入宇宙总表

宇宙每天自动长大，永不停歇。

## 在线 demo

<!-- 部署后替换为你的 GitHub Pages 地址 -->
`https://你的用户名.github.io/private-cosmos/`

## 效果示例

> 西西弗斯推石上山 × 孤独的牧羊人
> → "牧羊人推着滚落的星辰，在永恒的山坡上放牧寂静"

> 李清照「天接云涛连晓雾」 × NASA木星红外照片
> → "星云如涛涌向木星腰际，红外漩涡里千帆舞动未名风暴"

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/你的用户名/private-cosmos.git
cd private-cosmos
```

### 2. 配置 API 密钥

```bash
cp .env.example .env
```

编辑 `.env`，填入你的密钥：

```
NASA_API_KEY=你的NASA密钥      # 去 https://api.nasa.gov/ 免费注册
DEEPSEEK_API_KEY=sk-你的密钥   # 去 https://platform.deepseek.com/ 注册
```

### 3. 安装依赖

```bash
pip install requests Pillow
```

### 4. 运行

```bash
# 拉取一张 NASA 天文图
python engine/fetch_apod.py

# 演化 3 个新天体
python engine/evolve.py --count 3

# 启动本地预览
python -m http.server 8765 --directory web
```

浏览器打开 `http://localhost:8765` 即可看到星空图。

## 自动演化

项目已配置 GitHub Actions，每天凌晨 2 点（北京时间）自动：

1. 拉取当日 NASA APOD
2. 演化 2 个新天体（DeepSeek 真实碰撞）
3. 更新星空页面
4. 自动部署到 GitHub Pages

**无需电脑开机**，GitHub 服务器替你运行。

### 配置 Secrets

在 GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret，添加：

| Name | Value |
|------|-------|
| `NASA_API_KEY` | 你的 NASA API key |
| `DEEPSEEK_API_KEY` | 你的 DeepSeek API key（以 sk- 开头）|

## 自定义

### 换素材

编辑 `data/` 目录下的 JSON 文件：

- `literature.json` — 文学素材（诗句）
- `philosophy.json` — 哲学素材（命题/金句）
- `music.json` — 艺术素材（音乐片段）
- `myth.json` — 神话素材
- `apod.json` — 天文素材（自动生成）

每条素材格式：

```json
{
  "id": "lit_01",
  "text": "星垂平野阔，月涌大江流",
  "source": "杜甫《旅夜书怀》",
  "tags": { "moods": ["辽阔", "苍凉"], "domain": "literature", "theme": "星空" }
}
```

### 改规则

编辑 `engine/evolve.py` 中的 `BODY_TYPES`、`MOOD_COLORS`、`NAME_PREFIXES` 来自定义天体类型、配色和命名。

### 调视觉

编辑 `web/private-cosmos-skymap.html` 和 `web/assets/charts.js`。

## 技术栈

- **引擎**：Python + DeepSeek V4 API + NASA APOD API
- **前端**：原生 HTML/CSS/JS + ECharts
- **自动化**：GitHub Actions
- **部署**：GitHub Pages

## 项目结构

```
private-cosmos/
├── engine/           # 演化引擎
│   ├── config.py         # 配置加载
│   ├── evolve.py         # 四阶段演化引擎
│   ├── deepseek_client.py # AI 语义碰撞
│   └── fetch_apod.py     # NASA 天文图捞取
├── data/             # 素材池 + 宇宙数据
│   ├── cosmos.json       # 天体总表
│   ├── chronicle.json    # 演化编年史
│   └── *.json            # 各领域素材
├── scripts/          # 工具脚本
├── web/              # 星空可视化页面
├── .github/workflows/ # GitHub Actions
└── .env              # API 密钥（不提交）
```

## License

MIT — 随意取用，改成你自己的宇宙。

---

🌌 **让宇宙自己长大。**
