# 本命番推荐所 · v4

一个可本地运行、也可部署到 Netlify 的番剧审美问卷与推荐系统。

- **40 道固定题目**：严格按 v4 规格，没有注意力题、反向陷阱或认真作答阻断。
- **真实喜欢作品是主锚点**：q40 支持 1–5 部作品、喜欢强度、理由标签和文字；匹配失败也保留原题名。
- **画像与推荐分层**：原始答案、派生画像、作品锚点、评价、短期观看状态、推荐快照分开保存。
- **树洞**：我的档案、番剧清单/搜索、评价、推荐反馈、历史档案、数据包导出。
- **管理员数据研究室**：只通过 `?admin=1` 显示入口，且导出仍需 `ADMIN_TOKEN`；普通用户数据导出在树洞内。
- **可部署**：静态页面 + Netlify Functions + Netlify Blobs；本地 Node 服务零依赖。

## 先说清楚的边界

1. 本问卷不是临床、人格或能力测评。q05–q08 只是低权重自述，不生成诊断，也不主导推荐。
2. 现有项目没有账户体系，因此：
   - **个人历史、评价、草稿默认保存在本机**；换浏览器/清缓存会丢失。
   - 服务器只能聚合匿名反馈和评价，不能按个人登录账号取回历史。
   - 用户删除本机数据不会删除服务器上的匿名快照；服务器清理需要管理员流程。
3. 没有配置完整的第三方番剧目录。搜索只覆盖当前 148 部候选快照；未匹配作品可保存原题名和 `unmatched` 状态，不阻塞提交。外部作品适配器的统一接口和重试路径已经体现在数据结构中，但没有凭证/授权时不伪造匹配。
4. “相似画像”和“树洞高评价”区块只在匿名样本达到阈值时出现；不足时整块隐藏。当前代码不对普通用户展示其他人的原始答案、ID、理由原文或时间戳。
5. 推荐权重是**初始可配置值，未经大样本验证**。请把结果当作可解释的初始排序，而不是已验证的统计模型。

## 快速开始

### 直接打开

双击 `index.html`。不需要安装依赖；数据、评价和最近结果保存在当前浏览器。

### 本地收集服务

需要 Node.js 18+：

```bash
cd anime-soul-lab
npm start
```

打开 <http://127.0.0.1:4173>。

本地数据文件：

- `data/responses.jsonl`：v4 问卷（旧 v2/v3 行如果存在，会原样保留）
- `data/reactions.jsonl`：推荐反馈事件
- `data/ratings.jsonl`：树洞评价事件

只检查语法：

```bash
npm run check
```

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

## 树洞

入口在首页和页头。树洞内有：

- **我的档案**：当前画像、来源题号、真实喜欢作品、评价、明确排斥、可清除的短期观看状态、推荐反馈。
- **番剧清单**：搜索候选快照、以原题名保存、状态/评分/偏好判断/理由标签/文字评价、编辑和删除。
- **历史档案**：本机 v4 问卷、旧 v2/v3 档案（原样展示、标记为未收集 v4 字段）、每条完整 JSON、完整数据包导出。
- **数据与推荐方式**：问卷边界、权重、外部索引限制、相似用户/高评价显示条件、删除方式和导出说明。

“删除本机数据”清除本机问卷、评价、反馈和草稿，但不删除服务器匿名样本；服务器清理需管理员流程。

### 数据包

树洞导出的 JSON 包含：

- 本机 v4 问卷、旧 v2/v3 档案；
- 原始答案、派生画像、锚点、评价、推荐反馈；
- 当前推荐快照和草稿；
- schema、导出时间和字段说明。

## 外部作品引用

当前适配器行为：

- 搜索范围：`catalog.js` 中经口碑筛选的 148 部候选快照；
- 匹配成功：保存 `provider="anilist-candidate-snapshot"`、`provider_id`、`canonical_url`、`title_canonical`、`media_type`、`lookup_status="matched"`、`resolved_at`；
- 匹配失败：仍可保存，使用 `provider="manual"`、`lookup_status="unmatched"`，保留原始题名；
- 不下载完整番剧目录，不批量镜像评论、角色或全量外部数据。

没有可靠网络/凭证时，产品显示“无法自动匹配，可保存原题名”，不编造匹配结果。

## 本地与 Netlify API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 服务状态与存储类型 |
| `POST` | `/api/responses` | 保存 v4 问卷；服务端校验必答、枚举、上限、排序、q40 |
| `POST` | `/api/reactions` | 保存推荐反馈（想看/喜欢/一般/没兴趣/不适合/已看） |
| `POST` | `/api/ratings` | 保存树洞评价（匿名使用开启时才提交服务器） |
| `POST` | `/api/community` | 聚合匿名相似画像与树洞高评价；不足时返回可见的“不展示”原因 |
| `GET` | `/api/stats` | 管理员统计 |
| `GET` | `/api/export?format=jsonl` | 管理员导出；支持 `json`、`jsonl`、`csv` |

管理员导出：

- JSON：完整 v4 问卷、旧档案、反馈、评价；
- CSV：一行一份问卷，包含 q40 摘要、三部推荐及反馈、同意状态；旧档案兼容；
- 原始导出必须带 `ADMIN_TOKEN`。

## 部署到 Netlify

### 架构

```text
静态页面 + 本地封面 → Netlify CDN（dist/）
POST /api/responses  → Function → Netlify Blobs（responses/）
POST /api/reactions  → Function → Netlify Blobs（reactions/）
POST /api/ratings    → Function → Netlify Blobs（ratings/）
POST /api/community  → Function → 匿名聚合，不返回个人原始数据
GET  /api/export     → 管理员，ADMIN_TOKEN
```

### 首次部署

1. 本地验证：

```bash
npm install
npm run check
npm run build:netlify
```

