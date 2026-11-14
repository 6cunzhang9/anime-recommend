# 本命番鉴定所 · Anime Soul Lab v2

一个可本地运行、也可部署到 Netlify 的观看偏好测试：用 **Big Five 五维心理画像 + 显式内容偏好 + 观看习惯 + 双平台口碑质量门槛**，从一部有明确入选标准的番剧池中给出可解释推荐；最后收集用户真实最喜欢的番和理由，为之后回测与权重校准留下结构化样本。

本地直接打开不需要安装依赖；Netlify 部署版附带 Serverless Functions 和 Netlify Blobs 持久化存储。

## 这次升级了什么

v1 只有 4 个类 MBTI 维度和 36 部作品，过于依赖性格、番剧池也太小。v2 的处理是：

1. **换掉 4 维/16 型**：心理部分参考公开领域 IPIP 的 Big Five 测量结构，使用 20 个正反向条目，输出 5 个连续维度，不再给用户贴“四个字母”的死标签。
2. **显式偏好优先于性格**：新增 9 项内容偏好和 6 项观看习惯。推荐权重中，直接口味占 50%，Big Five 只占 14%。喜欢什么不再全部归因于性格。
3. **候选番扩大到 150 条，148 条通过质量门槛**：数据来自 AniList 与 MyAnimeList 的社区聚合字段，并在构建时做质量筛选，不再用单条论坛评论当推荐依据。数据实验室里可以展开查看全部 148 部候选。
4. **增加数据质量校验**：37 题中嵌入 2 道注意力校验，另有反向计分、直线作答检测与最短完成时长标记；服务端会从原始作答重新计算人格分数与注意力结果，而不是直接相信前端传来的 `valid` / 分数。被污染/不认真的样本仍保留可复核，但不计入有效统计。
5. **推荐理由可解释**：每部推荐展示 MAL / AniList 评分、MAL 评分人数、制作公司、口碑等级、潜在劝退点和匹配理由。权重直接显示在结果页，每张卡还可展开查看各分项匹配度。
6. **结果页按转化顺序重排**：观看画像 → 推荐番摘要 → 填写真实本命 → 详细推荐理由 → 五维与口味分析。提交后页面不跳转，确认卡下方仍可直接继续看推荐理由。

## 快速开始

### 方式一：直接打开（只在本机保存）

双击 `index.html`。测试、推荐、本命填表和「数据实验室」都能运行，数据保存在当前浏览器的 `localStorage` 中，可导出。

### 方式二：启动本地收集服务（推荐）

需要 Node.js 18+，无需安装第三方依赖：

```bash
cd anime-soul-lab
npm start
```

打开 <http://127.0.0.1:4173>。通过服务运行时，勾选匿名保存的样本会写入 `data/responses.jsonl`，并可在「数据实验室」导出 JSON/CSV。

只检查语法：

```bash
npm run check
```

重新抓取/生成番剧数据（联网）：

```bash
npm run build:catalog
```

> 本地 `npm start` 仍然只写 `data/responses.jsonl`，不依赖 Netlify。`npm install` 安装的 `@netlify/blobs` 只在 Netlify Functions 里使用。

## 部署到 Netlify（含数据收集）

### 部署后的运作方式

```text
访问者浏览器
   │
   ├─ 静态页面 ─────────────  Netlify CDN（只发布 dist/，不暴露 server.js / data/）
   │
   └─ POST /api/responses ── Netlify Function ── Netlify Blobs（持久化匿名样本）
                              GET /api/stats       公开聚合数据
                              GET /api/export      需要 ADMIN_TOKEN
```

- 网页、番剧数据和测试逻辑全部静态托管。
- 提交样本时调用 `/api/responses`，由 Function 重新校验答案、Big Five、注意力检查和直接偏好，再写入 Netlify Blobs。
- 数据实验室的候选池和聚合统计公开；原始理由和逐份样本只有输入管理员密钥才能导出。
- Netlify Blobs 的默认区域是 `ap-southeast-1`（新加坡）；可用环境变量 `BLOBS_REGION` 调整。
- 仓库已经包含 `netlify.toml`、`netlify/functions/` 和 `scripts/build-netlify.mjs`。

