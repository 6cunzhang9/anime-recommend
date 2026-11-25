# 本命番推荐所 · v4

一个可本地运行、也可部署到 Netlify 的番剧审美问卷与推荐系统。

- **40 道固定题目**：严格按 v4 规格，没有注意力题、反向陷阱或认真作答阻断。
- **真实喜欢作品是主锚点**：q40 支持 1–5 部作品、喜欢强度、理由标签和文字；匹配失败也保留原题名。
- **画像与推荐分层**：原始答案、派生画像、作品锚点、评价、短期观看状态、推荐快照分开保存。
- **作品观察**：登录后从中间的分享按钮选择番剧，依次记录八条作品特征、具体标签和七维评价；内容只存入后台，管理员在「用户帖子」查看。
- **云端账号**：用用户名和密码注册。完成问卷后，画像、推荐链接、评价和反馈按账号保存在 Netlify Blobs；换设备登录即可取回。
- **个人概览**：年度报告式人格关键词、看番喜好、阅番数、活跃度、推荐高光和最常回看；右上角账号菜单进入我的发帖、个人设置、主题设置和退出登录。
- **图片与短视频**：作品观察可附图片或短视频，直接显示在内容中；不再接收文档附件。
- **作品搜索**：使用 AniList 元数据与关系图获取番名、别称、年份、制作厂商和系列分类，Bangumi / 本地快照作为回退。

## 快速开始

### 本机体验

安装依赖后，使用 Node.js 20 运行 `npm start`，访问 <http://127.0.0.1:4173>。本地服务直接复用 Netlify Functions 的处理逻辑，正式本地数据写入 `data/site-blobs.json`。初次写入前可继续读取旧的 `data/*.jsonl` 样本。问卷草稿和尚未绑定的游客结果保存在当前浏览器的 localStorage。部署后，账号数据使用原 Netlify Blobs store。直接打开 `index.html` 可测评，账号、找番及分享需要启动服务。

### 测试云端流程

```bash
npm ci
npm run check
npm run build:netlify
npx netlify-cli dev --dir .
```

使用 Netlify Dev 提供的 URL 测试账号、搜索和作品观察。将 `ADMIN_TOKEN` 设为本地环境变量以验证管理员入口与导出。

### 本地测试账号（仅本机可用）

使用 `npm start` 启动后，控制台会输出：

```text
Local test account ready: localtester / LocalOnly-2026!
```

打开 <http://127.0.0.1:4173>，点右上角「登录」，输入：

- 用户名：`localtester`
- 密码：`LocalOnly-2026!`

这个账号只在 `server.js` 创建本地 `data/site-blobs.json` 存储时被写入，每次 `npm start` 会重建它的密码散列；账号 ID 保持稳定，测评和设置不会丢。部署到 Netlify 后，`LOCAL_TEST_ACCOUNT` 逻辑不会运行；即使有人知道密码，`/api/account` 也会返回「本地测试账号只在本机 npm start 环境可用」。它不会进入 Netlify Blobs，也不会影响线上已有账号。

可选的本地覆盖（PowerShell，启动前设置）：

```powershell
$env:LOCAL_TEST_ACCOUNT_USER="localtester"
$env:LOCAL_TEST_ACCOUNT_PASSWORD="LocalOnly-2026!"
npm start
```

不需要时：

```powershell
$env:LOCAL_TEST_ACCOUNT_DISABLED="1"
npm start
```

也可以通过 `.env.example` 中的同名变量记录配置；本项目不会自动读取 `.env`，请在启动命令所在终端设置。

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

## 测评与找番

测评和「想追番了」共用 Bangumi / AniList 召回。外部数据只提供番名、别名、年份、制作厂商、类型和系列关系，也用于候选召回；匹配分只读取站内作品观察中的受控八轴与标签。多选问题的总权重固定，增加选项会分摊每个选项的影响。通常优先显示 2012 年及以后的作品，更早的作品须同时命中多个高权重内部特征。已追按准确条目排除，其他季度和剧场版仍可作为候选。

站点保存标准化测评、结果快照和外部作品引用。保存的旧结果可从「个人概览」查看。运行 `npm run check:recommendations` 检查年份、关键词、已追排除和重复查询合并。

### 外部索引不可用时的回退

搜索、批量导入和推荐会先尝试 Bangumi。Bangumi 超时或不可用时，使用 `catalog.js` 的本地候选快照：

- 第 40 题搜索会优先返回本地匹配，避免输入后长时间空白；
- 批量导入中，本地已收录的作品会立即匹配；
- 推荐结果先生成本地候选并显示“本地候选快照”，外部索引恢复后可重新查询；
- 本地候选和外部结果都使用同一套外部引用结构，之后可继续编辑。

## 元数据、系列与作品观察

