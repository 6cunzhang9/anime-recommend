# 本命番推荐所 · Anime Soul Lab v3

一个可本地运行、也可部署到 Netlify 的观看偏好测试：

**Big Five 五维心理画像 + 显式内容偏好 + 观看习惯 + 4 道情境选择 + 双平台口碑质量门槛**，从 148 部通过口碑筛选的候选番中给出可解释推荐；最后一步收集用户真正的本命与理由，并在结果页对每部推荐自动记录「喜欢 / 无感 / 不喜欢 / 未看过」。

本地直接打开不需要安装依赖；Netlify 部署版附带 Serverless Functions、Netlify Blobs 持久化和受保护的数据导出。

## v3 按要求所做的修改

1. **每部推荐增加即时反馈**：结果页每部番下方有「喜欢 / 无感 / 不喜欢 / 未看过」四个选项。点击后立即写入，不需要二次确认；反馈按 `responseId + animeId` 归并到对应样本，导出时自动合并。
2. **本命填写移到最后一题**：完成 41 道测试题后，进入「最后一步 · 42 / 42」，先填写目前最喜欢的番（必填）和理由（选填），提交后才生成推荐。这样落库的每份完整样本都带有真实本命，不会出现“有结果但没有本命”。
3. **刷新/再次进入可恢复**：测试进度、最后一步草稿、最近一次结果和推荐反馈都保存在浏览器本机；同一标签页刷新会自动恢复当前页面，重新打开网站会显示「查看上次结果 / 继续测试」入口。
4. **白色极简界面**：开始页为白底、中央「本命番推荐所」标题、绿色「开始测试」按钮、下方测试时长与数据说明，最下方保留「它是怎么工作的」。测试、最后一步、结果和数据弹窗统一为白色、绿色主操作、低对比边框与轻微淡入，不再使用大面积深色、光晕和装饰性图形。
5. **封面与剧情简介**：150 部候选全部补充了封面（已下载到本地 `assets/covers/`，不依赖外部图床）和一句简短剧情简介；推荐卡以封面帮助快速识别，主要信息仍以下方推荐理由为主。
6. **增加题型并控制时长**：在原来 5 点量表之外增加 4 道情境题——两道二选一、一道四选一、一道恰好选两项的多选题。总题数 41 道，加最后本命填写，预计 7–9 分钟。
7. **导出更适合分析**：CSV 已扁平化为一行一份样本，五维、9 项偏好、6 项习惯、本命、三部推荐及各自反馈各占独立列，可直接用 Excel / pandas 读取；JSON 和 JSONL 保留完整嵌套结构与独立反馈事件。服务端会把反馈合并进对应样本后再导出。

## 快速开始

### 直接打开

双击 `index.html`。测试、最后一步、推荐、反馈和数据实验室都可以使用；数据保存在当前浏览器的 `localStorage`，可导出。

### 本地收集服务

需要 Node.js 18+。本地服务本身没有第三方依赖：

```bash
cd anime-soul-lab
npm start
```

打开 <http://127.0.0.1:4173>。

- 勾选匿名保存后，样本写入 `data/responses.jsonl`。
- 推荐反馈写入 `data/reactions.jsonl`，导出时合并。
- 不勾选匿名保存时，不写入样本池；结果只保留在当前页面/本机会话中。

只检查语法：

```bash
npm run check
```

重新生成番剧数据（联网）：

```bash
npm run build:catalog
```

重新抓取封面并生成媒体资源（联网）：

```bash
npm run fetch:covers
```

> `npm install` 只为 Netlify Functions 的 `@netlify/blobs` 依赖；本地 `npm start` 不需要它。

## 41 道题 + 最后一步

| 模块 | 数量 | 说明 |
| --- | ---: | --- |
| Big Five 自评 | 20 | 5 个维度各 4 题，正反向混合；参考 IPIP / Mini-IPIP 的测量思路，中文为项目改写 |
| 内容偏好 | 9 | 奇幻、科幻、日常治愈、热血、悬疑、恋爱、黑暗、喜剧、运动 |
| 观看习惯 | 6 | 逃离现实、意义反思、社交话题、作画演出、声音音乐、快节奏 |
| 情境选择 | 4 | 2 道二选一、1 道四选一、1 道恰好选两项的多选题，混合在题目中 |
| 注意力校验 | 2 | `q-09` 与 `q-35`；不通过会标记样本，不阻断结果 |
| 最后一步 | 1 | 本命作品（必填）+ 理由（选填，最多 500 字）+ 匿名保存授权 |

