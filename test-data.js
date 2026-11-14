/* 本命番鉴定所 · 测评结构
 *
 * 人格部分参考公开领域 IPIP / Big Five 的测量思路：每个特质 4 题、正反向作答。
 * 中文条目为本项目自译改写，并非标准化临床量表。
 * 内容偏好和观看习惯是显式偏好信号，用来避免“只看性格推番”。
 */

const TEST_VERSION = "2.0.0";

const SCALE_CONFIG = {
  agree: {
    title: "这句话有多符合你？",
    instruction: "按平时的你作答，而不是理想中的你",
    labels: ["很不符合", "不太符合", "一般", "比较符合", "非常符合"],
    shortLabels: ["很不符合", "不太符合", "一般", "比较符合", "非常符合"]
  },
  interest: {
    title: "这类内容有多吸引你？",
    instruction: "想象你正好有一整晚的空闲",
    labels: ["完全不想看", "不太想看", "一般", "比较想看", "非常想看"],
    shortLabels: ["完全不想", "不太想看", "一般", "比较想看", "非常想看"]
  }
};

const TRAITS = [
  {
    key: "O",
    name: "开放性",
    en: "Openness",
    color: "#b7a3ff",
    highLabel: "好奇探索",
    lowLabel: "务实熟悉",
    highDesc: "你更容易被新题材、抽象想法和陌生视角吸引。",
    lowDesc: "你更看重熟悉、具体、可验证的体验。",
    note: "高低都不是优点或缺点，只描述你通常如何吸收新经验。"
  },
  {
    key: "C",
    name: "尽责性",
    en: "Conscientiousness",
    color: "#93b9cf",
    highLabel: "计划自律",
    lowLabel: "灵活随性",
    highDesc: "你偏好目标、结构和把一件事做完的踏实感。",
    lowDesc: "你更愿意保留弹性，让当下的状态决定节奏。",
    note: "尽责性关于秩序与执行偏好，不代表道德水平。"
  },
  {
    key: "E",
    name: "外向性",
    en: "Extraversion",
    color: "#efbc69",
    highLabel: "社交活力",
    lowLabel: "内敛沉浸",
    highDesc: "人、对话和现场感常常是你的能量来源。",
    lowDesc: "独处、内化与自己的小宇宙更容易让你回血。",
    note: "这只是能量方式，不等于社恐或社交能力。"
  },
  {
    key: "A",
    name: "宜人性",
    en: "Agreeableness",
    color: "#97b8a1",
    highLabel: "共情合作",
    lowLabel: "直率独立",
    highDesc: "你更容易共情他人，也愿意优先维护关系。",
    lowDesc: "你更重视直率、独立判断和不委屈自己的边界。",
    note: "宜人性不是“老好人程度”，低分也不代表冷漠。"
  },
  {
    key: "N",
    name: "情绪敏感度",
    en: "Emotional Sensitivity",
    color: "#f0a08d",
    highLabel: "感受细腻",
    lowLabel: "情绪稳定",
    highDesc: "你更容易觉察压力和情绪波动，也常对故事里的痛感更敏锐。",
    lowDesc: "你通常不容易被情绪淹没，恢复节奏更快。",
    note: "这里测的是情绪敏感与波动，不是焦虑症或任何临床诊断。"
  }
];

const TRAIT_MAP = Object.fromEntries(TRAITS.map((trait) => [trait.key, trait]));

