# 本命番推荐所 · v4

一个可本地运行、也可部署到 Netlify 的番剧审美问卷与推荐系统。

- **40 道固定题目**：严格按 v4 规格，没有注意力题、反向陷阱或认真作答阻断。
- **真实喜欢作品是主锚点**：q40 支持 1–5 部作品、喜欢强度、理由标签和文字；匹配失败也保留原题名。
- **画像与推荐分层**：原始答案、派生画像、作品锚点、评价、短期观看状态、推荐快照分开保存。
- **树洞**：登录后发布的评价统一匿名公开。一次测评对应一条本命番发言。
- **云端账号**：用用户名和密码注册。完成问卷后，画像、推荐链接、评价和反馈按账号保存在 Netlify Blobs；换设备登录即可取回。
- **社区加推**：核心推荐之后最多增加一部，优先使用相似口味用户共同选择的本命番，再考虑树洞好评。
- **作品搜索**：按需使用 Bangumi，结果只在保存相关问卷或评价时留下作品引用。

## 快速开始

### 本机体验

使用 Node.js 20 运行 `npm start`，访问 <http://127.0.0.1:4173>。也可直接打开 `index.html`。本地 Node 服务保留 JSONL 样本模式，完整云端流程使用 Netlify Functions。

### 测试云端流程

```bash
npm ci
npm run check
npm run build:netlify
npx netlify-cli dev --dir .
```

使用 Netlify Dev 提供的 URL 测试账号、搜索和树洞。将 `ADMIN_TOKEN` 设为本地环境变量以验证管理员导出。

## 40 题结构（严格按执行规格）

| 分组 | 题号 | 内容 |
| --- | --- | --- |
| A | q01–q04 | 观看经验、完成方式、本次观看需求、进入门槛 |
| B | q05–q08 | 独处/互动、熟悉/新奇、结构/留白、情绪重要性（低权重自述） |
| C | q09–q12 | 舞台、世界设定用途、故事尺度、现实距离 |
| D | q13–q17 | 追看驱动（排序）、叙事形态、信息明示度、收束、歧义耐受 |
| E | q18–q22 | 人物价值（排序）、关系类型、主角道德复杂度、个体/群像、人物弧 |
| F | q23–q27 | 想带走的感受（排序）、情绪强度、情感表达、喜剧缓冲、恋爱位置 |
| G | q28–q32 | 制作面向（排序）、音乐、形式实验、表演场面、氛围 vs 推进 |
| H | q33–q39 | 主题、主题表达、节奏、节奏排斥、长度、内容排斥、三组强制取舍 |
| I | q40 | 1–5 部真正喜欢的作品；每部包含题名、类型、喜欢强度、1–4 个理由、可选文字 |

题型：Likert-5、单选、多选（含上限/无特别偏好）、排序（恰好 3 项）、矩阵（q39 三组二选一）、重复作品条目（q40）。

### 数据规则

- Likert 同时保存 `{ value, code }`；值 1 永远对应题干左端，5 对应右端。
- 单选保存代码；多选保存按选择顺序排列的代码数组；排序保存从第一到第三的代码数组。
- 未知使用题目定义的 `unknown` 代码；“无特别偏好”只能单独选择。
- q40 至少 1 部，最多 5 部；每部至少 1 个理由；选择 `reason_other` 时文字至少 2 字。
- 不收集姓名、联系方式或设备指纹。
- v4 没有 `attentionChecks`、`quality.valid` 或“最低时长无效”逻辑；旧版样本的质量标记只作为历史字段保留。

## 数据分层

```json
{
  "schemaVersion": 4,
  "questionnaire_version": "4.0.0",
  "response_id": "…",
  "submitted_at": "…",
  "answers": { "q01": "a_21_60", "q13": ["drive_character", "…"] },
  "completion": { "answered_required": 40, "total_required": 40, "draft": false, "submitted": true },
  "derived_profile": { "taste": {}, "context": {}, "self_description": {}, "anchors": {} },
  "actual_favorites": [],
  "consent": { "profile_storage": true, "similar_taste_anonymous_use": false },
  "recommendation_snapshot": {}
}
```

- `answers`：原始答案，不因画像覆盖。
- `derived_profile`：可重算画像；不写成用户身份。
- `context`：q01–q04，包含可变的本次观看状态。
- `anchors`：真实喜欢作品、评价、推荐反馈。
- `recommendation_snapshot`：算法版本、配置、Top 列表、过滤原因、候选簇和解释。
- `profile_version`、`questionnaire_version`、`algorithm_version`、`computed_at` 均保留。

## 推荐逻辑

初始配置（`rec-v4.0.0-initial`）：

```text
Score =
  0.42 × AnchorAffinity        // q40 真实作品 + 理由 + 评价/历史锚点
+ 0.40 × DirectTasteAffinity  // q09–q39 直接审美
+ 0.06 × ContextFit           // q01–q04、长度、入门门槛
+ 0.08 × CraftFit             // q28–q32 制作偏好
+ 0.04 × QualityTieBreak      // 口碑仅在接近候选间轻微排序
- AvoidancePenalty            // q36/q38 + 具体作品“不适合”
- RepeatPenalty               // 已看反馈
+ DiversityAdjustment         // MMR/候选簇重排
```