- 番名、别称、年份、制作厂商和系列关系优先来自 AniList；查询结果与系列关系在进程内短时缓存，重复搜索不再重复请求。AniList 不可用时才回退 Bangumi 和 `catalog.js` 本地快照。
- 搜索结果直接显示番名、年份和制作厂商；打开作品详情时再读取该作的系列关系。将番剧加入待追或已追时会补齐 `series_id`，追番列表按系列折叠。
- 登录后点分享按钮，先选择作品，再用八条作品特征（推进速度、线索推断、人物视角、情感表达、情绪起伏、缓冲、恋爱线、回收跨度）、具体标签和七项评价完成作品观察。作品观察只写入后台，不提供公开列表；管理员在「用户帖子」查看，包含作者、作品、特征、标签、均分和评论。
- 图片与短视频直接预览，文档附件入口已移除。单条最多 4 个附件、单个最多 3 MB。
- 找番的「作品特征」区可以选择本次条件；服务端把特征标签、问卷推导和清单偏好合并为检索信号，再按番剧标签和简介排序。
- 树洞、跟帖、点赞、收藏、发帖列表和批量撤回入口已下线；旧数据仍保留，公开读取接口只对管理员开放。

## 账号与登录状态

- 「个人概览」占据原交流中心的主导航位置，不再保留单独的个人中心入口，也不显示左侧个人栏。页头右上角账号菜单包含「我的发帖 / 个人设置 / 主题设置 / 退出登录」四项；桌面端点击或悬停展开，鼠标移开收起，移动端为从顶部展开的横向覆盖层，右上角叉号关闭。子页面左上角提供返回。概览以年度报告方式展示人格关键词、看番喜好、阅番数、活跃天数、推荐高光和最常回看，并恢复八轴画像雷达图、七维评价图和轻量渐入/数字缓动；海报生成入口已替换为带展示项选择的公开概览分享页；「我的发帖」只显示自己的作品观察和旧发帖。
- 头像功能已移除。个人设置只保留昵称和简介；个人设置和主题设置已拆开。主题设置支持六套预设色、自定义强调色，以及**电脑背景和手机背景分别上传**；两张背景不会互相套用，避免横竖图适配错位。
- 账号使用 scrypt 加盐散列。登录 Cookie 使用 `HttpOnly`、`SameSite=Lax`、`Max-Age` 和 `Expires`；每次页面启动会滑动续期，连续 30 天未上线才退出。退出登录只清理当前页面的会话视图、DOM 和本地缓存，不会删除服务端的问卷、评价、反馈、反应或追番档案。
- 首次访问先确认会话。未登录显示开始页和登录按钮；登录后进入个人概览。个人概览使用原交流中心的主导航位置，桌面端左侧第一项和手机端底部第一项。我的发帖、个人设置、主题设置和退出登录都从右上角账号菜单进入；桌面悬停/点击展开，移动端从顶部横向展开。

## 站点工作流

- 第 40 题查询作品库并保留本命番引用。追番清单按需查询 AniList，可选系列、季度和关联剧场版。作品观察的评价部分共用七个必选 1–10 分维度，可搜索或自定义标签，再补充评论。
- 搜番支持片名、别称、角色、剧情关键词和反向搜图。搜图服务返回片名或角色线索，网站据此展示站内作品详情。用户点击搜图时会把压缩后的图片发给已启用的外部服务，本站不保存图片。
- 待追和已追支持粘贴文本和导入 TXT、CSV、JSON。唯一匹配的作品直接加入当前清单，有歧义的作品可继续搜索确认。待追和已追在追番列表顶部切换。作品加入待追后，可记为已追、分类喜爱程度或记录再刷。找番支持作品类型、热度、年份、主题、内部特征条件及待追优先级；不再用外部 Bangumi 评分参与匹配。新标签由用户提议、管理员审核。
- 用户可选择公开分享页的展示项，包括昵称、已追数、多刷、最爱番、八轴画像、七维评价和关键统计。接收者通过同一站点的公开地址打开分享页即可，无须登录；链接固定到当前分享内容，面板内可撤回。局域网之外分享需要可公开访问的部署地址。
- 页脚反馈按类别进入管理员后台，可标记已处理。管理员可查看趋势、评价维度和反馈分布，图表汇总可导出。
- 移动端保留底部四项主入口和居中分享按钮；账号菜单从顶部横向展开，右上角叉号关闭。桌面端仍使用左侧固定导航，账号菜单从右上角悬停/点击展开。

## 匿名评论与适配度

每次新登录或新浏览器会话进入站点时，最多展示一条来自其他用户、且关联已追作品的匿名评论。用户可打 1–5 分或跳过，同一用户对同一评论只记录一次。

- 评论权重 = 该评论适配度评分的平均值 / 3；没有评分时权重为 1。
- 同一作品的评论聚合时，某七维评分出现频率越高，该维度在作品评论共识中的权重越高。
- 评论只有在关联具体作品且用户已将该作品标为已追时才会参与推送。
- 评论正文匿名展示，不显示用户名、账号 ID 或附件。