const FEATURES = [
  {
    key: "fantasy",
    name: "奇幻 / 世界构建",
    short: "奇幻",
    emoji: "🪄",
    color: "#8f7dcc",
    desc: "架空世界、魔法、神话与成体系的设定。"
  },
  {
    key: "scifi",
    name: "科幻 / 机甲",
    short: "科幻",
    emoji: "🌌",
    color: "#6fa3c7",
    desc: "未来社会、太空、机器人、时间与科技伦理。"
  },
  {
    key: "healing",
    name: "日常 / 治愈",
    short: "治愈",
    emoji: "🍵",
    color: "#84ad94",
    desc: "生活流、慢节奏、情绪安全感和细小的温暖。"
  },
  {
    key: "action",
    name: "热血 / 战斗",
    short: "热血",
    emoji: "⚔️",
    color: "#dc775d",
    desc: "高燃动作、成长、胜负与正面冲突。"
  },
  {
    key: "mystery",
    name: "悬疑 / 智斗",
    short: "悬疑",
    emoji: "🔍",
    color: "#b39559",
    desc: "谜题、反转、推理、信息差和策略博弈。"
  },
  {
    key: "romance",
    name: "恋爱 / 青春",
    short: "恋爱",
    emoji: "🌸",
    color: "#d78b96",
    desc: "心动、错过、关系变化与成长中的连接。"
  },
  {
    key: "dark",
    name: "黑暗 / 心理",
    short: "暗色",
    emoji: "🌑",
    color: "#8d7b9e",
    desc: "沉重议题、道德灰度、心理压迫与代价。"
  },
  {
    key: "comedy",
    name: "喜剧 / 搞笑",
    short: "喜剧",
    emoji: "🎭",
    color: "#e0a45c",
    desc: "吐槽、荒诞、节奏明快的轻松体验。"
  },
  {
    key: "sports",
    name: "运动 / 竞技",
    short: "竞技",
    emoji: "🏐",
    color: "#84a7a3",
    desc: "训练、团队、对手与可见的成长。"
  }
];

const FEATURE_MAP = Object.fromEntries(FEATURES.map((feature) => [feature.key, feature]));

const HABITS = [
  {
    key: "escape",
    name: "逃离现实",
    desc: "用作品暂时离开现实压力，进入另一个世界。",
    icon: "🪐"
  },
  {
    key: "meaning",
    name: "意义反思",
    desc: "希望作品能带来思考，而不只是消磨时间。",
    icon: "🕯️"
  },
  {
    key: "social",
    name: "社交话题",
    desc: "会因为同好讨论和共同话题去接触一部作品。",
    icon: "💬"
  },
  {
    key: "visual",
    name: "作画演出",
    desc: "重视镜头语言、作画与视觉表达。",
    icon: "🎞️"
  },
  {
    key: "music",
    name: "声音音乐",
    desc: "配乐和声音表现会显著影响观看体验。",
    icon: "🎧"
  },
  {
    key: "pace",
    name: "快节奏",
    desc: "偏好推进快、每集有信息的叙事节奏。",
    icon: "⏩"
  }
];

const HABIT_MAP = Object.fromEntries(HABITS.map((habit) => [habit.key, habit]));

/* 20 个 Big Five 题，来源于公开领域的 IPIP 条目思路。
 * reverse 为 true 时，1–5 分在计分时反向。
 * 顺序有意混合不同特质和正反向条目，降低“猜测试意图”的效应。 */
const BIG_FIVE_ITEMS = [
  { key: "O1", trait: "O", reverse: false, text: "我有很丰富的想象力。" },
  { key: "E1", trait: "E", reverse: true, text: "我通常话不多。" },
  { key: "C1", trait: "C", reverse: false, text: "我会尽快把该做的事情做完。" },
  { key: "N1", trait: "N", reverse: false, text: "我容易感到紧张或压力。" },
  { key: "A1", trait: "A", reverse: false, text: "我会设身处地体会别人的感受。" },
  { key: "O2", trait: "O", reverse: true, text: "我很难理解抽象的概念。" },
  { key: "E2", trait: "E", reverse: false, text: "在聚会里，我常常是带动气氛的人。" },
  { key: "C2", trait: "C", reverse: true, text: "我经常忘记把东西放回原处。" },
  { key: "N2", trait: "N", reverse: true, text: "我大多数时候都很放松。" },
  { key: "A2", trait: "A", reverse: true, text: "我对别人的烦恼不太感兴趣。" },
  { key: "C3", trait: "C", reverse: false, text: "我喜欢井然有序。" },
  { key: "O3", trait: "O", reverse: false, text: "我常常会思考一些抽象或宏大的问题。" },
  { key: "E3", trait: "E", reverse: false, text: "和一群人待在一起时，我通常很自在。" },
  { key: "N3", trait: "N", reverse: false, text: "我的情绪容易起伏。" },
  { key: "A3", trait: "A", reverse: false, text: "我的心肠比较软。" },
  { key: "O4", trait: "O", reverse: true, text: "我对抽象的话题不太感兴趣。" },
  { key: "E4", trait: "E", reverse: true, text: "我习惯待在人群后面。" },
  { key: "C4", trait: "C", reverse: true, text: "我有时会逃避自己该负的责任。" },
  { key: "A4", trait: "A", reverse: true, text: "我其实不太关心别人的事。" },
  { key: "N4", trait: "N", reverse: true, text: "我很少感到低落。" }
];

