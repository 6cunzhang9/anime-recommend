/* 本命番推荐所 · v4 番剧审美问卷
 *
 * 严格对应《新版 40 题番剧审美问卷执行规格》v4 草案。
 * 本问卷不是心理量表：没有反向题、注意力题、隐藏陷阱或质量阻断。
 * 原始答案与画像派生分层保存，不在客户端改写原始编码。
 */

const SCHEMA_VERSION = 4;
const QUESTIONNAIRE_VERSION = "4.0.0";
const TEST_VERSION = "4.0.0";

const WORK_TYPES = [
  { code: "tv", label: "TV 动画" },
  { code: "movie", label: "剧场版 / 电影" },
  { code: "ova", label: "OVA" },
  { code: "ona", label: "网络动画 ONA" },
  { code: "unknown", label: "不确定类型" }
];

const LIKE_STRENGTHS = [
  { code: "love", label: "最喜欢 / 长期喜欢" },
  { code: "like", label: "很喜欢" },
  { code: "recent_like", label: "近期特别喜欢" }
];

const FAVORITE_REASONS = [
  { code: "reason_plot", label: "故事与情节" },
  { code: "reason_world", label: "世界与设定" },
  { code: "reason_character", label: "人物" },
  { code: "reason_relationship", label: "人物关系" },
  { code: "reason_emotion", label: "情绪与感受" },
  { code: "reason_theme", label: "主题与表达" },
  { code: "reason_visual", label: "画面与美术" },
  { code: "reason_direction", label: "演出与分镜" },
  { code: "reason_music", label: "音乐与声音" },
  { code: "reason_action_or_stage", label: "动作、比赛或舞台" },
  { code: "reason_pace_or_mood", label: "节奏或氛围" },
  { code: "reason_other", label: "其他（请补充）" }
];

const GROUP_LABELS = {
  A: "观看经验与当下状态",
  B: "直接自述的倾向",
  C: "题材、舞台与作品尺度",
  D: "叙事与信息组织",
  E: "人物与关系",
  F: "情感体验与表达",
  G: "视听与艺术表达",
  H: "主题、节奏与排除项",
  I: "真正喜欢的作品"
};

function likert(id, group, field, text, leftLabel, rightLabel, labels, extra = {}) {
  return {
    id,
    group,
    groupLabel: GROUP_LABELS[group],
    type: "likert",
    field,
    required: true,
    text,
    leftLabel,
    rightLabel,
    options: labels.map((label, index) => ({
      code: `${id}_${index + 1}`,
      value: index + 1,
      label
    })),
    ...extra
  };
}

function single(id, group, field, text, options, extra = {}) {
  return {
    id,
    group,
    groupLabel: GROUP_LABELS[group],
    type: "single",
    field,
    required: true,
    text,
    options,
    ...extra
  };
}

function multi(id, group, field, text, options, maxSelections, noneCode = null, extra = {}) {
  return {
    id,
    group,
    groupLabel: GROUP_LABELS[group],
    type: "multi",
    field,
    required: true,
    text,
    options,
    maxSelections,
    noneCode,
    ...extra
  };
}

function rank(id, group, field, text, options, rankCount = 3, extra = {}) {
  return {
    id,
    group,
    groupLabel: GROUP_LABELS[group],
    type: "rank",
    field,
    required: true,
    text,
    options,
    rankCount,
    ...extra
  };
}