注意力题：

- `q-09` 要求选择「比较符合」；
- `q-35` 要求选择「很不符合」。

情境题不是单独凑数：选项会映射到内容偏好，并作为直接口味的一部分进入排序，因此二选一/多选题也会影响推荐，而不会只停留在展示层。

## 推荐算法

```text
综合匹配 =
  0.50 × 直接内容偏好匹配
+ 0.18 × 双平台口碑质量
+ 0.14 × Big Five 启发式内容倾向
+ 0.10 × 观看习惯匹配
+ 0.08 × 制作/声音信号匹配
```

- **直接内容偏好**：9 项内容偏好按 1–5 分计分；4 道情境题的选项权重会叠加到对应口味上，再参与排序。
- **Big Five 辅助项**：只作为弱信号。Big Five → 类型气质的映射是编辑设定的启发式，不是心理学因果结论。
- **口碑质量**：来自 AniList 与 MyAnimeList 的社区聚合评分，结合评分人数。作品需满足：
  - 双平台加权口碑 ≥ 7.5 / 10
  - MAL 评分人数 ≥ 12,000
  - AniList 均分 ≥ 70
- **制作信号**：使用公开的 AniList 制作公司、音乐/视觉信号和制作背景说明；它帮助解释，不替代作品评价。
- **展示匹配分**：把内部加权结果校准到 70–98 的排序指数，不是概率，也不是作品质量分。

口碑数据快照：**2026-11-14**。作品名称、封面与相关权利归原作者及权利方所有；封面来自 AniList 的公开封面地址，并已下载到本项目的静态资源中。

## 样本与数据质量

当前 `schemaVersion: 3`、`testVersion: 3.0.0`、`algorithmVersion: hybrid-fit-v3`。

一份样本包含：

```json
{
  "schemaVersion": 3,
  "testVersion": "3.0.0",
  "algorithmVersion": "hybrid-fit-v3",
  "answers": [
    { "id": "q-16", "type": "binary", "value": "calm" },
    { "id": "q-23", "type": "multi", "value": ["ensemble", "world"] }
  ],
  "scores": {
    "bigFive": { "O": 78, "C": 61, "E": 43, "A": 72, "N": 66 },
    "preferences": { "fantasy": 5, "mystery": 4 },
    "habits": { "visual": 4, "music": 3 },
    "scenarioSignals": { "fantasy": 1.8, "healing": 0.9 }
  },
  "scenarioAnswers": [
    { "id": "q-16", "type": "binary", "selected": ["calm"] }
  ],
  "quality": {
    "valid": true,
    "attentionPassed": true,
    "straightLining": false,
    "durationSeconds": 324,
    "flags": []
  },
  "recommendations": [
    { "rank": 1, "animeId": "frieren", "matchPercent": 92 }
  ],
  "actualFavorite": {
    "title": "夏目友人帐",
    "reason": "它让我知道温柔也可以是一种力量。",
    "matchStatus": "top3",
    "predictedRank": 2
  },
  "feedback": [
    { "animeId": "frieren", "reaction": "like" }
  ],
  "consent": true
}
```

数据质量规则：

- 两道注意力题都通过；
- 20 个人格条目不呈明显直线作答（标准差低于 0.38 即标记）；
- 完成时长 ≥ 75 秒；
- 三条全部通过才计入有效样本。被标记样本仍保留在原始导出中，方便之后复核和重新清洗。

服务端会从原始作答重新计算 Big Five、偏好、习惯、情境信号、注意力结果和直线作答标记；完成时长仍由客户端上报，无法完全防止伪造，这是本地方案的限制。

注意：`favorite` 在样本创建时即由最后一步写入，因此新样本都具备本命字段；推荐反馈是结果页之后异步追加的独立事件。

## 导出格式

### CSV（推荐用于分析）