- q05–q08 **不进入主排序**，只用于谨慎的画像文字和极弱辅助。
- q40 的作品会从“新推荐”中排除，只作为锚点（避免把用户已经喜欢的作品当新发现）。
- 推荐卡的每条理由至少能追溯到一个具体问卷题、真实作品锚点或作品描述；不会只写“与你性格相符”。
- 每张卡显示匹配指数、外部链接、来源标签、2–4 条理由、维度拆分和“为什么不是其他候选”的说明。
- 排名会做候选簇多样性重排，避免少数“万能作品”占据所有用户的前三。

## 树洞与外部作品

- 「社区发言」可按作品名筛选本命番与番剧评价。第 40 题的作品、喜欢程度与理由会合在同一条匿名发言里；前 39 题、派生画像和推荐快照留在个人档案。写评价同样匿名公开，作者可以编辑或删除。
- 第 40 题和写评价共用作品搜索，唯一确定的全名或已知简称会自动匹配，存在歧义时可选条目或保留原题名。支持按中文或原名搜索 [Bangumi](https://github.com/bangumi/api)。接口超时会显示本地候选，手填题名会留下 Bangumi 搜索链接。
- 核心推荐沿用精选候选、描述和封面。保存的推荐快照包含作品链接，访问历史档案可直接打开作品页。
- 相似推荐以题材、追看驱动、人物关系和主题为主，四项性格自述占较低权重。出现在相似推荐中的本命番至少来自两份独立的同意样本。树洞好评同时考虑负面评价，对小样本分数做收缩。核心推荐和已看作品不会重复加推。
- 已登录用户可从账号菜单导入本浏览器的 v4 测评档案。旧测评和旧评价保留原有可见范围；已有云端档案优先保留。旧版数据仍可从原浏览器导出。
- 账号使用 scrypt 加盐散列，登录 Cookie 有效期 30 天。到期可重新登录，已保存数据继续保存在同一 Netlify Blobs store。

## Netlify 部署

沿用原 GitHub 仓库及已连接的 Netlify 项目。构建命令为 `npm run build:netlify`，发布目录为 `dist`，Functions 目录为 `netlify/functions`，详见 `netlify.toml`。

在原 Netlify 项目的 **Project configuration → Environment variables** 保留 `ADMIN_TOKEN`，并确认该变量对 Functions 可用。继续使用原 `BLOBS_STORE_NAME`、`BLOBS_REGION`（如已配置），以继承已有匿名问卷、评价和反馈。推送到 Netlify 所监控的 GitHub 分支后会触发构建。

部署后，页面底部点击「管理员」，使用账号 `admin` 和原 `ADMIN_TOKEN` 登录。管理员主页可搜索测评、查看画像与推荐快照、隐藏或恢复发言，以及下载汇总 JSON、完整 JSON 和问卷 CSV。完整 JSON 包含问卷、评价和推荐反馈。导出接口兼容原有 Bearer 密钥及旧 JSONL 样本格式。账号口令和会话数据不进入数据导出。

### 存储格式

每次测评或评价只写入一条账号记录。发言由记录生成，编辑和管理状态随同一条记录更新。新版记录只保存一份第 40 题作品和作品引用，保留最多 5 份先前推荐快照。读取时还原已有 API 和导出所用的 v4 字段。旧记录可以直接读取。

### API

| 路由 | 用途 |
| --- | --- |
| `GET /api/health` | 检测服务与功能可用性 |
| `GET /api/anime-search?q=...` | 按题名查询 Bangumi |
| `GET /api/account` | 获取当前账号的档案、评价与反馈 |
| `POST /api/account` | 注册、登录、登出 |
| `POST /api/responses` | 保存问卷及推荐快照 |
| `POST /api/reactions` | 保存推荐反馈 |
| `POST /api/ratings` | 保存、发布或删除评价 |
| `GET /api/reviews` | 查询公开评价与测评本命番 |
| `POST /api/community` | 获取相似作品与树洞好评候选 |
| `GET /api/admin` / `POST /api/admin` | 查看测评、管理发言 |
| `GET /api/export?format=summary` | 使用 `ADMIN_TOKEN` 导出汇总 |

### 上线验收

1. 用两个浏览器登录不同账号，确认各自只能看到自己的私有档案。
2. 搜索一部作品并发布评价，确认游客可见。管理员隐藏后验证游客不可见，恢复后验证重新显示。
3. 使用简称填写第 40 题并提交，确认只生成一条本命番发言，且游客看不到画像和推荐。重新登录后可打开保存的作品链接；样本足够时应出现一部社区加推。
4. 在管理员入口分别使用错误和正确的密码，确认下载权限及汇总字段。

## 参考

- [IPIP](https://www.ipip.ori.org/)（仅作为一般人格测量背景；v4 不是 Big Five 量表）
- [AniList](https://anilist.co/) 与 [AniList GraphQL API](https://docs.anilist.co/)
- [MyAnimeList](https://myanimelist.net/)
- [Netlify Functions](https://docs.netlify.com/build/functions/api/)
- [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- [Netlify 外部 DNS](https://docs.netlify.com/manage/domains/configure-domains/configure-external-dns/)