const QUESTIONS = [
  single(
    "q01",
    "A",
    "watch_experience_band",
    "到目前为止，你完整看过或持续追过多少部动画/番剧？不必精确统计。",
    [
      { code: "a_0_5", label: "0–5 部" },
      { code: "a_6_20", label: "6–20 部" },
      { code: "a_21_60", label: "21–60 部" },
      { code: "a_61_150", label: "61–150 部" },
      { code: "a_151_plus", label: "151 部以上" },
      { code: "a_unsure", label: "不确定" }
    ],
    { unknownCodes: ["a_unsure"], usage: "只调整推荐解释的置信度和新手提示，不折算成品味高低。" }
  ),
  single(
    "q02",
    "A",
    "viewing_commitment",
    "遇到“有兴趣但前几集没有立刻打动你”的作品时，你通常怎样做？",
    [
      { code: "watch_try_1", label: "通常一两集就停" },
      { code: "watch_try_3", label: "通常会看约 3 集" },
      { code: "watch_try_6", label: "通常会多看几集再判断" },
      { code: "watch_finish", label: "只要不明显不适就倾向看完" },
      { code: "watch_depends", label: "完全看作品，不固定" }
    ],
    { usage: "用于观看习惯和入门门槛提示，不作为作品质量判断。" }
  ),
  multi(
    "q03",
    "A",
    "current_watch_need",
    "你这一次最希望番剧带给你什么？请选择最多 2 项；这是短期状态，会随下一次问卷改变。",
    [
      { code: "m_relax", label: "放松陪伴" },
      { code: "m_excite", label: "兴奋刺激" },
      { code: "m_move", label: "被情感打动" },
      { code: "m_think", label: "思考或讨论" },
      { code: "m_escape", label: "暂时离开现实" },
      { code: "m_inspire", label: "获得创作 / 行动灵感" },
      { code: "m_none", label: "没有特别目的" }
    ],
    2,
    "m_none",
    { contextual: true, usage: "仅做本次推荐的轻量重排，可清除，不写入长期核心画像。" }
  ),
  single(
    "q04",
    "A",
    "entry_threshold",
    "推荐一部新作品时，你更能接受哪种开始方式？",
    [
      { code: "entry_immediate", label: "第一集就要有明确吸引点" },
      { code: "entry_gradual", label: "可慢热，但前 3 集要看到方向" },
      { code: "entry_patient", label: "可为后续铺垫耐心等待" },
      { code: "entry_no_pref", label: "无特别偏好" }
    ],
    { usage: "用于显示“为什么推荐”和轻微排序调整，不会单独排除慢热作品。" }
  ),
  likert(
    "q05",
    "B",
    "self_introversion_extraversion",
    "在日常生活中，你通常更接近哪一端？",
    "更喜欢独处",
    "更喜欢与人互动",
    ["明显更喜欢独处", "较偏独处", "两者都可以", "较偏与人互动", "明显喜欢与人互动"],
    { lowInferenceWeight: true, usage: "仅用于谨慎的画像文案和同分候选的极弱辅助，不用于生成或排除推荐。" }
  ),
  likert(
    "q06",
    "B",
    "novelty_seeking",
    "看作品时，你更偏向熟悉舒适的表达，还是陌生、新鲜、可能有些难懂的表达？",
    "熟悉舒适",
    "新奇实验",
    ["强烈偏熟悉舒适", "较偏熟悉", "两者均可", "较偏新奇", "强烈偏新奇 / 实验性"],
    { lowInferenceWeight: true, usage: "探索比例与解释用的软信号，不能覆盖明确负面偏好。" }
  ),
  likert(
    "q07",
    "B",
    "structure_to_ambiguity_disposition",
    "你通常更喜欢“目标、规则和因果很清楚”的故事，还是“允许停顿、观察和多种解释”的故事？",
    "清晰结构",
    "留白开放",
    ["强烈偏清晰结构", "较偏清晰结构", "视作品而定", "较偏留白", "强烈偏留白与开放解释"],
    { lowInferenceWeight: true, usage: "与 q15、q16、q17 交叉观察；冲突时保留冲突，不强行平均。" }
  ),
  likert(
    "q08",
    "B",
    "emotion_importance_self_report",
    "作品中的情绪通常会在多大程度上影响你的喜欢与否？",
    "几乎不影响",
    "常是决定因素",
    ["几乎不影响", "影响较小", "有一定影响", "影响很大", "常是决定因素"],
    { lowInferenceWeight: true, usage: "只描述情感在个人审美中的位置，不推断情绪状态或心理健康。" }
  ),
  multi(
    "q09",
    "C",
    "setting_interest",
    "下列哪几种舞台最容易让你想点开？请选择最多 4 项。",
    [
      { code: "set_everyday", label: "现实 / 日常" },
      { code: "set_school_youth", label: "校园 / 青春" },
      { code: "set_history", label: "历史 / 时代" },
      { code: "set_fantasy", label: "奇幻" },
      { code: "set_scifi", label: "科幻" },
      { code: "set_mystery_urban", label: "都市异闻 / 悬疑" },
      { code: "set_music_stage", label: "音乐、偶像、舞台或竞技" },
      { code: "set_adventure_conflict", label: "冒险、战争或大规模冲突" },
      { code: "set_no_pref", label: "无特别偏好" }
    ],
    4,
    "set_no_pref",
    { usage: "候选召回信号之一，只表示“容易点开”，不表示同类题材必然喜欢。" }
  ),
  multi(
    "q10",
    "C",
    "worldbuilding_value",
    "面对一个虚构世界，你最希望它提供什么？请选择最多 3 项。",
    [
      { code: "world_rules", label: "自洽的规则与细节" },
      { code: "world_discovery", label: "逐步探索未知" },
      { code: "world_metaphor", label: "映照现实 / 人的处境" },
      { code: "world_spectacle", label: "奇观与想象力" },
      { code: "world_stage", label: "服务人物关系即可" },
      { code: "world_none", label: "无特别偏好" }
    ],
    3,
    "world_none",
    { usage: "把“喜欢奇幻 / 科幻”与“喜欢世界如何被使用”分开。" }
  ),
  single(
    "q11",
    "C",
    "preferred_story_scope",
    "以下哪一种故事重心最容易持续吸引你？",
    [
      { code: "scope_intimate", label: "少数人的日常、关系或内心" },
      { code: "scope_personal_growth", label: "一个人的成长或选择" },
      { code: "scope_group", label: "团队、乐队、社群或群像" },
      { code: "scope_society", label: "社会、组织、制度" },
      { code: "scope_world", label: "世界命运、文明或宏大历史" },
      { code: "scope_varies", label: "差异很大" }
    ],
    { usage: "候选标签匹配与多样性约束；scope_world 不代表更深刻。" }
  ),
  likert(
    "q12",
    "C",
    "reality_distance_preference",
    "你希望作品与现实的距离更接近哪一端？",
    "贴近日常现实",
    "完全虚构 / 异世界",
    ["贴近日常现实", "现实基础上有少量夸张", "两者都可", "明显脱离现实", "完全虚构 / 异世界也很好"],
    { usage: "候选召回的辅助维度，不单独决定题材。" }
  ),
  rank(
    "q13",
    "D",
    "narrative_drivers_ranked",
    "请将最能驱动你继续追看的 3 项从高到低排序。",
    [
      { code: "drive_plot", label: "事件与后续发展" },
      { code: "drive_mystery", label: "谜团、线索与真相" },
      { code: "drive_character", label: "人物变化与选择" },
      { code: "drive_relationship", label: "人物关系变化" },
      { code: "drive_world", label: "世界 / 设定的展开" },
      { code: "drive_performance", label: "音乐、比赛、演出或动作场面" },
      { code: "drive_mood", label: "氛围与日常陪伴" }
    ]
  ),
  single(
    "q14",
    "D",
    "narrative_form_preference",
    "你最容易喜欢哪种组织方式？",
    [
      { code: "form_linear", label: "主线连续推进" },
      { code: "form_multi", label: "多线 / 群像交错" },
      { code: "form_episode", label: "单元剧或片段式" },
      { code: "form_non_linear", label: "非线性、跳切、拼图" },
      { code: "form_hybrid", label: "混合都可" },
      { code: "form_unsure", label: "不确定" }
    ],
    { unknownCodes: ["form_unsure"], usage: "对形式偏好建模，避免把单元剧和主线作品只按题材归类。" }
  ),
  likert(
    "q15",
    "D",
    "information_explicitness_preference",
    "你更喜欢作品如何提供关键信息？",
    "直接说明",
    "自行拼出",
    ["直接清楚地说明", "较清楚", "两者皆可", "较喜欢从细节自行拼出", "喜欢反复琢磨、回看才能拼出"],
    { usage: "问信息是否明说；不要和 q17 的结局/意义确定性混为一项。" }
  ),
  single(
    "q16",
    "D",
    "closure_preference",
    "对于重要矛盾和人物关系，你更期待怎样的收束？",
    [
      { code: "closure_clear_happy", label: "明确且偏圆满" },
      { code: "closure_clear_any", label: "明确即可，圆满与否都可" },
      { code: "closure_bittersweet", label: "有代价但情感上完整" },
      { code: "closure_open", label: "允许开放式 / 未定论" },
      { code: "closure_depends", label: "完全看作品" }
    ],
    { usage: "区分“喜欢悲伤”和“喜欢未完成感”。" }
  ),
  single(
    "q17",
    "D",
    "ambiguity_tolerance",
    "如果作品故意不解释部分设定或人物动机，你通常会怎样感受？",
    [
      { code: "ambiguity_dislike", label: "常让我出戏" },
      { code: "ambiguity_low", label: "少量可以" },
      { code: "ambiguity_mid", label: "视作品而定" },
      { code: "ambiguity_like", label: "会让我愿意回味" },
      { code: "ambiguity_seek", label: "这正是吸引点之一" }
    ],
    { usage: "与 q07、q15 共同描述解释充分度；不解释为理解能力。" }
  ),
  rank(
    "q18",
    "E",
    "character_value_ranked",
    "请把你最在意的 3 个面向从高到低排序。",
    [
      { code: "char_growth", label: "成长与转变" },
      { code: "char_consistency", label: "动机与行为可信" },
      { code: "char_complexity", label: "矛盾、缺陷与复杂性" },
      { code: "char_charm", label: "鲜明魅力 / 可爱 / 酷" },
      { code: "char_values", label: "价值选择与信念" },
      { code: "char_relation", label: "与他人的化学反应" },
      { code: "char_identify", label: "代入或理解其处境" }
    ]
  ),
  multi(
    "q19",
    "E",
    "relationship_interest",
    "请选择最多 4 项；选择表示“容易打动你”，不表示作品必须含有它。",
    [
      { code: "rel_friendship", label: "朋友 / 伙伴" },
      { code: "rel_family", label: "亲情 / 类似家人的关系" },
      { code: "rel_romance", label: "恋爱 / 暧昧" },
      { code: "rel_rivals", label: "竞争与互相推动" },
      { code: "rel_team", label: "团队 / 乐队 / 社团共同完成目标" },
      { code: "rel_mentor", label: "师徒 / 前后辈" },
      { code: "rel_companionship", label: "共同旅行、陪伴、相依" },
      { code: "rel_conflict", label: "冲突、对立、复杂纠葛" },
      { code: "rel_no_pref", label: "无特别偏好" }
    ],
    4,
    "rel_no_pref",
    { usage: "区分“有情感”与“是哪一种关系、为何被打动”。" }
  ),
  likert(
    "q20",
    "E",
    "protagonist_moral_complexity_preference",
    "你更容易被哪类主角吸引？",
    "善良可靠",
    "道德暧昧 / 危险",
    ["善良可靠、容易亲近", "总体正直但有缺点", "两类都可", "有明显缺点、会犯错或难以亲近", "道德暧昧、危险、反英雄或难以判断"],
    { usage: "描述角色吸引力，不推断用户本人价值观。" }
  ),
  likert(
    "q21",
    "E",
    "cast_scope_preference",
    "你更喜欢镜头长期跟随少数核心人物，还是在一组人物之间切换？",
    "少数核心人物",
    "群像 / 多人物",
    ["强烈偏少数核心人物", "较偏少数", "都可", "较偏群像", "强烈偏群像 / 多人物互动"],
    { usage: "只问角色视角分配，不等同于 q11 的故事尺度。" }
  ),
  single(
    "q22",
    "E",
    "character_arc_preference",
    "哪一种变化最能让你满意？",
    [
      { code: "arc_healing", label: "被理解、修复或和解" },
      { code: "arc_growth", label: "能力 / 责任 / 自我成长" },
      { code: "arc_reveal", label: "逐步揭开真实面貌" },
      { code: "arc_break", label: "崩塌、失去或变质" },
      { code: "arc_bond", label: "关系改变带来的人物变化" },
      { code: "arc_static", label: "不一定需要明显变化" },
      { code: "arc_depends", label: "视作品而定" }
    ],
    { usage: "候选解释的核心字段之一。" }
  ),
  rank(
    "q23",
    "F",
    "desired_emotions_ranked",
    "请把最希望从一部喜欢的作品中带走的 3 种感受从高到低排序。",
    [
      { code: "feel_warmth", label: "温暖 / 被陪伴" },
      { code: "feel_exhilaration", label: "热血 / 兴奋" },
      { code: "feel_tension", label: "紧张 / 不安" },
      { code: "feel_sadness", label: "悲伤 / 痛感" },
      { code: "feel_awe", label: "震撼 / 宏大感" },
      { code: "feel_wonder", label: "新奇 / 不可思议" },
      { code: "feel_reflection", label: "回味与思考" },
      { code: "feel_catharsis", label: "情绪释放" }
    ]
  ),
  likert(
    "q24",
    "F",
    "emotional_intensity_preference",
    "你对作品情绪起伏的理想强度更接近哪一端？",
    "平静稳定",
    "强烈 / 高密度",
    ["平静稳定即可", "较平静", "适中", "喜欢较强烈起伏", "喜欢强烈、极端或高密度的情绪体验"],
    { usage: "与 q23 组合；强度不代表好坏。" }
  ),
  likert(
    "q25",
    "F",
    "emotion_expression_preference",
    "人物的感情更适合如何呈现？",
    "明确说出来",
    "含蓄 / 留白",
    ["台词与情节明确说出来", "较明确", "都可", "较喜欢克制地通过细节表现", "强烈偏含蓄、留白、非语言表达"],
    { usage: "只处理情感表达，不处理设定/剧情信息。" }
  ),
  likert(
    "q26",
    "F",
    "comic_relief_preference",
    "在沉重、紧张或复杂的故事里，你需要多少轻松、幽默或日常缓冲？",
    "最好几乎没有",
    "是作品的重要部分",
    ["最好几乎没有", "少量即可", "适中", "需要经常有", "是我喜欢作品的重要部分"],
    { usage: "避免把喜欢黑暗题材误判为不需要轻松互动。" }
  ),
  single(
    "q27",
    "F",
    "romance_role_preference",
    "恋爱/暧昧线在你喜欢的作品中通常应处于什么位置？",
    [
      { code: "romance_center", label: "最好是核心" },
      { code: "romance_important", label: "重要支线也很好" },
      { code: "romance_light", label: "少量点缀即可" },
      { code: "romance_avoid", label: "通常不想要" },
      { code: "romance_no_pref", label: "无特别偏好" }
    ],
    { usage: "不把“偏好人物关系”一概解释为偏好恋爱。" }
  ),
  rank(
    "q28",
    "G",
    "craft_value_ranked",
    "请将最能让一部作品留在你记忆中的 3 项从高到低排序。",
    [
      { code: "craft_animation", label: "作画、动作、角色表演" },
      { code: "craft_direction", label: "演出、分镜、剪辑与镜头" },
      { code: "craft_visual_style", label: "美术、色彩、整体视觉风格" },
      { code: "craft_music", label: "配乐、歌曲、现场演出" },
      { code: "craft_voice", label: "声优、台词和声音表演" },
      { code: "craft_writing", label: "剧本、结构、文字表达" }
    ]
  ),
  likert(
    "q29",
    "G",
    "music_importance",
    "配乐、插曲、主题曲或作品内的音乐演出，对你喜欢一部作品有多重要？",
    "几乎不影响",
    "可能单独决定喜欢",
    ["几乎不影响", "影响较小", "有加分", "很重要", "可能单独决定我是否喜欢"],
    { usage: "捕捉《BanG Dream!》《FLCL》等可能被题材题漏掉的吸引点。" }
  ),
  likert(
    "q30",
    "G",
    "formal_experiment_interest",
    "你对夸张画风、风格化剪辑、混合媒介或不按常规叙事的演出有多大兴趣？",
    "通常会妨碍观看",
    "本身就是吸引点",
    ["通常会妨碍观看", "较少喜欢", "视作品而定", "常有加分", "本身就是吸引点"],
    { usage: "不能由人格开放性替代；这是明确的作品体验偏好。" }
  ),
  likert(
    "q31",
    "G",
    "performance_spectacle_importance",
    "高完成度的战斗、比赛、演奏或舞台表演，对你的喜欢程度有多重要？",
    "几乎不重要",
    "常是核心吸引点",
    ["几乎不重要", "较不重要", "有则加分", "很重要", "常是核心吸引点"],
    { usage: "把“动作题材”与“享受动作/演出的呈现”分开。" }
  ),
  likert(
    "q32",
    "G",
    "mood_vs_progress_tradeoff",
    "当“氛围、画面、音乐很强”与“每集都有明显剧情推进”不能同时满足时，你更愿意保留哪一端？",
    "优先剧情推进",
    "优先氛围体验",
    ["明显优先剧情推进", "较优先推进", "必须看作品", "较优先氛围", "明显优先氛围体验"],
    { usage: "强制表达真实取舍。" }
  ),
  multi(
    "q33",
    "H",
    "theme_interest",
    "请选择最多 4 项你愿意在动画中反复接触的主题。",
    [
      { code: "theme_identity", label: "自我 / 身份 / 成长" },
      { code: "theme_connection", label: "关系、陪伴、家庭" },
      { code: "theme_ideal", label: "理想、努力、目标" },
      { code: "theme_society", label: "社会、制度、权力" },
      { code: "theme_ethics", label: "选择、代价、善恶" },
      { code: "theme_life_death", label: "生命、死亡、存在" },
      { code: "theme_civilization", label: "历史、战争、文明 / 人类命运" },
      { code: "theme_creation", label: "艺术、创作、表达" },
      { code: "theme_none", label: "无特别偏好" }
    ],
    4,
    "theme_none",
    { usage: "主题只影响解释和相近候选，不代表更高质量偏好。" }
  ),
  single(
    "q34",
    "H",
    "theme_expression_preference",
    "对主题的表达，你更喜欢哪一种？",
    [
      { code: "theme_direct", label: "作品明确说出观点" },
      { code: "theme_story", label: "主要从情节和人物选择体现" },
      { code: "theme_symbolic", label: "允许象征、隐喻、开放解释" },
      { code: "theme_any", label: "都可以" },
      { code: "theme_none", label: "不在意主题" }
    ],
    { usage: "与 q15、q25 分开，防止把叙事信息、情感表达和主题表达混为一项。" }
  ),
  likert(
    "q35",
    "H",
    "pace_preference",
    "你喜欢的整体节奏通常更接近哪一端？",
    "慢、观察感强",
    "快、持续推进",
    ["慢、观察感强", "较慢", "中等", "较快", "快、持续推进"],
    { usage: "不只看每集事件数量；结合 q36 的“慢在哪里/快在哪里”。" }
  ),
  multi(
    "q36",
    "H",
    "pace_avoidance",
    "请选择最多 3 项你最不能接受的节奏问题。",
    [
      { code: "pace_filler", label: "无关注水 / 重复" },
      { code: "pace_rushed", label: "推进太快、情感或设定没展开" },
      { code: "pace_exposition", label: "解释太多而缺少戏剧性" },
      { code: "pace_static", label: "长时间没有人物 / 关系 / 主题 / 世界变化" },
      { code: "pace_jump", label: "跳跃太大难跟上" },
      { code: "pace_none", label: "无特别不能接受" }
    ],
    3,
    "pace_none",
    { usage: "负向硬约束候选，优先级高于 q35 的一般偏好。" }
  ),
  single(
    "q37",
    "H",
    "length_preference",
    "你通常更愿意开始哪种长度的作品？",
    [
      { code: "length_short", label: "1 季 / 短篇优先" },
      { code: "length_medium", label: "2–4 季或中等长度" },
      { code: "length_long", label: "长篇追更 / 长线" },
      { code: "length_film", label: "电影 / OVA 等独立作品" },
      { code: "length_any", label: "都可" }
    ],
    { usage: "用于降低开始成本，不用于评价作品内容。" }
  ),
  multi(
    "q38",
    "H",
    "hard_or_soft_avoidance",
    "以下哪些情况常常会让你放弃一部作品？请选择最多 3 项。若没有，请选“无明确排斥”。",
    [
      { code: "avoid_forced_romance", label: "恋爱发展牵强 / 喧宾夺主" },
      { code: "avoid_fanservice", label: "大量服务镜头 / 物化表达" },
      { code: "avoid_cruelty", label: "持续以残酷、猎奇或折磨为卖点" },
      { code: "avoid_preachy", label: "说教压过人物与故事" },
      { code: "avoid_formula", label: "套路感、可预测性过强" },
      { code: "avoid_confusing", label: "故意混乱但缺少可理解线索" },
      { code: "avoid_low_stakes", label: "长期没有冲突或变化" },
      { code: "avoid_high_stakes", label: "长期高压、冲突过密" },
      { code: "avoid_none", label: "无明确排斥" }
    ],
    3,
    "avoid_none",
    { usage: "初始只作为软排除；具体作品强烈不喜欢后可升级为硬排除。" }
  ),
  {
    id: "q39",
    group: "H",
    groupLabel: GROUP_LABELS.H,
    type: "matrix",
    field: "tradeoffs",
    required: true,
    text: "请分别在每一对中选择较重要的一侧；没有正确答案。",
    rows: [
      {
        key: "surprise_vs_coherence",
        label: "在“出乎意料”与“严密自洽”之间",
        options: [
          { code: "tradeoff_surprise", label: "出乎意料、可冒险" },
          { code: "tradeoff_coherence", label: "严密、自洽" }
        ]
      },
      {
        key: "relation_vs_plot",
        label: "在“关系发展”与“事件推进”之间",
        options: [
          { code: "tradeoff_relation", label: "关系发展" },
          { code: "tradeoff_plot", label: "事件推进" }
        ]
      },
      {
        key: "finish_vs_aftertaste",
        label: "在“完整收束”与“余韵开放”之间",
        options: [
          { code: "tradeoff_finish", label: "完整收束" },
          { code: "tradeoff_aftertaste", label: "余韵与开放解释" }
        ]
      }
    ],
    usage: "只用于候选相近时的解释性决策，不代表哪一端更成熟。"
  },
  {
    id: "q40",
    group: "I",
    groupLabel: GROUP_LABELS.I,
    type: "favorites",
    field: "actual_favorites",
    required: true,
    text: "请至少填写 1 部、最多填写 5 部“你自己真正喜欢”的动画/番剧。",
    instruction: "不是让你列公认神作，也不是最近刚看过的作品；请填即使知道有缺点、仍然愿意重看、推荐或长期记得的作品。",
    minItems: 1,
    maxItems: 5,
    maxReasons: 4,
    maxReasonText: 600
  }
].map((question, index) => ({ ...question, index: index + 1, number: index + 1 }));