一行一份样本，包含：

- `id`、`created_at`、`received_at`、`valid`、`quality_flags`、`duration_seconds`、`attention_passed`
- `archetype`、`archetype_key`
- `bigfive_O/C/E/A/N`
- `pref_*` 9 列
- `habit_*` 6 列
- 本命标题、理由、匹配状态、预测排名
- 三部推荐的标题、匹配分、反馈（`like` / `neutral` / `dislike` / `unseen`）
- 情境信号 JSON、情境回答 JSON
- 测试/算法/目录版本、原始作答 JSON

### JSON / JSONL

保留完整嵌套结构。JSON 导出还包含：

```json
{
  "schemaVersion": 3,
  "responses": [{ "id": "…", "feedback": [{ "animeId": "…", "reaction": "like" }] }],
  "reactions": [{ "responseId": "…", "animeId": "…", "reaction": "like" }]
}
```

服务端和 Netlify 版都会先按 `responseId + animeId` 取最新反馈，再合并到对应样本。

## 服务端 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查，前端据此切换本地/服务端保存 |
| `POST` | `/api/responses` | 保存完整 `schemaVersion: 3` 样本（需要 `consent: true`） |
| `POST` | `/api/reactions` | 立即保存一条推荐反馈；按样本 + 番剧归并 |
| `GET` | `/api/stats` | 有效样本、被标记样本、理由数、Top 3 命中率 |
| `GET` | `/api/export?format=jsonl` | 管理员导出；支持 `json`、`jsonl`、`csv` |

本地 Node 服务默认监听 `127.0.0.1`，只提供白名单静态文件；Netlify 版由 Functions 写入 Netlify Blobs。原始导出受 `ADMIN_TOKEN` 保护。

## 部署到 Netlify

### 运作方式

```text
访问者浏览器
   │
   ├─ 静态页面 + 本地封面 ────── Netlify CDN（只发布 dist/）
   │
   ├─ POST /api/responses ───── Netlify Function ── Netlify Blobs（responses/）
   ├─ POST /api/reactions ───── Netlify Function ── Netlify Blobs（reactions/）
   ├─ GET  /api/stats ───────── 公开聚合统计
   └─ GET  /api/export ──────── 需要 ADMIN_TOKEN
```

- 网页、测试数据、封面图片全部静态托管。
- 样本提交时由 Function 重新校验 41 道作答、情境题、Big Five、注意力和质量，再写入 Blobs。
- 每部推荐的反馈是独立即时提交；导出时自动合并。
- 数据实验室的候选池和聚合统计公开；原始理由和逐份样本只有输入管理员密钥才能导出。
- Blobs 默认区域为 `ap-southeast-1`（新加坡），可用环境变量 `BLOBS_REGION` 调整。

### 第一次部署

1. 本地检查：

```bash
npm install
npm run check
npm run build:netlify
```

`dist/` 会包含 `index.html`、`styles.css`、`app.js`、`test-data.js`、`catalog.js`、`media-assets.js`、`assets/covers/` 和 `robots.txt`；不会发布 `server.js`、`data/` 或构建脚本。

2. 推送到 Git：

```bash
git init
git add .
git commit -m "Deploy anime soul lab v3"
git remote add origin <你的仓库地址>
git push -u origin main
```

3. 在 Netlify：**Add new project → Import an existing project**，选择仓库。`netlify.toml` 已指定：
   - Build command: `npm run build:netlify`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
   - Build/Function Node 版本：`20`

4. 在 **Project configuration → Environment variables** 设置：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `ADMIN_TOKEN` | 是 | 原始样本导出密钥；绝不要提交到 Git |
| `BLOBS_REGION` | 否 | 默认 `ap-southeast-1` |
| `BLOBS_STORE_NAME` | 否 | 默认 `anime-soul-responses` |

生成密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

保存后重新部署。没有配置 `ADMIN_TOKEN` 时，`/api/export` 会返回 503，不会公开原始理由。

> **不要只用 Netlify Drop 拖 `dist/`。** 那样不会部署 Functions，`/api/*` 会 404，访客提交只会留在各自浏览器里。

### 自定义域名

