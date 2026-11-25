(function (root) {
  "use strict";

  // 稳定 ID 是数据契约；显示名可以改，ID 不随文案变化。
  const AXES = [
    { id: "pace", label: "推进速度", low: "长时间观察一个局面", high: "每集连续出现重要变化" },
    { id: "clue_inference", label: "线索推断需求", low: "关键因果由台词交代", high: "主要靠跨场景细节拼出" },
    { id: "cast_spread", label: "人物视角分配", low: "长期跟随一个核心人物", high: "多名角色长期轮换主视角" },
    { id: "emotion_restraint", label: "情感表达含蓄度", low: "人物直接讲明感受", high: "多靠停顿、动作、镜头传达" },
    { id: "intensity", label: "情绪起伏强度", low: "整段体验大致平稳", high: "频繁或强烈的情绪转折" },
    { id: "comic_relief", label: "紧张段落的缓冲", low: "紧张段落连续展开", high: "经常用轻松互动调节紧张" },
    { id: "romance_share", label: "恋爱线比重", low: "几乎没有恋爱情节", high: "主线围绕恋爱关系展开" },
    { id: "payoff_span", label: "铺垫回收跨度", low: "多在当集内揭晓", high: "多延至篇章末或季末兑现" }
  ];
  const LEVELS = [0, 25, 50, 75, 100];

  const TAGS = [
    ["team_rotation", "队友视角轮换", "同一团队中多名成员轮流成为叙述中心。"],
    ["unit_closure", "单元闭环", "单集内提出问题并在本集收束。"],
    ["parallel_threads", "跨集并线", "多条人物或事件线在多集之间交错推进。"],
    ["mentor_lineage", "师徒传承", "知识与责任通过明确的师徒/前后辈关系传递。"],
    ["ensemble_relation", "群像关系", "多名角色之间都有独立而持续的关系线。"],
    ["live_music", "剧情内现场演奏", "音乐来自剧情中的现场演奏或表演，而非仅作配乐。"],
    ["silence_tension", "静默制造张力", "用停顿、无声或环境声而非台词制造紧张。"],
    ["long_take", "长镜头调度", "用持续较长的镜头完成空间或情绪表达。"],
    ["subjective_camera", "主观镜头", "镜头明确模拟角色的视线或心理状态。"],
    ["unreliable_narrator", "不可靠叙述", "叙述者的信息被后续事实推翻或限制。"],
    ["moral_gray", "道德灰度", "主要人物面对没有明确正确答案的价值冲突。"],
    ["world_rules", "规则设定", "世界运作依靠可理解、可验证的规则体系。"],
    ["foreshadow_payoff", "伏笔回收", "前文细节在后续被明确兑现。"],
    ["slow_burn", "慢热铺陈", "前期用较长篇幅建立人物或世界，再推进主线。"],
    ["episodic", "单元叙事", "整体由相对独立的单元构成。"],
    ["coming_of_age", "成长", "人物在经历中改变自我认识或选择。"],
    ["found_family", "非血缘家庭", "人物之间形成近似家人的支持关系。"],
    ["rivalry", "竞争关系", "竞争或对照构成人物关系的重要动力。"],
    ["romance_subplot", "恋爱支线", "恋爱关系持续存在，但不是唯一主线。"],
    ["comedy_balance", "喜剧调节", "用喜剧段落调节整体情绪。"],
    ["visual_style", "风格化画面", "画面有鲜明的色彩、构图或作画策略。"],
    ["sound_direction", "声音演出", "声音设计主动参与叙事或情绪表达。"]
  ].map(([id, label, definition]) => ({ id, label, definition }));

  const axisById = new Map(AXES.map((axis) => [axis.id, axis]));
  const tagById = new Map(TAGS.map((tag) => [tag.id, tag]));
  const value = (axis, level) => ({ axis, level });

  // 外部候选暂时只有标签，没有完整的八轴观测。这里把轴的极端值映射成检索用标签，
  // 让新发帖/找番里选择的轴至少能影响候选排序；精确轴匹配仍以作品侧观测为准。
  const axisSearchTags = {
    pace: { low: ["慢热", "日常", "治愈"], high: ["热血", "战斗", "竞技", "快节奏"] },
    clue_inference: { low: ["直白", "轻松"], high: ["悬疑", "推理", "群像"] },
    cast_spread: { low: ["单主角", "聚焦"], high: ["群像", "多人物", "人际关系"] },
    emotion_restraint: { low: ["直白", "热血"], high: ["含蓄", "氛围", "文艺"] },
    intensity: { low: ["日常", "治愈"], high: ["热血", "催泪", "紧张"] },
    comic_relief: { low: ["严肃", "沉重"], high: ["喜剧", "轻松", "日常"] },
    romance_share: { low: ["冒险", "友情"], high: ["恋爱", "校园"] },
    payoff_span: { low: ["单元剧", "日常"], high: ["剧情", "伏笔", "群像"] }
  };

  function axisTags(axes) {
    const result = [];
    for (const [id, entry] of Object.entries(axes || {})) {
      const level = Number(entry?.level ?? entry);
      const map = axisSearchTags[id];
      if (!map) continue;
      if (level >= 75) result.push(...map.high);
      else if (level <= 25) result.push(...map.low);
    }
    return [...new Set(result)];
  }

  // 标签是外部候选最稳定的资料；这里把标签反推成轴的弱估计，仅用于排序。
  const axisEvidence = {
    pace: [[["慢热", "日常", "治愈"], 25], [["热血", "战斗", "竞技", "快节奏"], 80]],
    clue_inference: [[["直白", "轻松", "日常"], 25], [["悬疑", "推理", "群像"], 78]],
    cast_spread: [[["单主角", "聚焦"], 25], [["群像", "多人物", "人际关系"], 80]],
    emotion_restraint: [[["直白", "热血"], 25], [["含蓄", "氛围", "文艺"], 75]],
    intensity: [[["日常", "治愈", "轻松"], 25], [["热血", "催泪", "紧张", "战斗"], 80]],
    comic_relief: [[["严肃", "沉重"], 25], [["喜剧", "轻松", "日常"], 75]],
    romance_share: [[["冒险", "友情", "战斗"], 20], [["恋爱", "校园"], 75]],
    payoff_span: [[["单元剧", "日常"], 25], [["剧情", "伏笔", "群像"], 78]]
  };

  function estimateAxes(tags) {
    const values = (Array.isArray(tags) ? tags : []).map((tag) => String(tag || "").trim()).filter(Boolean);
    const result = {};
    for (const [id, groups] of Object.entries(axisEvidence)) {
      let total = 0;
      let count = 0;
      for (const [words, level] of groups) {
        if (values.some((tag) => words.some((word) => tag.includes(word)))) {
          total += level;
          count += 1;
        }
      }
      if (count) result[id] = Math.round(total / count);
    }
    return result;
  }

  function axisFit(preferences, workAxes) {
    let total = 0;
    let count = 0;
    for (const [id, entry] of Object.entries(preferences || {})) {
      const preferred = Number(entry?.level ?? entry);
      const observed = Number(workAxes?.[id]);
      if (!Number.isFinite(preferred) || !Number.isFinite(observed)) continue;
      total += 1 - Math.abs(preferred - observed) / 100;
      count += 1;
    }
    return count ? total / count : 0;
  }

  // 把问卷答案粗略映射到稳定 ID。只映射定义吻合的题目标签，不把“喜欢神作”等宽泛词当特征。
  function fromAnswers(answers = {}) {
    const result = {};
    const level = (questionId) => {
      const answer = answers[questionId];
      return Number(answer?.value ?? (answer?.code?.match(/\d+$/)?.[0])) || null;
    };
    const pace = level("q35");
    if (pace >= 4) result.pace = value("pace", 75);
    if (pace === 1 || pace === 2) result.pace = value("pace", 25);
    if (level("q15") >= 4) result.clue_inference = value("clue_inference", 75);
    if (level("q21") >= 4) result.cast_spread = value("cast_spread", 75);
    if (level("q25") >= 4) result.emotion_restraint = value("emotion_restraint", 75);
    if (level("q24") >= 4) result.intensity = value("intensity", 75);
    if (level("q26") >= 4) result.comic_relief = value("comic_relief", 75);
    if (["romance_center", "romance_important"].includes(answers.q27?.code || answers.q27)) {
      result.romance_share = value("romance_share", 75);
    }
    return result;
  }

  function normalizeAxes(input) {
    if (!input || typeof input !== "object") return null;
    const result = {};
    for (const axis of AXES) {
      const entry = input[axis.id];
      const level = typeof entry === "object" ? Number(entry?.level) : Number(entry);
      if (LEVELS.includes(level)) result[axis.id] = value(axis.id, level);
    }
    return Object.keys(result).length ? result : null;
  }

  function normalizeTags(input) {
    if (!Array.isArray(input)) return [];
    return [...new Set(input.filter((code) => tagById.has(code)))].slice(0, 12);
  }

  const api = { AXES, LEVELS, TAGS, axisById, tagById, axisSearchTags, fromAnswers, normalizeAxes, normalizeTags,
    axisTags, estimateAxes, axisFit };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FEATURE_MODEL = api;
})(globalThis);