## 一次性导入幽灵数据

推荐页需要的不只是番名，还需要作品标签、观众评分和特征分布。首次上线前可以运行一次外部快照导入；导入完成后，应用运行时不再请求这些评分/标签，只把记录当作本站的幽灵账号数据读取。脚本会额外补齐 `catalog.js` 的作品身份，使本站可搜索的 150 部基线作品全部有特征绑定；当前本地种子为 292 部作品、约 1144 条评分。用户明确选择、加入清单、设为本命、发布观察或打开详情时，`/api/work-identity` 只写入作品身份和外部召回标签，不写详情标签、不计匹配分。

```powershell
# 先预览，不写数据库
npm run seed:ghost -- --limit 200 --reviews 4

# 写入本机 data/site-blobs.json
npm run seed:ghost -- --limit 200 --reviews 4 --apply
```

写入的位置与真实用户完全同级：

- `ratings/<ghostOwnerId>/<ratingId>.json`
- `observations/<observationId>.json`

不会写入 `catalog.js`，也不会增加运行时依赖。记录包含：

- 来自公开元数据的番名、别名、年份、制作厂商
- 由公开标签映射到本站特征字典的作品特征
- 公开评分的结构化 1–5 星值
- 哈希后的来源用户 ID 作为幽灵 owner

不会保存外部评论正文、用户名、头像或任何登录凭证。幽灵记录带 `ghost: true`，不会出现在「我的发帖」或管理员「用户帖子」中，只参与作品特征聚合和找番排序。

把同一批数据写入线上 Blobs 时，推荐用部署后的管理员导入接口。这样写入发生在 Netlify Function 内，使用站点自己的 Blobs 环境，不依赖本地 `NETLIFY_SITE_ID` / `NETLIFY_AUTH_TOKEN`，可以避开本地直连 Blobs 的 400 配置错误。

```powershell
# 1. 先完成新代码的 Netlify 部署，接口 /api/ghost-import 才会存在
# 2. 生成数据包（只需一次）
npm run seed:ghost -- --limit 200 --reviews 4 --out data/ghost-seed.json

# 3. 使用 Netlify 环境里已有的 ADMIN_TOKEN，通过站点接口分批写入
$env:ADMIN_TOKEN="你的 Netlify ADMIN_TOKEN"
npm run seed:ghost -- --from data/ghost-seed.json --apply --remote-url https://你的站点.netlify.app
```

管理员接口每次接收 50 条，只接受带 `ghost:true` 的 `ratings/` 或 `observations/` 键，不能覆盖真实用户记录。

如果确实希望从本地直接操作 Blobs，也可以使用原来的直连方式：

```powershell
$env:NETLIFY_SITE_ID="你的站点 ID"
$env:NETLIFY_AUTH_TOKEN="你的 Netlify Personal Access Token"
$env:BLOBS_STORE_NAME="anime-soul-responses"
$env:BLOBS_REGION="ap-southeast-1"

npm run seed:ghost -- --limit 200 --reviews 4 --apply --remote
```

直连方式返回 400 时，不是数据格式问题，通常是站点 ID、Personal Access Token 或 store 区域与 Netlify 环境不一致；改用上面的 `--remote-url` 方式即可。

脚本默认生成 `data/ghost-seed.json` 预览文件；该文件不参与前端构建。`--limit` 和 `--reviews` 只影响第一次导入的规模，重复运行会跳过同一批记录。

> 数据来源为 AniList 公开 GraphQL 快照；请在实际部署前确认来源条款允许该用途。生产运行时的标签和评分只来自本站数据库，不再实时查询 AniList 的评分。

## Netlify 部署

沿用原 GitHub 仓库及已连接的 Netlify 项目。构建命令为 `npm run build:netlify`，发布目录为 `dist`，Functions 目录为 `netlify/functions`，详见 `netlify.toml`。

在原 Netlify 项目的 **Project configuration → Environment variables** 保留 `ADMIN_TOKEN`，并确认该变量对 Functions 可用。继续使用原 `BLOBS_STORE_NAME`、`BLOBS_REGION`（如已配置），以继承已有匿名问卷、评价和反馈。推送到 Netlify 所监控的 GitHub 分支后会触发构建。