1. Netlify → **Domain management → Add a domain**。
2. 使用 Netlify DNS 时，按提示修改域名注册商 nameserver。
3. 使用外部 DNS：
   - 子域名：CNAME 指向 `your-site.netlify.app`；
   - 裸域：ALIAS/ANAME 指向 `apex-loadbalancer.netlify.com`，不支持时按 Netlify 文档使用回退 A 记录 `75.2.60.5`。
4. DNS 生效后 Netlify 自动签发 HTTPS 证书。
5. 以 Netlify 控制台的 **Pending DNS verification** 记录为准；国内访问 Netlify 的速度需实测。

### 如何把这次版本更新同步到 Netlify

#### 情况 A：Netlify 已连接 Git 仓库（推荐）

在本地项目目录执行：

```bash
cd anime-soul-lab
npm run check
npm run build:netlify
git add .
git commit -m "Update to v3: mixed questions, local covers, favorite as last step, reactions"
git push
```

推送后：

1. Netlify 会自动收到 push 并开始构建；打开 **Deploys** 看最新一条。
2. 等状态变成 **Published**。
3. 打开线上域名，强制刷新一次（Ctrl/Cmd + Shift + R）。
4. 验证：
   - `https://你的域名/api/health` 返回 `"ok": true`；
   - 开始页显示 41 道题和新的白色界面；
   - 完成 41 题后出现「最后一道题」；
   - 结果页封面正常显示；
   - 点一次推荐反馈，在数据实验室/Blobs 中能查到；
   - 管理员导出 CSV 能看到 `rec1_reaction` 等列。

> 只修改本地文件而不 commit/push，Netlify 不会知道；在 Netlify 后台点 “Trigger deploy” 也只是重建 Git 上的旧提交。

#### 情况 B：之前是手动拖拽/Netlify CLI 部署，没有连接 Git

任选一种：

**B1. 连接 Git（推荐长期使用）**

在 Netlify 站点设置里连接 GitHub/GitLab 仓库，之后按情况 A 推送即可。

**B2. 用 Netlify CLI 直接发布当前目录**

```bash
npm install -g netlify-cli
netlify login
netlify link          # 选择已经存在的 Netlify 站点
netlify deploy --build --prod
```

`--build` 会先运行构建，`--prod` 会直接发布到生产域名；Functions 和 `assets/covers/` 会一起上传。

#### 更新后数据会怎样

- Netlify Blobs 中的旧样本和反馈不会因为重新部署而删除。
- 环境变量 `ADMIN_TOKEN` 会保留，不需要每次重设。
- 旧版 v2 样本仍会出现在导出中；新导出器会尽量兼容缺失字段（反馈列为空）。新样本使用 `schemaVersion: 3`。
- 浏览器本机的旧 session key 不会被新版本读取，避免旧结构导致恢复错误；数据实验室里的旧本地样本仍可导出。

### 验证收集链路

1. 打开 `https://你的域名/api/health`，应返回 `"storage":"netlify-blobs"`。
2. 完整做一遍测试，最后一步提交本命。
3. 在结果页点一部推荐的「喜欢」。
4. 打开「数据实验室 → 管理员导出」，输入 `ADMIN_TOKEN`，导出 CSV/JSON。
5. Netlify → **Data & Storage → Blobs**：
   - `anime-soul-responses` 的 `responses/` 下是样本；
   - `reactions/` 下是即时反馈。
6. 不填或填错 Token 时导出应被拒绝。

### 数据规模与后续升级

Netlify Blobs 适合早期项目：无需另开数据库、可在 UI 浏览、部署不影响数据。但 `stats` 和 `export` 会列出并读取样本，数据量大后会变慢，也不支持 SQL 聚合。

当样本达到数千份、或需要分组分析/训练排序模型时，建议迁移到 **Supabase / Neon / Netlify Database（Postgres）**：

- `responses` 表保存 JSONB 样本和关键索引列；
- `reactions` 表保存反馈事件，按 `response_id + anime_id` 取最新；
- Functions 保留，只换持久层；
- 继续用 `ADMIN_TOKEN` 保护导出。

当前 Netlify 存储访问集中在 `netlify/shared/store.mjs`，迁移时不需要改前端评分逻辑。