const PREFERENCE_ITEMS = [
  { key: "pref-fantasy", feature: "fantasy", text: "看到架空世界、魔法与完整设定时，我会特别想点开。" },
  { key: "pref-scifi", feature: "scifi", text: "太空、机甲、人工智能或未来社会题材对我有天然吸引力。" },
  { key: "pref-healing", feature: "healing", text: "我喜欢节奏舒缓、能让人放松下来的日常故事。" },
  { key: "pref-action", feature: "action", text: "高燃战斗和角色一步步变强的过程会让我很享受。" },
  { key: "pref-mystery", feature: "mystery", text: "谜题、反转、推理和智斗会让我停不下来。" },
  { key: "pref-romance", feature: "romance", text: "我喜欢看人物之间的心动、错过与关系变化。" },
  { key: "pref-dark", feature: "dark", text: "我愿意看议题沉重、道德复杂、带心理压迫感的作品。" },
  { key: "pref-comedy", feature: "comedy", text: "轻松搞笑、吐槽和荒诞感能让我迅速进入状态。" },
  { key: "pref-sports", feature: "sports", text: "竞技、团队合作与训练成长的故事会让我投入。" }
];

const HABIT_ITEMS = [
  { key: "habit-escape", habit: "escape", text: "我看番主要是为了暂时离开现实压力，进入另一个世界。" },
  { key: "habit-meaning", habit: "meaning", text: "如果一部作品能让我思考现实问题，我会更满足。" },
  { key: "habit-social", habit: "social", text: "我会因为想和别人有共同话题而去看某部番。" },
  { key: "habit-visual", habit: "visual", text: "作画、演出和镜头语言会显著影响我对一部番的评价。" },
  { key: "habit-music", habit: "music", text: "配乐和声音表现对我是否喜欢一部番很重要。" },
  { key: "habit-pace", habit: "pace", text: "比起慢热铺陈，我更喜欢节奏快、每集都有推进的作品。" }
];

const ATTENTION_ITEMS = [
  {
    key: "attention-1",
    text: "请在本题选择「比较符合」。",
    expected: 4,
    stage: "middle"
  },
  {
    key: "attention-2",
    text: "为了确认你正在认真阅读，本题请选择「很不符合」。",
    expected: 1,
    stage: "late"
  }
];

function makeLikertItem(item, index, type) {
  return {
    id: `q-${String(index + 1).padStart(2, "0")}`,
    index: index + 1,
    section: type,
    responseType: type === "preference" ? "interest" : "agree",
    text: item.text,
    trait: item.trait || null,
    feature: item.feature || null,
    habit: item.habit || null,
    reverse: Boolean(item.reverse),
    attention: false,
    attentionKey: null,
    expected: null,
    itemKey: item.key
  };
}

/* 题目顺序：
 * 前 8 题人格 → 注意力检查 → 其余 12 题人格 → 9 题内容偏好 → 注意力检查 → 6 题观看习惯。
 * 注意力检查保持低显著度，但会在数据中明确标记。 */
const QUESTION_ORDER = [
  ...BIG_FIVE_ITEMS.slice(0, 8).map((item) => ({ type: "personality", item })),
  { type: "attention", item: ATTENTION_ITEMS[0] },
  ...BIG_FIVE_ITEMS.slice(8).map((item) => ({ type: "personality", item })),
  ...PREFERENCE_ITEMS.map((item) => ({ type: "preference", item })),
  { type: "attention", item: ATTENTION_ITEMS[1] },
  ...HABIT_ITEMS.map((item) => ({ type: "habit", item }))
];

