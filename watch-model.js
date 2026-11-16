(function (root) {
  "use strict";
  const criteria = {
    story: "故事", characters: "角色", world: "设定", pacing: "节奏",
    emotion: "情绪感染力", art: "画面与画风", sound: "音乐与声音"
  };
  const preferences = {
    characters: ["冷面但温柔", "热血成长", "聪明冷静", "反英雄", "元气乐天", "笨拙真诚", "群像主角", "亦正亦邪", "强者带队", "普通人逆袭"],
    art: ["清新治愈", "复古赛璐珞", "写实细腻", "大胆色彩", "简洁可爱", "暗黑厚重", "夸张变形", "水墨手绘", "细密华丽"]
  };
  const glossary = {
    "群像": /群像|ensemble|supporting cast/i, "人物成长": /成长|成長|character development|coming.of.age/i,
    "反英雄": /反英雄|anti.hero|morally gray/i, "世界观": /世界观|世界觀|设定|world.build/i,
    "伏笔回收": /伏笔|伏筆|foreshadow|payoff/i, "节奏鲜明": /节奏|節奏|pacing/i,
    "战斗作画": /战斗|戰鬥|sakuga|fight scene|choreograph/i, "美术风格": /画风|畫風|美术|美術|art.style|visual/i,
    "治愈日常": /治愈|治癒|日常|iyashikei|slice.of.life/i, "音乐配乐": /配乐|配樂|音乐|音樂|soundtrack|ost\b/i,
    "情感表达": /情感|感动|感動|情绪|emotional|heartwarming/i, "悬疑推理": /悬疑|懸疑|推理|mystery|suspense/i,
    "喜剧": /搞笑|喜剧|喜劇|幽默|comedy|hilarious/i, "恋爱关系": /恋爱|戀愛|感情线|romance|chemistry/i,
    "配音表演": /声优|聲優|配音|voice acting/i, "镜头演出": /镜头|鏡頭|分镜|分鏡|cinematography|direction/i,
    "结局": /结局|結局|结尾|ending|finale/i
  };
  const normalize = (value) => String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, "");
  function tags(values, max = 8) {
    if (!Array.isArray(values)) return [];
    const unique = new Map();
    for (const value of values) {
      if (typeof value !== "string") continue;
      const label = value.normalize("NFKC").trim().replace(/[\p{C}]/gu, "").slice(0, 28);
      if (normalize(label) && !unique.has(normalize(label))) unique.set(normalize(label), label);
      if (unique.size >= max) break;
    }
    return [...unique.values()];
  }
  function abstract(text) {
    return Object.entries(glossary).filter(([, pattern]) => pattern.test(String(text || "").slice(0, 12000)))
      .map(([label]) => label);
  }
  function scores(value) {
    if (!value || typeof value !== "object") return null;
    const points = Object.keys(criteria).map((key) => value[key]);
    if (points.some((point) => !Number.isInteger(point) || point < 1 || point > 10)) return null;
    return Object.fromEntries(Object.keys(criteria).map((key, index) => [key, points[index]]));
  }
  function review(value) {
    if (!value || typeof value !== "object") return null;
    const dimensions = scores(value.dimensions);
    if (!dimensions) return null;
    return {
      dimensions,
      tags: tags(value.tags),
      comment: typeof value.comment === "string" ? value.comment.trim().slice(0, 600) : ""
    };
  }
  function choices(value) {
    return Object.fromEntries(Object.entries(preferences).map(([key, allowed]) =>
      [key, tags(value?.[key], 4).filter((item) => allowed.includes(item))]));
  }
  const preferenceAliases = {
    "冷面但温柔": ["傲娇", "反差萌"], "热血成长": ["热血", "成长"], "聪明冷静": ["智斗", "推理"],
    "反英雄": ["反英雄", "黑暗"], "元气乐天": ["喜剧", "搞笑"], "笨拙真诚": ["青春", "成长"],
    "群像主角": ["群像"], "亦正亦邪": ["灰色道德", "心理"], "强者带队": ["冒险", "战斗"], "普通人逆袭": ["成长", "热血"],
    "清新治愈": ["治愈", "日常"], "复古赛璐珞": ["赛璐珞", "复古"], "写实细腻": ["写实", "现实"],
    "大胆色彩": ["风格化", "色彩"], "简洁可爱": ["萌系", "日常"], "暗黑厚重": ["黑暗", "哥特"],
    "夸张变形": ["实验", "超现实", "夸张"], "水墨手绘": ["水墨", "手绘"], "细密华丽": ["作画", "美术"]
  };
  function preferenceTags(value) {
    const parsed = choices(value);
    return tags([...parsed.characters, ...parsed.art].flatMap((label) => preferenceAliases[label] || [label]), 24);
  }
  function average(dimensions) {
    if (!dimensions) return null;
    const values = Object.values(dimensions);
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10 : null;
  }
  function tastes(entries) {
    const watched = entries.filter((item) => item.status === "watched" && !(item.work?.provider === "bangumi-series" &&
      entries.some((child) => child.status === "watched" && child.work?.provider === "bangumi" &&
        (child.work.series_id === item.work.provider_id || item.members?.includes(child.work.provider_id)))));
    const counts = new Map();
    const reasons = new Map();
    const points = {};
    let rated = 0;
    for (const entry of watched) {
      for (const tag of tags(entry.features, 16)) counts.set(tag, (counts.get(tag) || 0) + (entry.love === "favorite" ? 2 : 1));
      if (entry.love !== "dislike") {
        for (const tag of tags(entry.review?.tags)) reasons.set(tag, (reasons.get(tag) || 0) + (entry.love === "favorite" ? 2 : 1));
      }
      const dimensions = scores(entry.review?.dimensions);
      if (!dimensions) continue;
      rated += 1;
      for (const [key, value] of Object.entries(dimensions)) points[key] = (points[key] || 0) + value;
    }
    return {
      watched: watched.length,
      rewatches: watched.reduce((sum, item) => sum + Math.max(0, (Number(item.plays) || 1) - 1), 0),
      topTags: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag]) => tag),
      topReasons: [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag]) => tag),
      dimensions: rated ? Object.fromEntries(Object.entries(points).map(([key, value]) => [key, Math.round(value / rated * 10) / 10])) : null
    };
  }
  const api = { criteria, preferences, glossary, normalize, tags, abstract, scores, review, choices, preferenceTags, average, tastes };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WATCH_MODEL = api;
})(globalThis);
