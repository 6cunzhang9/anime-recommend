import watch from "../../watch-model.js";

const signals = {
  q03: { m_relax: "治愈 日常", m_excite: "热血 战斗", m_move: "感动 催泪", m_think: "思考 社会", m_escape: "奇幻 冒险", m_inspire: "创作 成长" },
  q09: { set_everyday: "日常", set_school_youth: "校园 青春", set_history: "历史", set_fantasy: "奇幻",
    set_scifi: "科幻", set_mystery_urban: "悬疑 都市传说", set_music_stage: "音乐 竞技", set_adventure_conflict: "冒险 战争" },
  q13: { drive_plot: "剧情", drive_mystery: "悬疑 推理", drive_character: "成长", drive_relationship: "人物关系 群像",
    drive_world: "世界观 设定", drive_performance: "演出 作画", drive_mood: "氛围 日常" },
  q18: { char_growth: "成长", char_consistency: "现实", char_complexity: "人物塑造 反英雄", char_charm: "萌系",
    char_values: "信念", char_relation: "群像", char_identify: "青春 自我" },
  q19: { rel_friendship: "友情", rel_family: "亲情 家庭", rel_romance: "恋爱", rel_rivals: "竞技 对手",
    rel_team: "群像 社团", rel_mentor: "师徒", rel_companionship: "旅行 陪伴", rel_conflict: "群像 人际关系" },
  q23: { feel_warmth: "治愈 温暖", feel_exhilaration: "热血 竞技", feel_tension: "悬疑 紧张", feel_sadness: "催泪 悲伤",
    feel_awe: "史诗 壮阔", feel_wonder: "奇幻 超现实", feel_reflection: "思考 哲学", feel_catharsis: "感动 情绪" },
  q28: { craft_animation: "作画", craft_direction: "演出 分镜", craft_visual_style: "美术 画风",
    craft_music: "音乐", craft_voice: "声优 配音", craft_writing: "剧本 叙事" },
  q33: { theme_identity: "成长 自我", theme_connection: "亲情 陪伴", theme_ideal: "梦想 努力", theme_society: "社会 政治",
    theme_ethics: "选择 道德", theme_life_death: "生死 哲学", theme_civilization: "战争 历史", theme_creation: "艺术 创作" }
};

const ranked = new Set(["q13", "q18", "q23", "q28"]);
const exclusions = { avoid_fanservice: ["卖肉", "福利镜头"], avoid_cruelty: ["猎奇", "重口", "血腥"] };

export function isAvoided(work, answers) {
  const avoided = Array.isArray(answers?.q38) ? answers.q38 : [];
  const tags = new Set((work.features || []).map(watch.normalize));
  return avoided.some((code) => (exclusions[code] || []).some((tag) => tags.has(watch.normalize(tag))));
}

export function discoverySignals(answers, preferences, list) {
  const weights = new Map();
  const add = (tag, amount) => {
    const label = watch.normalize(tag);
    if (!label) return;
    weights.set(label, { tag, weight: (weights.get(label)?.weight || 0) + amount });
  };
  for (const [question, options] of Object.entries(signals)) {
    const selected = Array.isArray(answers?.[question])
      ? [...new Set(answers[question])].filter((code) => typeof code === "string" && Object.hasOwn(options, code)).slice(0, 4)
      : [];
    selected.forEach((code, index) => {
      const terms = options[code].split(" ");
      const total = (ranked.has(question) ? [1.8, 1, 0.6, 0.3][index] : 1.8 / selected.length);
      terms.forEach((term, i) => add(term, total * (i === 0 ? 1 : 0.55)));
    });
  }
  watch.preferenceTags(preferences).forEach((tag) => add(tag, .65));
  (list?.topTags || []).forEach((tag) => add(tag, 1));
  (list?.topReasons || []).forEach((tag) => add(tag, .6));
  return [...weights.values()].sort((a, b) => b.weight - a.weight).slice(0, 18);
}

export function scoreWork(work, signals, observedTags = []) {
  const tags = new Set([...(work.features || []), ...observedTags].map(watch.normalize));
  const text = watch.normalize([work.summary, work.title_display].join(" "));
  const matches = signals.filter(({ tag }) => {
    const key = watch.normalize(tag);
    return tags.has(key) || (key.length >= 2 && text.includes(key));
  });
  return { keywords: matches.map(({ tag }) => tag), fit: matches.reduce((sum, { weight }) => sum + weight, 0) };
}