const QUESTION_MAP = new Map(QUESTIONS.map((question) => [question.id, question]));

const REQUIRED_QUESTION_IDS = QUESTIONS.map((question) => question.id);

const NO_PREFERENCE_CODES = new Set(
  QUESTIONS.flatMap((question) => (question.noneCode ? [question.noneCode] : []))
);

const UNKNOWN_CODES = new Set(
  QUESTIONS.flatMap((question) => (Array.isArray(question.unknownCodes) ? question.unknownCodes : []))
);

const RANK_FIELDS = QUESTIONS.filter((question) => question.type === "rank").map((question) => question.field);

const MULTI_FIELDS = QUESTIONS.filter((question) => question.type === "multi").map((question) => question.field);

function getQuestion(id) {
  return QUESTION_MAP.get(id) || null;
}

function getFavoriteReasonLabel(code) {
  return FAVORITE_REASONS.find((reason) => reason.code === code)?.label || code;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SCHEMA_VERSION,
    QUESTIONNAIRE_VERSION,
    TEST_VERSION,
    QUESTIONS,
    QUESTION_MAP,
    REQUIRED_QUESTION_IDS,
    NO_PREFERENCE_CODES,
    UNKNOWN_CODES,
    RANK_FIELDS,
    MULTI_FIELDS,
    GROUP_LABELS,
    WORK_TYPES,
    LIKE_STRENGTHS,
    FAVORITE_REASONS,
    getQuestion,
    getFavoriteReasonLabel
  };
}
