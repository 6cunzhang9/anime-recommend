(function (root) {
  "use strict";

  const AXES = {
    intensity: "情绪强度", subtlety: "情感留白", humor: "轻松幽默", romance: "恋爱比重",
    music: "音乐表现", experiment: "形式探索", spectacle: "动作与表演", atmosphere: "氛围体验",
    pace: "推进节奏", length: "观看篇幅"
  };
  const version = "taste-1";
  const bound = (value) => Math.round(Math.min(1, Math.max(0, value)) * 100);

  function userDimensions(answers) {
    const likert = (id) => ((answers[id]?.value || 3) - 1) / 4;
    const choice = (id, scores) => scores[answers[id]] ?? 0.5;
    return {
      intensity: bound(likert("q24")), subtlety: bound(likert("q25")), humor: bound(likert("q26")),
      romance: bound(choice("q27", { romance_center: 1, romance_important: 0.75, romance_light: 0.35, romance_avoid: 0 })),
      music: bound(likert("q29")), experiment: bound(likert("q30")), spectacle: bound(likert("q31")),
      atmosphere: bound(likert("q32")),
      pace: bound(likert("q35")),
      length: bound(choice("q37", { length_film: 0.18, length_short: 0.4, length_medium: 0.62, length_long: 0.9 }))
    };
  }

  function workDimensions(work) {
    const f = work.features || {};
    const s = work.signals || {};
    const tags = (work.tags || []).join(" ");
    const theme = (pattern) => Number(pattern.test(tags));
    const pace = (Number(work.paceProxy || 3) - 1) / 4;
    const runtime = Number(work.episodes || 1) * Number(work.duration || 24);
    return {
      intensity: bound(0.13 + 0.43 * (f.dark || 0) + 0.24 * (f.action || 0) + 0.18 * theme(/生存|战争|悲剧|复仇|心理/)),
      subtlety: bound(0.27 + 0.30 * (f.healing || 0) + 0.20 * (f.mystery || 0) + 0.17 * theme(/哲学|成长|公路|家庭/)),
      humor: bound(0.12 + 0.73 * (f.comedy || 0) + 0.14 * theme(/恶搞|吐槽|搞笑/)),
      romance: bound(0.08 + 0.77 * (f.romance || 0) + 0.14 * theme(/恋爱|三角恋/)),
      music: bound(0.13 + 0.67 * (s.music || 0) + 0.18 * theme(/音乐|乐队|偶像|演奏/)),
      experiment: bound(0.14 + 0.35 * (s.visual || 0) + 0.16 * (f.mystery || 0) + 0.31 * theme(/实验|超现实|荒诞|元叙事|意识流/)),
      spectacle: bound(0.10 + 0.37 * (f.action || 0) + 0.29 * (f.sports || 0) + 0.21 * (s.visual || 0)
        + 0.15 * theme(/音乐|舞台|竞赛/)),
      atmosphere: bound(0.23 + 0.36 * (f.healing || 0) + 0.21 * (s.visual || 0) + 0.16 * theme(/旅行|日常|哲学|悬疑/)),
      pace: bound(pace * 0.68 + 0.24 * (f.action || 0) + 0.08 * (f.sports || 0)),
      length: bound(Math.log1p(runtime / 50) / Math.log(81))
    };
  }

  function affinity(user, work) {
    const keys = Object.keys(AXES);
    const delta = keys.reduce((sum, key) => sum + Math.abs((user[key] ?? 50) - work[key]), 0);
    return 1 - delta / (100 * keys.length);
  }

  // Keep stable questionnaire codes in memory. The stored indexes remain tied to this version.
  function compile(answers, questions) {
    const choices = questions.slice(0, 39).map((question) => {
      const value = answers[question.id];
      const index = (options, code) => options.findIndex((option) => option.code === code);
      if (question.type === "matrix") return question.rows.map(({ key, options }) => index(options, value?.[key]));
      if (question.type === "likert") return (value?.value ?? 0) - 1;
      if (Array.isArray(value)) return value.map((code) => index(question.options, code));
      return index(question.options, value);
    });
    return { version, dimensions: userDimensions(answers), choices };
  }

  function decode(analysis, questions) {
    if (analysis?.version !== version || !Array.isArray(analysis.choices)) return {};
    return Object.fromEntries(questions.slice(0, 39).map((question, i) => {
      const value = analysis.choices[i];
      const code = (options, index) => options[index]?.code;
      if (question.type === "matrix") return [question.id, Object.fromEntries(question.rows.map(({ key, options }, j) =>
        [key, code(options, value?.[j])]))];
      if (question.type === "likert") return [question.id, { value: value + 1, code: code(question.options, value) }];
      if (Array.isArray(value)) return [question.id, value.map((index) => code(question.options, index)).filter(Boolean)];
      return [question.id, code(question.options, value)];
    }));
  }

  const api = { AXES, version, compile, decode, userDimensions, workDimensions, affinity };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ANIME_TASTE = api;
})(globalThis);