### 第 1 步：本地构建/检查

```bash
npm install
npm run build:netlify
```

构建会生成 `dist/`。它只包含 `index.html`、`app.js`、`styles.css`、`test-data.js`、`catalog.js`、`robots.txt`，不会把 `server.js`、`data/` 或构建脚本发布出去。

> **不要只用 Netlify Drop 拖拽 `dist/`。** 那样只会部署静态页面，`/api/*` 不存在，访客提交只会留在他们自己的浏览器里。必须让 Netlify 从仓库构建，或使用 `netlify deploy --build --prod` 把 Functions 一起发布。

### 第 2 步：推送到 Git

推荐用 Git 连接 Netlify，这样每次 push 都能自动构建：

```bash
git init
git add .
git commit -m "Deploy anime soul lab"
# 在 GitHub / GitLab 建一个空仓库后：
git remote add origin <你的仓库地址>
git push -u origin main
```

`.gitignore` 已排除 `node_modules/`、`dist/`、`.netlify/`、`data/responses.jsonl` 和管理员 Token 等运行时文件。`package-lock.json` 应当提交。

### 第 3 步：在 Netlify 导入项目

1. 登录 [Netlify](https://app.netlify.com/)。
2. **Add new project → Import an existing project**，选择你的 Git 仓库。
3. Netlify 会读取 `netlify.toml`：
   - Build command: `npm run build:netlify`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
4. 首次部署后会得到类似 `https://your-site.netlify.app` 的地址，先用它验证完整流程。

如果你想用 CLI 部署：

```bash
npm install -g netlify-cli
netlify login
netlify init
netlify env:set ADMIN_TOKEN "<你的随机密钥>"
netlify deploy --build --prod
```

### 第 4 步：设置管理员密钥

Netlify 控制台 → **Project configuration → Environment variables**：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `ADMIN_TOKEN` | 是 | 导出原始样本所需的长随机密钥，绝不要写进前端或 Git |
| `BLOBS_REGION` | 否 | Blobs 区域，默认 `ap-southeast-1` |
| `BLOBS_STORE_NAME` | 否 | Blobs store 名称，默认 `anime-soul-responses` |

生成一个强随机 Token：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

把输出粘贴到 Netlify 的 `ADMIN_TOKEN`，保存后重新部署（Deploys → Trigger deploy）。这个密钥之后在网页「数据实验室 → 管理员导出」里填写；它只保存在当前标签页的 `sessionStorage`，不会写入样本。

> 如果没配置 `ADMIN_TOKEN`，`/api/export` 会返回 503，而不是把原始理由公开。

### 第 5 步：配置自定义域名

1. 在 Netlify 打开项目 → **Domain management → Add a domain**，输入你购买的域名，例如 `animelab.example.com`。
2. 如果你用 **Netlify DNS**：按 Netlify 提示修改域名注册商的 nameserver。
3. 如果用**外部 DNS**：
   - 子域名（如 `www`、`app`）：添加 **CNAME**，指向 `your-site.netlify.app`。
   - 裸域名（如 `example.com`）：使用支持 ALIAS/ANAME/flattened CNAME 的记录指向 `apex-loadbalancer.netlify.com`；没有这类记录时，Netlify 文档给出的回退方案是 A 记录 `75.2.60.5`。
4. 保存后等待 DNS 生效；Netlify 会自动签发 HTTPS 证书。以 Netlify 控制台**Pending DNS verification**里给的记录为准。
5. 建议把主域名设为 `www` 或一个有稳定 CNAME 的子域名，裸域跳转到它。

> Netlify 在中国大陆的访问速度和稳定性不保证。如果主要受众在大陆，先用目标网络实测；必要时再考虑 Cloudflare 或其他海外 CDN 方案（大陆节点涉及备案）。

### 第 6 步：验证收集链路

1. 打开 `https://你的域名/api/health`，应返回 `{ "ok": true, "storage": "netlify-blobs" }`。
2. 完整做一遍测试并提交本命。在「数据实验室」应看到样本数 +1。
3. 打开「管理员导出」，输入 Netlify 的 `ADMIN_TOKEN`，导出 JSON/CSV。
4. Netlify 控制台 → **Data & Storage → Blobs**，打开 `anime-soul-responses` store，可以在 UI 里查看 `responses/` 下的原始样本键。
5. 如果不填 Token 点导出，应被拒绝（401/403）；填错也应被拒绝。

### 数据规模与后续升级

Netlify Blobs 适合早期项目：无需另开数据库、直接持久化、可在 UI 浏览和导出。但 `stats` 和 `export` 是列出并读取样本，样本量很大后会变慢，也不支持 SQL 聚合。

当样本接近数千份、或需要做分组分析/训练排序模型时，建议迁移到 **Supabase / Neon / Netlify Database（Postgres）**：

- 一张 `responses` 表保存 JSONB 原始样本和关键索引列；
- 用 SQL 直接算命中率、按 archetype 分组、比较理由文本；
- Functions 仍然保留，只换持久层；
- 继续用 `ADMIN_TOKEN` 保护导出和管理接口。

当前 Netlify 实现把存储访问集中在 `netlify/shared/store.mjs`，迁移时不需要改前端评分逻辑。

### 防滥用建议

- Functions 已配置基础 IP 速率限制（`netlify.toml` / Functions `config.rateLimit`）；实际额度以 Netlify 套餐为准。
- 公开传播前建议加 **Cloudflare Turnstile / hCaptcha**，并在 `responses` Function 里服务端校验。
- 不要把原始导出接口暴露成无需 Token 的公开链接。
- 设置数据保留期限，并在页面隐私说明中写清用途；不要收集姓名、手机号等不必要信息。

## 题目构成

共 **37 题**，预计 6–8 分钟：

| 模块 | 数量 | 说明 |
| --- | ---: | --- |
| Big Five 自评 | 20 | 5 个维度各 4 题，正反向条目混合；参考 IPIP / Mini-IPIP 的测量思路，中文条目为本项目改写 |
| 内容偏好 | 9 | 奇幻、科幻、日常治愈、热血、悬疑、恋爱、黑暗、喜剧、运动；直接问“想看程度” |
| 观看习惯 | 6 | 逃离现实、意义反思、社交话题、作画演出、声音音乐、快节奏 |
| 注意力校验 | 2 | 嵌在题序中；不通过会标记样本，不阻断结果 |

心理维度：

- Openness 开放性
- Conscientiousness 尽责性
- Extraversion 外向性
- Agreeableness 宜人性
- Emotional Sensitivity 情绪敏感度（高敏感/波动的一端）

> 这不是临床心理测评，也不声称等同于完整 IPIP 量表或经过中文常模验证。它只是把项目可解释的多维信号用于娱乐向推荐。分数是本次作答的相对分数，不是人群百分位。

## 推荐算法

```text
综合匹配 =
  0.50 × 直接内容偏好匹配
+ 0.18 × 双平台口碑质量
+ 0.14 × Big Five 启发式内容倾向
+ 0.10 × 观看习惯匹配
+ 0.08 × 制作/声音信号匹配
```

- **直接内容偏好**：对 9 类内容打分（1–5）。高偏好的类型会加分，明确低偏好的类型会形成惩罚，而不是只看“像不像性格”。
- **Big Five 辅助项**：仅作为弱信号。Big Five → 类型气质的映射是编辑设定的启发式，不是心理学因果结论。
- **口碑质量**：来自 AniList 社区均分与 MyAnimeList 加权评分，结合评分人数；不是“制作评分”。作品需通过以下门槛才进入推荐：
  - 加权口碑 ≥ 7.5 / 10
  - MAL 评分人数 ≥ 12,000
  - AniList 均分 ≥ 70
- **制作信号**：使用公开的 AniList 制作公司信息、音乐/视觉信号和制作公司背景说明；它帮助解释，不替代作品评价。
- **展示匹配分**：把内部加权结果校准到 70–98 的排序指数。它不是概率，也不是对作品质量的判断。

### 为什么不用单条论坛言论

论坛里“神作/垃圾”的极端发言、玩梗和串子会污染特征。本项目只使用稳定平台上的聚合评分、评分人数、收藏、类型标签和制作公司，并设置最低样本量。原始单条评论不进入推荐计算，也不写入研究数据。

口碑源：

- [AniList](https://anilist.co/)：社区均分、热度、收藏、类型标签、制作公司
- [MyAnimeList](https://myanimelist.net/)：加权社区评分、评分人数、成员数、收藏、排名

数据快照：**2026-11-14**。评分会随时变化，因此构建快照版本会随导出样本一起保存。

## 样本结构与可信性

样本（`schemaVersion: 2`）保留：

```json
{
  "schemaVersion": 2,
  "testVersion": "2.0.0",
  "algorithmVersion": "hybrid-fit-v2",
  "answers": [
    { "id": "q-01", "itemKey": "O1", "section": "personality", "value": 4, "reverse": false }
  ],
  "scores": {
    "bigFive": { "O": 78, "C": 61, "E": 43, "A": 72, "N": 66 },
    "preferences": { "fantasy": 5, "mystery": 4 },
    "habits": { "visual": 4, "music": 3 }
  },
  "archetype": { "key": "O+C", "name": "世界构建师" },
  "quality": {
    "valid": true,
    "attentionPassed": true,
    "straightLining": false,
    "durationSeconds": 324,
    "flags": []
  },
  "recommendations": [
    { "rank": 1, "animeId": "baccano", "matchPercent": 86, "qualityScore": 8.2 }
  ],
  "actualFavorite": {
    "title": "虫师",
    "reason": "它让我反复想起那些安静的山和雨。",
    "matchStatus": "catalog",
    "predictedRank": 13
  },
  "consent": true
}
```

数据质量规则：

- 两个注意力校验都通过；
- 20 个人格条目不能呈明显直线作答（标准差低于 0.38 即标记）；
- 完成时长 ≥ 75 秒；
- 三条全部通过才计入有效样本。被标记样本仍会保留在原始导出中，方便之后复查和重新定义清洗规则。

这些规则不能保证绝对真实，但能过滤明显敷衍、脚本化或误答的样本，比直接收集最终类型标签更可复核。服务端会重新计算 Big Five、内容偏好、观看习惯、注意力结果和直线作答标记；完成时长仍由客户端上报，无法完全防止伪造，这是本地方案的限制，正式研究应配合受控问卷平台。

数据实验室还可以展开 **148 部候选番池**，查看每部作品的双平台加权口碑、制作公司和主要标签；候选池展示的是数据库快照，不是本次推荐榜单。

## 服务端 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查，前端据此切换本地/服务端保存 |
| `POST` | `/api/responses` | 保存一份 `schemaVersion: 2` 且 `consent: true` 的匿名样本 |
| `GET` | `/api/stats` | 返回原始样本数、有效样本数、被标记数、理由数与 Top 3 命中率 |
| `GET` | `/api/export?format=jsonl` | 导出 JSONL；也支持 `json`、`csv`；需要 `ADMIN_TOKEN`（如果配置了） |

本地 Node 服务只提供白名单静态文件，不暴露 `data/`；默认监听 `127.0.0.1`。Netlify 版只发布 `dist/`，Functions 通过 Netlify Blobs 持久化。两条路径都有请求体大小限制、字段校验和服务端重新计分；Netlify 版额外有平台级速率限制。

## 文件结构

```text
anime-soul-lab/
├─ index.html                 页面结构
├─ styles.css                 视觉、响应式与图表样式
├─ app.js                     答题、Big Five 计分、混合排序、本命收集、数据实验室
├─ test-data.js               37 道题、5 维度、9 内容偏好、6 观看习惯、数据质量规则
├─ catalog.js                 构建生成的 150 条番剧数据（148 条通过门槛）
├─ server.js                  本地静态服务与匿名样本 API
├─ netlify.toml               Netlify 构建、发布、函数与安全头配置
├─ netlify/
│  ├─ functions/              health / responses / stats / export 四个 Functions
│  └─ shared/                 Netlify Blobs 读写、管理员鉴权、共享校验
├─ scripts/
│  ├─ catalog-seed.mjs        人工初选目标作品
│  ├─ build-catalog.mjs       AniList + MAL 抓取、标签映射、质量门槛与 catalog.js 生成
│  ├─ build-netlify.mjs       只把前端与数据复制到 dist/
│  └─ catalog-build-report.json
├─ data/
│  ├─ .gitkeep
│  └─ responses.jsonl         本地服务运行后生成，已被 .gitignore 忽略
├─ package.json
├─ package-lock.json
└─ README.md
```

## 已知局限

- 148 部仍然不是“所有值得看的番”。它是一个可解释、质量可控的初始池，而不是完整动画数据库。
- Big Five 四题一维是短量表；结果适合作为对话起点，不适合作为严肃人格测量。
- AniList / MAL 的评分人群并不代表所有观众，英语社区与华语社区偏好也可能不同。
- 目前没有用真实用户反馈训练模型，权重仍是人工设定。收集到足够样本后，更适合先做离线回测、分层分析，再考虑学习排序；在样本量不足时直接“AI 训练”容易过拟合。
- 候选番质量门槛会漏掉一些争议作品或小众佳作；这是“避免推荐明显烂番”的代价。

## 隐私与部署提醒

- 只有勾选「匿名保存」时才会保存本命和理由；取消勾选则不落库。
- 用户原始理由只进入聚合分析和受保护导出，不会在当前页面匿名展示或公开署名；如果以后要做“同好理由墙”，必须新增单独的选择加入（opt-in）、审核与删除机制。
- 前端不请求姓名、账号、定位或设备标识；样本里不写 IP。Netlify 平台自身仍可能在访问日志/指标中处理 IP，需在隐私说明中如实披露。
- Netlify 版和设置了 `ADMIN_TOKEN` 的本地版，原始导出需要管理员密钥；聚合统计仍公开。
- 清理本地数据：浏览器开发者工具 → Application → Local Storage；本地服务数据：删除 `data/responses.jsonl`；Netlify 数据：在 Data & Storage → Blobs 中删除对应键，或后续在后台增加批量清理。
- 公开上线前请补充明确的用途、保留期限、联系方式和撤回/删除方式；如果面向儿童或需要更严格合规，请先咨询专业人士。
- 作品名称与相关权利归原作者及权利方所有；本页不使用官方图片或视频素材。

## 参考

- [IPIP 官方说明](https://www.ipip.ori.org/)：公开领域人格条目库与 Big Five 测量资料
- [Donnellan et al. (2006), Mini-IPIP scales](https://doi.org/10.1037/1040-3590.18.2.192)
- [AniList](https://anilist.co/) 与 [AniList GraphQL API](https://docs.anilist.co/)
- [MyAnimeList](https://myanimelist.net/) 的公开作品页与社区评分
- [Netlify Functions API](https://docs.netlify.com/build/functions/api/) 与 [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- [Netlify 外部 DNS 自定义域名配置](https://docs.netlify.com/manage/domains/configure-domains/configure-external-dns/)
- 使用与满足 / 情绪调节媒体研究为本项目“观看动机”维度提供了概念启发；本项目没有声称这些条目来自已验证的单一量表。