2. 推送 Git：

```bash
git init
git add .
git commit -m "Deploy anime soul lab v4"
git remote add origin <你的仓库地址>
git push -u origin main
```

3. 在 Netlify 导入仓库。`netlify.toml` 已指定：
   - Build command：`npm run build:netlify`
   - Publish directory：`dist`
   - Functions directory：`netlify/functions`
   - Node：20（`NODE_VERSION=20`）

4. 环境变量：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `ADMIN_TOKEN` | 是 | 管理员原始导出密钥 |
| `BLOBS_REGION` | 否 | 默认 `ap-southeast-1` |
| `BLOBS_STORE_NAME` | 否 | 默认 `anime-soul-responses` |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

5. 管理员入口：在网站 URL 后加 `?admin=1`（或 `#admin`），页脚会出现“管理员导出”；普通页面不显示此入口，且仍然需要 `ADMIN_TOKEN`。

> 不要只拖拽 `dist/`：Functions 不会部署，`/api/*` 会 404。

### 如何把版本更新同步到 Netlify

如果 Netlify 已经连接本仓库（当前仓库远程为 GitHub 的 `anime-recommend`，分支 `main`），在本地执行：

```powershell
cd "C:\Users\CunZhang.DESKTOP-4T3P5LI\Downloads\anime-soul-lab"

npm run check
npm run build:netlify

git add -A
git commit -m "Update to v4: 40-question aesthetic questionnaire and tree hollow"
git push origin main
```

然后：

1. 打开 Netlify 项目的 **Deploys**，等待最新构建变为 **Published**；
2. 打开线上域名，强制刷新（Ctrl/Cmd + Shift + R）；
3. 验证：
   - 首页显示 40 道题；
   - q13/q18/q23/q28 排序、q39 矩阵、q40 多作品可正常操作；
   - 提交后 `/api/health` 显示 `storage: "netlify-blobs"`；
   - 结果页每张卡有外部链接、理由和反馈；
   - 树洞和 `?admin=1` 管理员导出正常。

如果 Netlify 不是通过 Git 而是手动部署：

```bash
npm install -g netlify-cli
netlify login
netlify link
netlify deploy --build --prod
```

或者把仓库重新连接到 Netlify，以后直接 `git push`。

**数据不会因重新部署被删除**：Blobs 中的问卷、反馈、评价会保留；`ADMIN_TOKEN` 也不需要重设。旧 v2/v3 记录会继续出现在管理员导出中，并保留原版本字段。

## 文件结构

```text
anime-soul-lab/
├─ index.html                开始页、40 题、q40、结果、树洞、管理员弹窗
├─ styles.css                白色极简视觉与响应式
├─ app.js                    问卷流程、画像、推荐、树洞、反馈、导出
├─ test-data.js              严格 v4 的 40 题定义与选项代码
├─ v4-validation.js          服务端使用的问卷/反馈/评价/导出校验
├─ catalog.js                148 部候选快照与口碑数据
├─ media-assets.js           本地封面路径 + 一句剧情简介
├─ assets/covers/            150 张本地封面
├─ server.js                 本地静态服务与 API
├─ netlify.toml              Netlify 构建/缓存/安全头
├─ netlify/functions/        health / responses / reactions / ratings / community / stats / export
├─ netlify/shared/           Blobs 访问、管理员鉴权、v4 校验桥接
├─ scripts/                  候选/封面生成与 Netlify 静态构建
├─ data/                     本地 JSONL（被 .gitignore 忽略）
└─ README.md
```

## 手工验收清单

1. 新用户可完成 q01–q40；q40 是最后一题，没有注意力/认真验证题。
2. 必答、多选上限、排序无重复、q39 三组、q40 理由和 `reason_other` 都校验。
3. q40 填一部无法匹配的作品仍能提交，原题名、理由和 `unmatched` 状态在档案与导出中可见。
4. 树洞可搜索候选快照、保存原题名评价、刷新后仍能看到外部链接/评价。
5. 结果页每张卡有外部链接、来源标签、至少两条可追溯理由和反馈操作。
6. 明确不喜欢/不适合不会轻易再次出现在前排；q40 已喜欢作品不会当作“新推荐”。
7. 相似画像和树洞高评价在同意/样本阈值不足时隐藏，不泄露其他用户信息。
8. 树洞包含档案、番剧清单/评价、历史档案和数据包；管理员导出只在 `?admin=1` 入口出现。
9. 数据包可导出本机 v4、旧 v2/v3、评价、反馈和推荐快照。
10. 同一输入、算法版本与配置版本重复计算时排序可重现。

## 已知限制

- 没有账户系统：个人历史是本机数据；无法按账户取回服务器历史。
- 外部搜索只覆盖候选快照，不是完整番剧目录。
- 候选描述是从标签、制作信息和口碑快照派生的，不是人工逐部审核的完整作品向量。
- 推荐权重初始未校准；`rec-v4.0.0-initial` 的可解释性优先于统计最优。
- 相似画像/树洞高评价需要实际的匿名样本与评价量；小样本时隐藏，不能用演示数据伪造。
- 用户删除本机数据不会删除服务器匿名样本；管理员清理需后续后台流程。
- 封面来自 AniList 公开封面地址并本地缓存；版权归原作者及权利方所有。

## 参考

- [IPIP](https://www.ipip.ori.org/)（仅作为一般人格测量背景；v4 不是 Big Five 量表）
- [AniList](https://anilist.co/) 与 [AniList GraphQL API](https://docs.anilist.co/)
- [MyAnimeList](https://myanimelist.net/)
- [Netlify Functions](https://docs.netlify.com/build/functions/api/)
- [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- [Netlify 外部 DNS](https://docs.netlify.com/manage/domains/configure-domains/configure-external-dns/)