## 隐私与安全

- 只有勾选「允许匿名保存」时才会保存测试结果和理由；取消勾选则不写入样本池。
- 原始理由只进入匿名研究和受保护导出，**不会在当前页面公开展示或公开署名**。如果以后要做“同好理由墙”，必须新增单独的选择加入（opt-in）、审核与删除机制。
- 前端不请求姓名、账号、定位或设备标识；样本里不写 IP。Netlify 平台自身仍可能在访问日志/指标中处理 IP，需在隐私说明中如实披露。
- 测试进度和最近结果保存在本机浏览器，刷新可恢复；清除浏览器数据或点「重新测试」会开始新记录。
- 原始导出需要 `ADMIN_TOKEN`；Functions 配置了基础 IP 限流。
- 公开传播前建议加 Cloudflare Turnstile / hCaptcha，并设置数据保留期限与删除方式。
- 封面来自 AniList，作品名称与相关权利归原作者及权利方所有；本页不使用官方视频素材。

## 文件结构

```text
anime-soul-lab/
├─ index.html                 页面结构（白色极简界面）
├─ styles.css                 统一视觉、响应式与低干扰动效
├─ app.js                     题目流程、情境题、续存恢复、推荐、反馈、数据实验室
├─ test-data.js               41 道题、5 维度、9 偏好、6 习惯、4 情境题、质量规则
├─ catalog.js                 150 条番剧数据（148 条通过门槛）
├─ media-assets.js            本地封面路径 + 简短剧情简介
├─ assets/covers/             150 张封面（来自 AniList，本地静态托管）
├─ server.js                  本地静态服务、样本/反馈 API、导出
├─ netlify.toml               Netlify 构建、发布、Functions、缓存与安全头
├─ netlify/
│  ├─ functions/              health / responses / reactions / stats / export
│  └─ shared/                 Blobs 读写、管理员鉴权、共享校验
├─ scripts/
│  ├─ catalog-seed.mjs        人工初选目标作品
│  ├─ build-catalog.mjs       AniList + MAL 抓取、质量门槛与 catalog.js 生成
│  ├─ fetch-covers.mjs        从 AniList 拉取封面 URL
│  ├─ download-covers.mjs     下载封面到 assets/covers/
│  ├─ build-media-assets.mjs  生成 media-assets.js
│  ├─ synopses.mjs            一句剧情简介数据
│  └─ build-netlify.mjs       构建 dist/（含封面）
├─ data/
│  ├─ .gitkeep
│  ├─ responses.jsonl         本地运行后生成，已被 .gitignore 忽略
│  └─ reactions.jsonl         本地反馈，已被 .gitignore 忽略
├─ package.json
├─ package-lock.json
└─ README.md
```

## 已知局限

- 148 部不是“所有值得看的番”，而是一个可解释、质量可控的初始池。
- Big Five 四题一维是短量表，结果适合作为对话起点，不适合严肃人格测量。
- 情境题只是对显式口味的补充，不构成新的心理量表。
- AniList / MAL 的评分人群不代表所有观众，英语社区与华语社区偏好可能不同。
- 目前权重仍是人工设定；收集到足够有效样本后，先做离线回测和分层分析，再考虑学习排序。
- 封面为本地缓存的 AniList 公开封面，若版权方要求下架，应删除对应图片并替换为文字占位。
- 完成时长来自客户端上报，无法完全防止伪造。

## 参考

- [IPIP 官方说明](https://www.ipip.ori.org/)：公开领域人格条目库与 Big Five 测量资料
- [Donnellan et al. (2006), Mini-IPIP scales](https://doi.org/10.1037/1040-3590.18.2.192)
- [AniList](https://anilist.co/) 与 [AniList GraphQL API](https://docs.anilist.co/)
- [MyAnimeList](https://myanimelist.net/) 的公开作品页与社区评分
- [Netlify Functions API](https://docs.netlify.com/build/functions/api/)
- [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- [Netlify 外部 DNS 自定义域名配置](https://docs.netlify.com/manage/domains/configure-domains/configure-external-dns/)
- [Netlify Database](https://docs.netlify.com/build/data-and-storage/netlify-database/)
