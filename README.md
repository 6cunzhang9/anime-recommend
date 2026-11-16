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

安装依赖后，使用 Node.js 20 运行 `npm start`，访问 <http://127.0.0.1:4173>。本地服务直接复用 Netlify Functions 的处理逻辑，正式本地数据写入 `data/site-blobs.json`。初次写入前可继续读取旧的 `data/*.jsonl` 样本。问卷草稿和尚未绑定的游客结果保存在当前浏览器的 localStorage。部署后，账号数据使用原 Netlify Blobs store。直接打开 `index.html` 可测评，账号、论坛、找番及分享需要启动服务。

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

## 测评与找番

测评和「想追番了」共用 Bangumi 检索。算法把题材、期望感受、叙事和制作偏好转换为关键词，结合外部作品标签及简介匹配。多选问题的总权重固定，增加选项会分摊每个选项的影响。通常优先显示 2012 年及以后的作品，更早的作品须同时命中多个高权重关键词。主动设置年份可查询更早作品。已追按准确条目排除，其他季度和剧场版仍可作为候选。

站点保存标准化测评、结果快照和外部作品引用。保存的旧结果可从个人中心查看。运行 `npm run check:recommendations` 检查年份、关键词、已追排除和重复查询合并。

## 树洞与外部作品

- 「社区发言」可按作品名筛选本命番与番剧评价。第 40 题的作品、喜欢程度与理由会合在同一条匿名发言里；前 39 题、派生画像和推荐快照留在个人档案。写评价同样匿名公开，作者可以编辑或删除。
- 第 40 题、写评价、待追和已追共用 [Bangumi](https://github.com/bangumi/api)。已知系列及 Bangumi 能确认的关联条目可按系列、季度和剧场版选取。手填原题名会留下 Bangumi 搜索链接。
- 树洞支持不绑定作品的散贴和按系列归档的作品讨论。已追清单里的作品评价会显示「作者已追」。
- 相似推荐以题材、追看驱动、人物关系和主题为主，四项性格自述占较低权重。出现在相似推荐中的本命番至少来自两份独立的同意样本。树洞好评同时考虑负面评价，对小样本分数做收缩。核心推荐和已看作品不会重复加推。
- 个人中心集中管理测评档案、树洞发言和设置。账号 ID 固定。自定义昵称经过唯一性校验，旧昵称仍由原账号保留。新测评默认用于相似口味推荐，旧档案保留原有选择。
- 账号使用 scrypt 加盐散列，登录 Cookie 有效期 30 天。到期可重新登录，已保存数据继续保存在同一 Netlify Blobs store。

## 站点工作流

- 首次访问先确认会话。未登录显示测试和右上角登录入口，已登录进入个人中心。提交后可查看推荐，注册或登录可绑定结果并匿名发布本命番。完成测评的访客刷新后进入树洞，可在个人中心查看本机结果或重新测试。
- 第 40 题查询 Bangumi，整系列无需选择类型。写评价和追番清单按需查询 Bangumi，可选系列、季度和关联剧场版。评价共用七个必选 1–10 分维度，可搜索或自定义标签，再补充评论。
- 搜番支持片名、别称、角色、剧情关键词和反向搜图。搜图服务返回片名或角色线索，网站据此查询 Bangumi 并展示站内作品详情。用户点击搜图时会把压缩后的图片发给已启用的外部服务，本站不保存图片。
- 待追和已追支持粘贴文本和导入 TXT、CSV、JSON。唯一匹配的作品直接加入当前清单，有歧义的作品可继续搜索确认。待追和已追在追番列表顶部切换。作品加入待追后，可记为已追、分类喜爱程度或记录再刷。找番支持作品类型、Bangumi 评分区间、热度、年份、主题及待追优先级。树洞筛选使用其他用户最近的公开评价，可叠加各维度评分和评价标签。新标签由用户提议、管理员审核。
- 「足迹与分享」包含我的发帖、赞过的帖子、收藏和阅番海报。本人可编辑发帖，也可逐条撤回或全选后批量撤回。测评档案和追番记录独立保存。
- 用户可选择生成 PNG 和分享页的展示项，包括头像昵称、已追数、多刷、最爱番、维度图和高赞内容。接收者通过同一站点的公开地址打开分享页即可，无须登录。局域网之外分享需要可公开访问的部署地址。分享链接可重新生成内容或撤回。
- 打开帖子会显示跟帖、回复和赞，并在底部异步追加站外摘要。Kitsu 使用公开接口，以名称、年份与版本匹配作品，仅保留话题标签、互动数和原文出处。Bangumi 的公开 `v0` 接口用于条目及关系查询。官方公开目录没有短评正文接口，默认提供站外讨论入口。如部署方已经获得可用且授权的 Bangumi 短评数据源，可将 `BANGUMI_COMMENT_FEED` 设为 HTTPS JSON 地址。站点会附带 `subject_id`，读取 `data: [{ id, text, likes, spoiler }]`，只保存提炼后的标签和原文链接。
- 页脚反馈按类别进入管理员后台，可标记已处理。管理员可查看趋势、评价维度和反馈分布，图表汇总可导出。

## Netlify 部署

沿用原 GitHub 仓库及已连接的 Netlify 项目。构建命令为 `npm run build:netlify`，发布目录为 `dist`，Functions 目录为 `netlify/functions`，详见 `netlify.toml`。

在原 Netlify 项目的 **Project configuration → Environment variables** 保留 `ADMIN_TOKEN`，并确认该变量对 Functions 可用。继续使用原 `BLOBS_STORE_NAME`、`BLOBS_REGION`（如已配置），以继承已有匿名问卷、评价和反馈。推送到 Netlify 所监控的 GitHub 分支后会触发构建。

反向搜图默认使用 [trace.moe](https://github.com/soruly/trace.moe-api)，覆盖正片截图。角色插画可设置服务端 `SAUCENAO_API_KEY` 接入 [SauceNAO](https://saucenao.com/about.html)，角色图和海报也可设置 `SERPAPI_API_KEY` 接入 [Google Lens](https://serpapi.com/google-lens-upload-an-image)。启用 Lens 后，其他服务没有可靠线索时才调用它。密钥只配置在服务器或 Netlify Functions 的环境变量。

使用右上角统一入口登录。管理员使用账号 `admin` 和原 `ADMIN_TOKEN`，从个人中心的「管理」查看测评、审美维度和推荐结果，隐藏、恢复或删除发言，对账号执行限时禁言。汇总 JSON、完整 JSON 和问卷 CSV 仅向管理员开放，导出接口兼容原有 Bearer 密钥及旧 JSONL 样本格式。

### 存储格式

每次测评只写入一条账号记录，保存情绪强度、情感留白、幽默、恋爱、音乐、形式、表演、氛围、节奏和篇幅的 0–100 分析值，以及可解码的题目选项索引。读取时按版本还原选择，支持重算和编辑。新版去掉了重复画像和快照权重，保留一份本命番引用及最近 5 份先前推荐快照。删除本命番帖会撤下公开发言并保留测评结果。旧记录可直接读取。

### API

| 路由 | 用途 |
| --- | --- |
| `GET /api/health` | 检测服务与功能可用性 |
| `GET /api/anime-search?q=...` | 按题名查询 Bangumi |
| `GET /api/photo-search` / `POST /api/photo-search` | 查询启用的搜图源，提交图片并返回 Bangumi 候选及片名或角色线索 |
| `GET /api/account` | 获取当前账号的档案、评价与反馈 |
| `POST /api/account` | 注册、登录、登出、个人设置 |
| `POST /api/responses` | 保存问卷及推荐快照 |
| `POST /api/reactions` | 保存推荐反馈 |
| `POST /api/ratings` | 保存、发布或删除评价 |
| `GET /api/reviews` | 查询公开评价与测评本命番 |
| `GET /api/watchlist` / `POST /api/watchlist` | 待追、已追、喜爱程度、再刷和评价 |
| `POST /api/discover` | 从 Bangumi 动态找番，支持测评关键词 |
| `POST /api/forum` | 发布或编辑散贴 |
| `GET /api/admin-metrics` | 管理员图表汇总 |
| `GET /api/site-feedback` / `POST /api/site-feedback` | 提交反馈、管理员查看与处理 |
| `GET /api/thread` / `POST /api/thread` | 读帖、回复、点赞、收藏及删回复 |
| `GET /api/footprints` / `POST /api/footprints` | 查询个人发帖、点赞、收藏与批量撤回 |
| `GET /api/tags` / `POST /api/tags` | 查询可用标签、提交提议与管理员审核 |
| `GET /api/external-comments` | 分析站外高赞讨论及返回来源链接 |
| `GET /api/reading-share` / `POST /api/reading-share` | 查看、生成或撤回阅番分享 |
| `POST /api/community` | 获取相似作品与树洞好评候选 |
| `GET /api/admin` / `POST /api/admin` | 查看测评、管理发言和账号禁言 |
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