const QUESTIONS = QUESTION_ORDER.map((entry, index) => {
  if (entry.type === "attention") {
    return {
      id: `q-${String(index + 1).padStart(2, "0")}`,
      index: index + 1,
      section: "attention",
      responseType: "agree",
      text: entry.item.text,
      trait: "A",
      feature: null,
      habit: null,
      reverse: false,
      attention: true,
      attentionKey: entry.item.key,
      expected: entry.item.expected,
      itemKey: entry.item.key
    };
  }
  return makeLikertItem(entry.item, index, entry.type);
});

const ARCHETYPES = {
  "O+C": {
    name: "世界构建师",
    emoji: "🧭",
    description: "好奇心负责把你带向陌生世界，秩序感负责把那些设定、伏笔和人物关系拼成完整图景。你喜欢的番，往往既能让你沉浸，又能让你看见它如何被搭起来。"
  },
  "O+E": {
    name: "灵感点火者",
    emoji: "✨",
    description: "你需要新鲜感，也需要把那份兴奋传递出去。脑洞大、气质独特、能和朋友聊起来的作品，最容易成为你的“年度番”。"
  },
  "O+A": {
    name: "共情漫游者",
    emoji: "🌿",
    description: "你愿意走进陌生的视角，也愿意理解人物为什么会成为现在的样子。能让你留下来的，通常不是最吵的作品，而是最有呼吸感的作品。"
  },
  "O+N": {
    name: "情绪考古家",
    emoji: "🌘",
    description: "你对氛围、隐喻和情绪暗流很敏锐。你不怕复杂或难受的作品，只要它足够真诚，能说出一些你平时说不清的东西。"
  },
  "C+E": {
    name: "追番项目经理",
    emoji: "📋",
    description: "你愿意为目标投入，也喜欢和大家一起把一件事推进下去。结构扎实、人物靠谱、节奏有回应的作品，会让你追得很安心。"
  },
  "C+A": {
    name: "温柔秩序派",
    emoji: "🫖",
    description: "你重视承诺、关系和把生活过好的能力。你偏爱的作品，常常既有清楚的骨架，也愿意给角色留出被理解的空间。"
  },
  "C+N": {
    name: "细节预警员",
    emoji: "🕯️",
    description: "你会注意到别人忽略的伏笔，也提前感受到故事里的风险。你需要的不是一味轻松，而是逻辑自洽、情绪有托底的作品。"
  },
  "E+A": {
    name: "同好召集人",
    emoji: "🎉",
    description: "你从人群和连接里获得能量，也擅长把喜欢变成共享的快乐。群像、羁绊、能和朋友一起聊到深夜的番，就是你的主场。"
  },
  "E+N": {
    name: "热烈共感者",
    emoji: "🔥",
    description: "你的感受强烈，表达也直接。你会被热血和真诚点燃，也会认真接住角色最脆弱的地方；能让你上头的番通常情绪浓度很高。"
  },
  "A+N": {
    name: "温柔共鸣者",
    emoji: "🌙",
    description: "你很容易共情，也容易记住那些轻轻的、不吵的情绪。你喜欢的作品往往不一定最“神”，但一定在某一个瞬间认真地看见了你。"
  }
};

function buildArchetypeKey(traitA, traitB) {
  const order = TRAITS.map((trait) => trait.key);
  return [traitA, traitB].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join("+");
}

const DATA_QUALITY = {
  minimumSeconds: 75,
  straightLineStdDev: 0.38,
  note: "低于时长门槛、明显直线作答或未通过注意力检查的样本会被标记，不计入有效样本统计；数据仍会保留，便于复核和重新清洗。"
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TEST_VERSION,
    SCALE_CONFIG,
    TRAITS,
    TRAIT_MAP,
    FEATURES,
    FEATURE_MAP,
    HABITS,
    HABIT_MAP,
    QUESTIONS,
    ARCHETYPES,
    DATA_QUALITY,
    buildArchetypeKey
  };
}