反向搜图默认使用 [trace.moe](https://github.com/soruly/trace.moe-api)，覆盖正片截图。角色插画可设置服务端 `SAUCENAO_API_KEY` 接入 [SauceNAO](https://saucenao.com/about.html)，角色图和海报也可设置 `SERPAPI_API_KEY` 接入 [Google Lens](https://serpapi.com/google-lens-upload-an-image)。启用 Lens 后，其他服务没有可靠线索时才调用它。密钥只配置在服务器或 Netlify Functions 的环境变量。

从右上角账号菜单登录。管理员使用账号 `admin` 和原 `ADMIN_TOKEN`，账号菜单的「管理」区包含图表总览、问卷汇总、用户帖子、用户管理、标签审核和站点反馈；管理页顶部也有同样的分区标签。用户帖子只通过管理员接口读取；汇总 JSON、完整 JSON 和问卷 CSV 仅向管理员开放，导出接口兼容原有 Bearer 密钥及旧 JSONL 样本格式。

### 存储格式

每次测评只写入一条账号记录，保存情绪强度、情感留白、幽默、恋爱、音乐、形式、表演、氛围、节奏和篇幅的 0–100 分析值，以及可解码的题目选项索引。读取时按版本还原选择，支持重算和编辑。新版去掉了重复画像和快照权重，保留一份本命番引用及最近 5 份先前推荐快照。删除本命番帖会撤下公开发言并保留测评结果。旧记录可直接读取。

### API

| 路由 | 用途 |
| --- | --- |
| `GET /api/health` | 检测服务与功能可用性 |
| `GET /api/anime-search?q=...` | 按题名查询 AniList（回退 Bangumi）；`source=anilist` 读取 AniList 详情/系列 |
| `GET /api/photo-search` / `POST /api/photo-search` | 查询启用的搜图源，提交图片并返回番剧候选及片名或角色线索 |
| `GET /api/media?id=...` / `POST /api/media` | 读取公开媒体、上传图片或短视频（单个最多 3 MB，每条最多 4 个） |
| `GET /api/account` | 获取当前账号的档案、评价与反馈 |
| `POST /api/account` | 注册、登录、登出、个人设置 |
| `POST /api/responses` | 保存问卷及推荐快照 |
| `POST /api/reactions` | 保存推荐反馈 |
| `POST /api/ratings` | 旧评价数据接口（新评价走作品观察） |
| `GET /api/observations?mine=1` / `POST /api/observations` | 登录用户查看自己的发帖并提交作品特征、标签和评价；管理员不带 `mine` 时查看全部 |
| `GET /api/work-features` | 按 provider ID 或标题读取作品内部八轴、受控标签、评论共识和评分 |
| `GET/POST /api/comment-prompt` | 按已追列表推送一条匿名评论，并提交 1–5 适配度评分 |
| `POST /api/work-identity` | 用户明确选择作品时保存身份和外部召回标签，不写详情/匹配分 |
| `GET/POST /api/reading-share` | 公开概览分享页，固定链接、展示项选择和撤回 |
| `POST /api/ghost-import` | 使用 `ADMIN_TOKEN` 分批导入一次性幽灵评分/作品观察，只接受 `ghost:true` 数据 |
| `GET /api/watchlist` / `POST /api/watchlist` | 待追、已追、喜爱程度、再刷和评价 |
| `POST /api/discover` | 从 Bangumi 动态找番，支持测评关键词、特征标签与八轴条件 |
| `GET /api/admin-metrics` | 管理员图表汇总 |
| `GET /api/site-feedback` / `POST /api/site-feedback` | 提交反馈、管理员查看与处理 |
| `GET /api/footprints` / `POST /api/footprints` | 查询个人足迹与撤回旧发言 |
| `GET /api/tags` / `POST /api/tags` | 查询可用标签、提交提议与管理员审核 |
| `GET /api/external-comments` | 分析站外高赞讨论及返回来源链接 |
| `GET /api/reading-share` / `POST /api/reading-share` | 查看、生成或撤回阅番分享 |
| `GET /api/admin` / `POST /api/admin` | 查看测评、管理发言和账号禁言 |
| `GET /api/export?format=summary` | 使用 `ADMIN_TOKEN` 导出汇总 |

### 上线验收

1. 用两个浏览器登录不同账号，确认各自只能看到自己的私有档案。
2. 搜索一部作品并分享作品观察，确认普通用户看不到帖子列表或详情；管理员在「用户帖子」能看到作者、作品、特征、标签和评价。
3. 使用简称填写第 40 题并提交，确认只生成一条私有测评，且游客看不到画像和推荐。重新登录后可打开保存的作品链接和「历史测评结果」。
4. 在管理员入口分别使用错误和正确的密码，确认下载权限及汇总字段。

## 参考

- [IPIP](https://www.ipip.ori.org/)（仅作为一般人格测量背景；v4 不是 Big Five 量表）
- [AniList](https://anilist.co/) 与 [AniList GraphQL API](https://docs.anilist.co/)
- [MyAnimeList](https://myanimelist.net/)
- [Netlify Functions](https://docs.netlify.com/build/functions/api/)
- [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- [Netlify 外部 DNS](https://docs.netlify.com/manage/domains/configure-domains/configure-external-dns/)
