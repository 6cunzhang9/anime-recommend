/* global TEST_VERSION, SCALE_CONFIG, TRAITS, TRAIT_MAP, FEATURES, FEATURE_MAP, HABITS, HABIT_MAP, QUESTIONS, ARCHETYPES, DATA_QUALITY, buildArchetypeKey, CATALOG_META, ANIME_CATALOG */

(function () {
  "use strict";

  const ALGORITHM_VERSION = "hybrid-fit-v2";
  const STORAGE_KEY = "anime-soul-lab:responses:v2";
  const ADMIN_TOKEN_STORAGE_KEY = "anime-soul-lab:admin-token";
  const MAX_LOCAL_RECORDS = 300;
  const RANK_LABELS = ["最值得先试", "同频备选", "另一条口味线"];
  const FEATURE_KEYS = FEATURES.map((feature) => feature.key);

  const RECOMMENDATION_WEIGHTS = {
    taste: 0.5,
    personality: 0.14,
    habit: 0.1,
    quality: 0.18,
    craft: 0.08
  };

  /* Big Five → 内容气质的“启发式”映射，只作为辅助信号；
   * 它无法替代用户直接说出的偏好，也不代表心理学上的因果结论。 */
  const TRAIT_FEATURE_WEIGHTS = {
    O: { fantasy: 0.32, scifi: 0.24, mystery: 0.2, dark: 0.14, comedy: 0.06, romance: 0.04, healing: 0.03, action: 0.02, sports: 0 },
    C: { mystery: 0.26, sports: 0.18, action: 0.14, fantasy: 0.14, healing: 0.1, scifi: 0.08, romance: 0.05, comedy: 0.03, dark: 0.02 },
    E: { comedy: 0.28, action: 0.24, sports: 0.18, romance: 0.12, fantasy: 0.08, mystery: 0.05, healing: 0.05, scifi: 0.05, dark: 0 },
    A: { healing: 0.32, romance: 0.26, comedy: 0.14, sports: 0.1, fantasy: 0.08, scifi: 0.02, mystery: 0.02, dark: 0.02, action: 0.02 },
    N: { dark: 0.3, romance: 0.22, mystery: 0.16, healing: 0.14, fantasy: 0.06, comedy: 0.02, scifi: 0.02, action: 0.02, sports: 0 }
  };

  const HABIT_FEATURE_WEIGHTS = {
    escape: { fantasy: 0.4, scifi: 0.3, action: 0.2, dark: 0.1 },
    meaning: { dark: 0.35, mystery: 0.25, fantasy: 0.15, healing: 0.1, romance: 0.1 },
    social: { comedy: 0.35, romance: 0.25, sports: 0.2, action: 0.1 },
    pace: { action: 0.35, comedy: 0.25, sports: 0.2, mystery: 0.1, healing: 0.05, romance: 0.05 }
  };

  const FEATURE_PITCH = {
    fantasy: "把陌生世界的规则、历史与代价铺成一条可以走进去的路",
    scifi: "用未来设定和极端处境，把人性的选择推到台前",
    healing: "让角色在日常里慢慢恢复呼吸，也让观众有地方放下防备",
    action: "用动作、胜负和成长把情绪一层层推到高点",
    mystery: "让信息差、推理和反转成为持续追看的动力",
    romance: "把关系里的靠近、犹豫和错过写进主线",
    dark: "把代价、道德灰度与人性的暗面摆到台面上",
    comedy: "用节奏、吐槽和荒诞感拆掉日常的紧张",
    sports: "把训练、对手与团队磨合变成看得见的成长"
  };

  const FEATURE_TAG_HINTS = {
    fantasy: ["奇幻", "魔法", "异世界", "神话", "诅咒", "超自然", "中世纪", "龙", "精灵", "妖怪", "冒险"],
    scifi: ["科幻", "机甲", "太空", "赛博朋克", "机器人", "人工智能", "未来", "时间", "科技", "宇宙"],
    healing: ["治愈", "日常", "生活流", "家庭", "料理", "自然", "乡野", "校园", "旅行", "音乐"],
    action: ["动作", "战斗", "剑术", "超能力", "热血", "武术", "战争", "刺客", "忍者", "武士", "枪战"],
    mystery: ["悬疑", "推理", "侦探", "犯罪", "心理", "时间操控", "时间循环", "阴谋", "调查", "谜题", "黑帮", "诈骗"],
    romance: ["恋爱", "青春", "初恋", "心动", "关系", "成长", "少女向", "女性主角"],
    dark: ["黑暗", "恐怖", "悲剧", "血腥", "死亡", "战争", "存在主义", "成人议题", "虐待", "自杀", "心理"],
    comedy: ["喜剧", "搞笑", "吐槽", "无厘头", "戏仿", "讽刺", "荒诞", "日常"],
    sports: ["运动", "竞技", "团队", "训练", "比赛", "棒球", "篮球", "排球", "足球", "拳击", "跑步", "花滑", "将棋"]
  };

  const FLAG_LABELS = {
    attention: "未通过注意力校验",
    straight_lining: "人格题呈明显直线作答",
    too_fast: "完成时间低于质量门槛"
  };

  const STUDIO_DISPLAY = {
    "bones": "BONES",
    "white fox": "WHITE FOX",
    "madhouse": "MADHOUSE",
    "wit studio": "WIT STUDIO",
    "p.a.works": "P.A.WORKS",
    "j.c.staff": "J.C.STAFF",
    "kinema citrus": "Kinema Citrus",
    "brain's base": "Brain's Base",
    "gainax": "GAINAX",
    "trigger": "TRIGGER",
    "sanzigen": "SANZIGEN",
    "silver link.": "SILVER LINK.",
    "studio pierrot": "Studio Pierrot",
    "comix wave": "CoMix Wave",
    "studio deen": "Studio DEEN",
    "zero-g": "Zero-G",
    "zexcs": "ZEXCS",
    "naz": "NAZ",
    "orange": "Orange",
    "feel.": "feel.",
    "geno studio": "Geno Studio",
    "platinum vision": "Platinum Vision",
    "a.c.g.t.": "A.C.G.T.",
    "c-station": "C-Station",
    "hal film maker": "Hal Film Maker",
    "imagin": "Imagin",
    "shin-ei animation": "Shin-Ei Animation",
    "radix": "Radix",
    "triangle staff": "Triangle Staff",
    "lerche": "Lerche",
    "studio durian": "Studio Durian",
    "topcraft": "Topcraft",
    "tokyo movie shinsha": "Tokyo Movie Shinsha",
    "kitty film": "Kitty Film",
    "tatsunoko production": "Tatsunoko Production",
    "nippon animation": "Nippon Animation",
    "artland": "Artland",
    "manglobe": "Manglobe",
    "aic": "AIC",
    "gonzo": "GONZO",
    "doga kobo": "Doga Kobo",
    "8bit": "8bit",
    "c2c": "C2C",
    "passione": "Passione",
    "liden films": "Liden Films",
    "studio 3hz": "Studio 3Hz",
    "studio bind": "Studio Bind",
    "olm": "OLM",
    "toei animation": "Toei Animation",
    "sunrise": "Sunrise",
    "production i.g": "Production I.G",
    "science saru": "Science SARU",
    "a-1 pictures": "A-1 Pictures",
    "cloverworks": "CloverWorks",
    "kyoto animation": "Kyoto Animation",
    "ufotable": "ufotable",
    "studio ghibli": "Studio Ghibli"
  };

  const state = {
    screen: "intro",
    questionIndex: 0,
    answers: new Array(QUESTIONS.length).fill(null),
    locked: false,
    advanceTimer: null,
    loadingTimer: null,
    loadingMessageTimer: null,
    result: null,
    apiOnline: false,
    storageBackend: "local-file",
    adminAuthRequired: false,
    localRecords: [],
    submitted: false,
    lastFocusedElement: null,
    testStartedAt: null,
    testFinishedAt: null,
    lastAnswerAt: null,
    responseTimes: new Array(QUESTIONS.length).fill(null)
  };

  const QUESTION_META = (() => {
    let personality = 0;
    let preference = 0;
    let habit = 0;
    return QUESTIONS.map((question) => {
      if (question.section === "personality") {
        personality += 1;
        return { label: `关于你 · ${personality} / 20`, type: "PERSONALITY" };
      }
      if (question.section === "preference") {
        preference += 1;
        return { label: `内容口味 · ${preference} / 9`, type: "CONTENT TASTE" };
      }
      if (question.section === "habit") {
        habit += 1;
        return { label: `观看习惯 · ${habit} / 6`, type: "VIEWING HABIT" };
      }
      return { label: "关于你 · 补充确认", type: "CHECK" };
    });
  })();

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const dom = {
    screens: {
      intro: $("#screen-intro"),
      test: $("#screen-test"),
      loading: $("#screen-loading"),
      result: $("#screen-result")
    },
    startButton: $("#start-btn"),
    questionKind: $("#question-kind"),
    questionText: $("#question-text"),
    questionCounter: $("#question-counter"),
    questionNumber: $("#question-number"),
    scaleInstruction: $("#scale-instruction"),
    options: $("#options"),
    progressFill: $("#progress-fill"),
    progressTrack: $(".progress-track"),
    prevButton: $("#prev-btn"),
    testExitButton: $("#test-exit-btn"),
    loadingTitle: $("#loading-title"),
    profileCard: $("#profile-card"),
    bigfiveRadar: $("#bigfive-radar"),
    typeEmoji: $("#type-emoji"),
    typeName: $("#type-name"),
    typeDescription: $("#type-description"),
    traitChips: $("#trait-chips"),
    bigfiveList: $("#bigfive-list"),
    tasteGrid: $("#taste-grid"),
    habitSummary: $("#habit-summary"),
    recommendations: $("#recommendations"),
    recommendationReasons: $("#recommendation-reasons"),
    favoriteForm: $("#favorite-form"),
    favoriteTitle: $("#favorite-title"),
    favoriteReason: $("#favorite-reason"),
    reasonCount: $("#reason-count"),
    consentCheckbox: $("#consent-checkbox"),
    submitFavorite: $("#submit-favorite"),
    formError: $("#form-error"),
    favoriteThanks: $("#favorite-thanks"),
    thanksTitle: $("#thanks-title"),
    thanksReason: $("#thanks-reason"),
    thanksCompare: $("#thanks-compare"),
    saveStatus: $("#save-status"),
    saveStatusText: $("#save-status-text"),
    dataModal: $("#data-modal"),
    dataSource: $("#data-source"),
    dataQualitySummary: $("#data-quality-summary"),
    adminExport: $("#admin-export"),
    adminToken: $("#admin-token"),
    catalogList: $("#catalog-list"),
    statTotal: $("#stat-total"),
    statReason: $("#stat-reason"),
    statHit: $("#stat-hit"),
    exportJson: $("#export-json"),
    exportCsv: $("#export-csv"),
    toast: $("#toast"),
    resultHeading: $(".result-heading")
  };

  function padNumber(number, length = 2) {
    return String(number).padStart(length, "0");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `asl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }

  function formatCount(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return "样本数待补";
    if (number >= 10000) {
      const tenThousands = number / 10000;
      return `${tenThousands >= 100 ? Math.round(tenThousands) : tenThousands.toFixed(1).replace(/\.0$/, "")} 万`;
    }
    return String(Math.round(number));
  }

  function formatScore(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(1) : "—";
  }

  function studioLabel(name) {
    return STUDIO_DISPLAY[String(name || "").toLowerCase()] || name || "制作信息待补";
  }

  function showToast(message) {
    if (!dom.toast) return;
    dom.toast.textContent = message;
    dom.toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      dom.toast.hidden = true;
    }, 4600);
  }

  function cleanupTimers() {
    window.clearTimeout(state.advanceTimer);
    window.clearTimeout(state.loadingTimer);
    window.clearInterval(state.loadingMessageTimer);
    state.advanceTimer = null;
    state.loadingTimer = null;
    state.loadingMessageTimer = null;
    state.locked = false;
  }

  function showScreen(name) {
    Object.entries(dom.screens).forEach(([screenName, element]) => {
      if (!element) return;
      element.classList.toggle("is-active", screenName === name);
    });
    state.screen = name;
    document.body.classList.toggle("is-focus-mode", name === "test" || name === "loading");
    scrollToTop();
  }

  /* ------------------------------------------------------------------
     Test flow
     ------------------------------------------------------------------ */

  function renderQuestionText(text) {
    dom.questionText.replaceChildren();
    const breakIndex = Math.max(
      text.lastIndexOf("，"),
      text.lastIndexOf("；"),
      text.lastIndexOf("："),
      text.lastIndexOf("。")
    );
    if (breakIndex > 0 && breakIndex < text.length - 1) {
      const head = document.createTextNode(text.slice(0, breakIndex + 1));
      const tail = document.createElement("span");
      tail.className = "question-tail";
      tail.textContent = text.slice(breakIndex + 1);
      dom.questionText.append(head, tail);
      return;
    }
    dom.questionText.textContent = text;
  }

  function renderQuestion({ announce = true } = {}) {
    const question = QUESTIONS[state.questionIndex];
    const selectedValue = state.answers[state.questionIndex];
    const meta = QUESTION_META[state.questionIndex];
    const scale = SCALE_CONFIG[question.responseType] || SCALE_CONFIG.agree;

    renderQuestionText(question.text);
    dom.questionKind.textContent = question.attention ? "关于你 · 补充确认" : meta.label;
    dom.questionCounter.innerHTML = `${padNumber(state.questionIndex + 1)} <em>/ ${QUESTIONS.length}</em>`;
    dom.questionNumber.textContent = `QUESTION ${padNumber(state.questionIndex + 1)}`;
    dom.scaleInstruction.textContent = question.attention
      ? "请严格按题目文字选择，不需要揣测测试目的。"
      : `${scale.title} ${scale.instruction}`;
    dom.prevButton.disabled = state.questionIndex === 0;
    dom.options.replaceChildren();

    scale.shortLabels.forEach((label, index) => {
      const value = index + 1;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "scale-option";
      button.dataset.value = String(value);
      button.setAttribute("aria-label", `${value} 分，${scale.labels[index]}`);
      button.setAttribute("aria-pressed", selectedValue === value ? "true" : "false");
      if (selectedValue === value) button.classList.add("is-selected");

      const number = document.createElement("span");
      number.className = "scale-number";
      number.textContent = String(value);
      const shortLabel = document.createElement("span");
      shortLabel.className = "scale-label";
      shortLabel.textContent = label;
      button.append(number, shortLabel);
      button.addEventListener("click", () => selectAnswer(value));
      dom.options.append(button);
    });

    updateProgress();
    if (announce) {
      window.requestAnimationFrame(() => {
        dom.questionText.focus({ preventScroll: true });
      });
    }
  }

  function updateProgress() {
    const answeredCurrent = Boolean(state.answers[state.questionIndex]);
    const percent = ((state.questionIndex + (answeredCurrent ? 1 : 0)) / QUESTIONS.length) * 100;
    dom.progressFill.style.width = `${percent}%`;
    dom.progressTrack.setAttribute("aria-valuemax", String(QUESTIONS.length));
    dom.progressTrack.setAttribute("aria-valuenow", String(state.questionIndex + 1));
    dom.progressTrack.setAttribute(
      "aria-valuetext",
      `第 ${state.questionIndex + 1} 题，共 ${QUESTIONS.length} 题`
    );
  }

  function selectAnswer(value) {
    if (state.locked || state.screen !== "test") return;
    if (!Number.isInteger(value) || value < 1 || value > 5) return;

    const now = Date.now();
    if (state.lastAnswerAt) {
      state.responseTimes[state.questionIndex] = now - state.lastAnswerAt;
    }
    state.lastAnswerAt = now;
    state.answers[state.questionIndex] = value;
    state.locked = true;

    $$(".scale-option", dom.options).forEach((button) => {
      const selected = button.dataset.value === String(value);
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      button.disabled = true;
    });
    updateProgress();

    state.advanceTimer = window.setTimeout(() => {
      state.locked = false;
      if (state.questionIndex === QUESTIONS.length - 1) {
        finishTest();
        return;
      }
      state.questionIndex += 1;
      renderQuestion();
      const testTop = dom.screens.test ? dom.screens.test.offsetTop - 18 : 0;
      if (window.scrollY > Math.max(testTop, 20)) {
        window.scrollTo({ top: testTop, behavior: prefersReducedMotion() ? "auto" : "smooth" });
      }
    }, 260);
  }

  function startTest() {
    cleanupTimers();
    state.questionIndex = 0;
    state.answers = new Array(QUESTIONS.length).fill(null);
    state.responseTimes = new Array(QUESTIONS.length).fill(null);
    state.result = null;
    state.submitted = false;
    state.locked = false;
    state.testStartedAt = Date.now();
    state.testFinishedAt = null;
    state.lastAnswerAt = state.testStartedAt;
    resetFavoriteForm();
    setSubmitButtonBusy(false);
    showScreen("test");
    renderQuestion();
  }

  function goToPreviousQuestion() {
    if (state.locked || state.screen !== "test" || state.questionIndex === 0) return;
    state.questionIndex -= 1;
    renderQuestion();
  }

  function finishTest() {
    if (state.answers.some((answer) => !answer)) {
      showToast("还有题目没有完成，请再检查一下。");
      return;
    }
    state.testFinishedAt = Date.now();
    showScreen("loading");

    const loadingMessages = [
      "正在读取你的全部回答",
      "正在计算 Big Five 与口味信号",
      "正在过滤口碑不足的作品",
      "正在排队最值得先试的番"
    ];
    let messageIndex = 0;
    dom.loadingTitle.textContent = loadingMessages[0];
    state.loadingMessageTimer = window.setInterval(() => {
      messageIndex = Math.min(messageIndex + 1, loadingMessages.length - 1);
      dom.loadingTitle.textContent = loadingMessages[messageIndex];
    }, 460);

    state.loadingTimer = window.setTimeout(() => {
      window.clearInterval(state.loadingMessageTimer);
      state.loadingMessageTimer = null;
      try {
        const result = calculateResult();
        state.result = result;
        renderResult(result);
        showScreen("result");
        window.setTimeout(() => {
          if (dom.resultHeading) {
            dom.resultHeading.setAttribute("tabindex", "-1");
            dom.resultHeading.focus({ preventScroll: true });
          }
        }, 80);
      } catch (error) {
        console.error(error);
        showScreen("intro");
        showToast("计算结果时出了点问题，请再试一次。");
      }
    }, 1900);
  }

  function handleTestKeydown(event) {
    if (state.screen !== "test" || state.locked) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const tagName = event.target && event.target.tagName;
    if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return;

    if (/^[1-5]$/.test(event.key)) {
      event.preventDefault();
      selectAnswer(Number(event.key));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goToPreviousQuestion();
    }
  }

  /* ------------------------------------------------------------------
     Scoring
     ------------------------------------------------------------------ */

  function standardDeviation(values) {
    if (!values.length) return 0;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  function calculateResult() {
    const answers = state.answers;
    if (answers.some((answer) => !answer)) throw new Error("Incomplete answers");

    const traitScores = {};
    const traitTotals = {};
    TRAITS.forEach((trait) => {
      traitScores[trait.key] = 0;
      traitTotals[trait.key] = 0;
    });

    const preferences = {};
    const habits = {};
    const attentionChecks = [];
    const personalityResponses = [];

    QUESTIONS.forEach((question, index) => {
      const value = Number(answers[index]);
      if (question.section === "personality") {
        const scored = question.reverse ? 6 - value : value;
        traitScores[question.trait] += scored;
        traitTotals[question.trait] += 1;
        personalityResponses.push(value);
      } else if (question.section === "attention") {
        attentionChecks.push({
          id: question.id,
          itemKey: question.itemKey,
          expected: question.expected,
          response: value,
          passed: value === question.expected
        });
      } else if (question.section === "preference") {
        preferences[question.feature] = value;
      } else if (question.section === "habit") {
        habits[question.habit] = value;
      }
    });

    const traits = TRAITS.map((trait) => {
      const average = traitScores[trait.key] / Math.max(1, traitTotals[trait.key]);
      const score = Math.round(((average - 1) / 4) * 100);
      return { ...trait, score };
    }).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return TRAITS.findIndex((trait) => trait.key === a.key) - TRAITS.findIndex((trait) => trait.key === b.key);
    });

    const topTwoTraits = traits.slice(0, 2);
    const archetypeKey = buildArchetypeKey(topTwoTraits[0].key, topTwoTraits[1].key);
    const archetype = ARCHETYPES[archetypeKey] || {
      name: "自由漫游者",
      emoji: "✦",
      description: "你的组合比较少被命名。比起急着归类，你更适合在多条口味线之间自由切换。"
    };

    const attentionPassed = attentionChecks.every((check) => check.passed);
    const straightLine = standardDeviation(personalityResponses) < DATA_QUALITY.straightLineStdDev;
    const finishedAt = state.testFinishedAt || Date.now();
    const startedAt = state.testStartedAt || finishedAt;
    const durationSeconds = Math.max(0, Math.round((finishedAt - startedAt) / 1000));
    const flags = [];
    if (!attentionPassed) flags.push("attention");
    if (straightLine) flags.push("straight_lining");
    if (durationSeconds < DATA_QUALITY.minimumSeconds) flags.push("too_fast");
    const quality = {
      valid: flags.length === 0,
      attentionPassed,
      straightLining: straightLine,
      durationSeconds,
      flags
    };

    const preferenceEntries = FEATURES.map((feature) => ({
      ...feature,
      value: preferences[feature.key] || 3
    })).sort((a, b) => {
      if (b.value !== a.value) return b.value - a.value;
      return FEATURE_KEYS.indexOf(a.key) - FEATURE_KEYS.indexOf(b.key);
    });

    const habitEntries = HABITS.map((habit) => ({
      ...habit,
      value: habits[habit.key] || 3
    })).sort((a, b) => {
      if (b.value !== a.value) return b.value - a.value;
      return Object.keys(HABIT_MAP).indexOf(a.key) - Object.keys(HABIT_MAP).indexOf(b.key);
    });

    const traitScoresByKey = Object.fromEntries(traits.map((trait) => [trait.key, trait.score]));
    const habitScoresByKey = Object.fromEntries(habitEntries.map((habit) => [habit.key, habit.value]));
    const affinity = buildPersonalityAffinity(traitScoresByKey);
    const rating = rankCatalog({ preferences, habits, traitScores: traitScoresByKey, affinity });
    const top3 = rating.ranking.slice(0, 3).map((entry, index) => ({
      ...entry,
      rank: index + 1,
      reasons: buildReasons(entry, {
        preferenceEntries,
        traits,
        habits: habitScoresByKey
      })
    }));

    return {
      traits,
      preferences,
      preferenceEntries,
      habits: habitScoresByKey,
      habitEntries,
      archetypeKey,
      archetype,
      quality,
      attentionChecks,
      affinity,
      ranking: rating.ranking,
      top3,
      weightedAverage: rating.weightedAverage,
      weights: RECOMMENDATION_WEIGHTS,
      totalEligible: rating.totalEligible,
      catalogCount: rating.catalogCount
    };
  }

  function buildPersonalityAffinity(traitScores) {
    const vector = Object.fromEntries(FEATURE_KEYS.map((feature) => [feature, 0]));
    TRAITS.forEach((trait) => {
      const high = Math.max(0, (traitScores[trait.key] - 50) / 50);
      if (!high) return;
      Object.entries(TRAIT_FEATURE_WEIGHTS[trait.key] || {}).forEach(([feature, weight]) => {
        vector[feature] += high * weight;
      });
    });
    return vector;
  }

  function directTasteScore(preferences, anime) {
    let positiveWeighted = 0;
    let positiveWeight = 0;
    let negativeWeighted = 0;
    let negativeWeight = 0;

    FEATURE_KEYS.forEach((key) => {
      const rating = Number(preferences[key] || 3);
      const animeValue = Number(anime.features[key] || 0);
      if (rating > 3) {
        const weight = (rating - 3) / 2;
        positiveWeighted += animeValue * weight;
        positiveWeight += weight;
      } else if (rating < 3) {
        const weight = (3 - rating) / 2;
        negativeWeighted += animeValue * weight;
        negativeWeight += weight;
      }
    });

    if (!positiveWeight) return 0.5;
    const favorable = positiveWeighted / positiveWeight;
    const penalty = negativeWeight ? negativeWeighted / negativeWeight : 0;
    return clamp(favorable - penalty * 0.34, 0, 1);
  }

  function weightedAffinityScore(anime, affinity) {
    let score = 0;
    let total = 0;
    FEATURE_KEYS.forEach((key) => {
      const value = Number(affinity[key] || 0);
      if (value <= 0) return;
      score += Number(anime.features[key] || 0) * value;
      total += value;
    });
    return total ? clamp(score / total, 0, 1) : 0.5;
  }

  function habitScore(habits, anime) {
    let score = 0;
    let total = 0;
    Object.entries(HABIT_FEATURE_WEIGHTS).forEach(([habitKey, weights]) => {
      const raw = Number(habits[habitKey] || 3);
      const intensity = Math.max(0, (raw - 3) / 2);
      if (!intensity) return;
      Object.entries(weights).forEach(([feature, weight]) => {
        score += Number(anime.features[feature] || 0) * weight * intensity;
        total += weight * intensity;
      });
    });
    return total ? clamp(score / total, 0, 1) : 0.5;
  }

  function craftScore(habits, anime) {
    const visual = clamp((Number(habits.visual || 3) - 1) / 4, 0, 1);
    const music = clamp((Number(habits.music || 3) - 1) / 4, 0, 1);
    const total = visual + music;
    if (!total) return 0.5;
    const visualSignal = Number(anime.signals?.visual || 0.5);
    const musicSignal = Number(anime.signals?.music || 0.5);
    return clamp((visualSignal * visual + musicSignal * music) / total, 0, 1);
  }

  function qualityScore(anime) {
    const community = Number(anime.quality?.communityScore || 0);
    return clamp((community - 7.2) / 2.2, 0, 1);
  }

  function rankCatalog({ preferences, habits, traitScores, affinity }) {
    const eligibleCatalog = ANIME_CATALOG.filter((anime) => anime.quality?.eligible);
    const fallbackCatalog = ANIME_CATALOG.filter((anime) => !anime.quality?.eligible);
    const candidates = eligibleCatalog.length >= 3 ? eligibleCatalog : ANIME_CATALOG;

    const ranking = candidates.map((anime) => {
      const directTaste = directTasteScore(preferences, anime);
      const personality = weightedAffinityScore(anime, affinity);
      const habit = habitScore(habits, anime);
      const quality = qualityScore(anime);
      const craft = craftScore(habits, anime);
      const rawScore = (
        directTaste * RECOMMENDATION_WEIGHTS.taste +
        personality * RECOMMENDATION_WEIGHTS.personality +
        habit * RECOMMENDATION_WEIGHTS.habit +
        quality * RECOMMENDATION_WEIGHTS.quality +
        craft * RECOMMENDATION_WEIGHTS.craft
      );
      const matchPercent = Math.round(clamp(70 + rawScore * 28, 70, 98));

      return {
        anime,
        rank: 0,
        rawScore,
        matchPercent,
        components: {
          taste: Math.round(directTaste * 100),
          personality: Math.round(personality * 100),
          habit: Math.round(habit * 100),
          quality: Math.round(quality * 100),
          craft: Math.round(craft * 100)
        }
      };
    }).sort((a, b) => {
      if (b.rawScore !== a.rawScore) return b.rawScore - a.rawScore;
      return (b.anime.quality?.communityScore || 0) - (a.anime.quality?.communityScore || 0);
    }).map((entry, index) => ({ ...entry, rank: index + 1 }));

    const weightedAverage = ranking.length
      ? ranking.reduce((sum, entry) => sum + entry.rawScore, 0) / ranking.length
      : 0;

    return {
      ranking,
      weightedAverage,
      totalEligible: eligibleCatalog.length,
      catalogCount: ANIME_CATALOG.length,
      fallbackCount: fallbackCatalog.length
    };
  }

  function findFeatureTagEvidence(featureKey, tags) {
    const hints = FEATURE_TAG_HINTS[featureKey] || [];
    return tags.filter((tag) => hints.some((hint) => tag.includes(hint) || hint.includes(tag)));
  }

  function buildReasons(entry, context) {
    const anime = entry.anime;
    const reasons = [];
    const rankedFeatures = FEATURE_KEYS
      .map((key) => ({
        ...FEATURE_MAP[key],
        animeValue: Number(anime.features[key] || 0),
        userValue: Number(context.preferenceEntries.find((feature) => feature.key === key)?.value || 3),
        tagEvidence: findFeatureTagEvidence(key, anime.tags)
      }))
      .sort((a, b) => b.animeValue - a.animeValue);

    const directCandidates = rankedFeatures
      .filter((feature) => feature.userValue >= 4 && feature.animeValue >= 0.22 && feature.tagEvidence.length)
      .sort((a, b) => {
        const scoreA = a.userValue * 0.55 + a.animeValue * 0.9 + Math.min(2, a.tagEvidence.length) * 0.35;
        const scoreB = b.userValue * 0.55 + b.animeValue * 0.9 + Math.min(2, b.tagEvidence.length) * 0.35;
        return scoreB - scoreA;
      });
    const directMatch = directCandidates[0];

    if (directMatch) {
      reasons.push(
        `你在「${directMatch.name}」上给了 ${directMatch.userValue}/5；本作在「${directMatch.tagEvidence.slice(0, 3).join("、")}」等标签上与这个方向直接相连。`
      );
    } else {
      const topUserFeatures = context.preferenceEntries.slice(0, 2).map((feature) => `「${feature.short}」`).join("、");
      reasons.push(
        `你这次更偏 ${topUserFeatures}；它更靠近「${anime.tags.slice(0, 3).join("、")}」，这次是作为一条相邻口味的探索线推荐给你。`
      );
    }

    const animeTopKeys = rankedFeatures.slice(0, 2).map((feature) => feature.key);
    const traitCandidates = context.traits
      .filter((trait) => trait.score >= 50)
      .map((trait) => {
        const weights = animeTopKeys.map((key) => TRAIT_FEATURE_WEIGHTS[trait.key]?.[key] || 0);
        const linkedFeature = FEATURE_MAP[animeTopKeys[weights.indexOf(Math.max(...weights))]];
        return { trait, weight: Math.max(...weights), linkedFeature };
      })
      .filter((item) => item.weight >= 0.12)
      .sort((a, b) => b.weight * b.trait.score - a.weight * a.trait.score);
    const traitMatch = traitCandidates[0];

    if (traitMatch) {
      reasons.push(
        `从这次的自评看，你的「${traitMatch.trait.name}」相对突出（${traitMatch.trait.score}/100）；它与「${traitMatch.linkedFeature.name}」气质有交集，而这只是辅助排序信号，不是定论。`
      );
    }

    if (Number(context.habits.visual) >= 4 || Number(context.habits.music) >= 4) {
      const careParts = [];
      if (Number(context.habits.visual) >= 4) careParts.push("作画与演出");
      if (Number(context.habits.music) >= 4) careParts.push("配乐与声音");
      const hasSpecificStudioNote = anime.studioNote && anime.studioNote !== "制作信息以公开资料为准";
      if (hasSpecificStudioNote) {
        reasons.push(
          `你明确表示重视${careParts.join("、")}。本作由${studioLabel(anime.studio)}制作，${anime.studioNote}。`
        );
      }
    } else if (Number(context.habits.meaning) >= 4 && ["dark", "mystery"].some((key) => (anime.features[key] || 0) > 0.45)) {
      reasons.push("你希望作品能留下值得思考的东西，而它的主题和叙事密度适合慢慢咀嚼。");
    }

    return reasons.slice(0, 3);
  }

  /* ------------------------------------------------------------------
     Result rendering
     ------------------------------------------------------------------ */

  function renderRadar(traits) {
    const width = 360;
    const height = 330;
    const cx = 180;
    const cy = 166;
    const radius = 102;
    const labelRadius = 136;
    const count = traits.length;
    const angleFor = (index) => -Math.PI / 2 + (index * Math.PI * 2) / count;
    const pointFor = (index, scale) => {
      const angle = angleFor(index);
      return [cx + Math.cos(angle) * radius * scale, cy + Math.sin(angle) * radius * scale];
    };
    const polygon = (scale) => traits.map((_, index) => pointFor(index, scale).join(",")).join(" ");
    const points = traits.map((trait, index) => pointFor(index, clamp(trait.score / 100, 0.08, 1)));
    const levels = [0.25, 0.5, 0.75, 1];

    const grid = levels.map((level) => {
      return `<polygon points="${polygon(level)}" fill="none" stroke="rgba(23,20,27,${level === 1 ? 0.28 : 0.12})" stroke-width="1"/>`;
    }).join("");

    const axes = traits.map((_, index) => {
      const [x, y] = pointFor(index, 1);
      return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="rgba(23,20,27,0.14)" stroke-width="1"/>`;
    }).join("");

    const labels = traits.map((trait, index) => {
      const [x, y] = pointFor(index, 1.28);
      const anchor = x > cx + 8 ? "start" : x < cx - 8 ? "end" : "middle";
      return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle" class="radar-label"><tspan class="radar-letter">${trait.key}</tspan><tspan x="${x}" dy="15" class="radar-word">${trait.name}</tspan></text>`;
    }).join("");

    const dots = traits.map((trait, index) => {
      const [x, y] = points[index];
      return `<circle cx="${x}" cy="${y}" r="4" fill="#f26451" stroke="#17141b" stroke-width="2"/>`;
    }).join("");

    const svg = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Big Five 五维分数雷达图：${traits.map((trait) => `${trait.name} ${trait.score} 分`).join("，")}">
        <defs>
          <linearGradient id="radar-fill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#f26451" stop-opacity="0.45"/>
            <stop offset="100%" stop-color="#b7a3ff" stop-opacity="0.24"/>
          </linearGradient>
        </defs>
        ${grid}
        ${axes}
        <polygon points="${points.map((point) => point.join(",")).join(" ")}" fill="url(#radar-fill)" stroke="#f26451" stroke-width="2"/>
        ${dots}
        ${labels}
      </svg>
    `;

    dom.bigfiveRadar.innerHTML = svg;
    dom.bigfiveRadar.style.setProperty("--radar-accent", traits[0].color);
    dom.bigfiveRadar.setAttribute(
      "aria-label",
      `Big Five 五维分数雷达图：${traits.map((trait) => `${trait.name} ${trait.score} 分`).join("，")}`
    );
  }

  function renderBigFive(traits) {
    dom.bigfiveList.replaceChildren();
    traits.forEach((trait) => {
      const card = document.createElement("article");
      card.className = "trait-card";
      card.style.setProperty("--trait-color", trait.color);
      const top = document.createElement("div");
      top.className = "trait-card-head";
      const letter = document.createElement("span");
      letter.className = "trait-letter";
      letter.textContent = trait.key;
      const names = document.createElement("div");
      names.className = "trait-names";
      const name = document.createElement("strong");
      name.textContent = trait.name;
      const english = document.createElement("small");
      english.textContent = trait.en;
      names.append(name, english);
      const score = document.createElement("span");
      score.className = "trait-score";
      score.textContent = String(trait.score);
      top.append(letter, names, score);

      const meter = document.createElement("div");
      meter.className = "trait-meter";
      meter.setAttribute("aria-hidden", "true");
      const fill = document.createElement("span");
      fill.style.width = `${trait.score}%`;
      meter.append(fill);

      const note = document.createElement("p");
      note.className = "trait-card-note";
      if (trait.score >= 60) note.textContent = trait.highDesc;
      else if (trait.score <= 40) note.textContent = trait.lowDesc;
      else note.textContent = "这一维度上，你的自评较为居中，两端特质都可能出现。";

      const caption = document.createElement("span");
      caption.className = "trait-caption";
      caption.textContent = trait.score >= 60 ? trait.highLabel : trait.score <= 40 ? trait.lowLabel : "居中";

      card.append(top, meter, note, caption);
      dom.bigfiveList.append(card);
    });
  }

  function renderTaste(result) {
    dom.tasteGrid.replaceChildren();
    result.preferenceEntries.forEach((feature, index) => {
      const card = document.createElement("article");
      card.className = `taste-card${index < 3 ? " is-top" : ""}`;
      card.style.setProperty("--taste-color", feature.color);
      const top = document.createElement("div");
      top.className = "taste-card-head";
      const icon = document.createElement("span");
      icon.className = "taste-icon";
      icon.textContent = feature.emoji;
      const name = document.createElement("span");
      name.className = "taste-name";
      name.textContent = feature.name;
      const value = document.createElement("strong");
      value.className = "taste-value";
      value.textContent = `${feature.value}/5`;
      top.append(icon, name, value);

      const meter = document.createElement("div");
      meter.className = "taste-meter";
      meter.setAttribute("aria-hidden", "true");
      for (let dot = 1; dot <= 5; dot += 1) {
        const segment = document.createElement("span");
        if (dot <= feature.value) segment.className = "is-filled";
        meter.append(segment);
      }

      const desc = document.createElement("p");
      desc.textContent = feature.desc;
      card.append(top, meter, desc);
      dom.tasteGrid.append(card);
    });

    dom.habitSummary.replaceChildren();
    const title = document.createElement("p");
    title.className = "habit-summary-title";
    title.textContent = "观看习惯 / 这些信号影响排序，但不替代内容偏好";
    dom.habitSummary.append(title);

    const chips = document.createElement("div");
    chips.className = "habit-chips";
    result.habitEntries.forEach((habit, index) => {
      const chip = document.createElement("span");
      chip.className = `habit-chip${index < 2 ? " is-top" : ""}`;
      chip.textContent = `${habit.icon} ${habit.name} ${habit.value}/5`;
      chips.append(chip);
    });
    dom.habitSummary.append(chips);
  }

  function formatTitleSub(anime) {
    const formatLabel = anime.format === "MOVIE" ? "剧场版" : anime.format === "ONA" ? "ONA" : anime.format === "OVA" ? "OVA" : "TV";
    const episodeLabel = anime.format === "MOVIE" ? "" : anime.episodes ? ` · ${anime.episodes} 集` : "";
    return `${anime.native || anime.romaji} · ${anime.year} · ${formatLabel}${episodeLabel}`;
  }

  function createPoster(anime, index) {
    const poster = document.createElement("div");
    poster.className = "anime-poster";
    poster.setAttribute("aria-hidden", "true");
    poster.style.setProperty("--poster-a", anime.colors[0]);
    poster.style.setProperty("--poster-b", anime.colors[1]);
    poster.style.setProperty("--poster-c", anime.colors[2]);

    const indexLabel = document.createElement("span");
    indexLabel.className = "poster-index";
    indexLabel.textContent = `NO.${padNumber(index + 1)}`;
    const jp = document.createElement("span");
    jp.className = "poster-jp";
    jp.textContent = anime.native || anime.romaji;
    const emoji = document.createElement("span");
    emoji.className = "poster-emoji";
    emoji.textContent = anime.emoji;
    const posterTitle = document.createElement("p");
    posterTitle.className = "poster-title";
    posterTitle.textContent = anime.title;
    const posterMeta = document.createElement("small");
    posterMeta.textContent = `${anime.year} · ${anime.format === "MOVIE" ? "剧场版" : anime.format}`;
    posterTitle.append(posterMeta);
    poster.append(indexLabel, jp, emoji, posterTitle);
    return poster;
  }

  function createMatchWrap(entry, label = "综合匹配") {
    const matchWrap = document.createElement("div");
    matchWrap.className = "match-wrap";
    const gauge = document.createElement("div");
    gauge.className = "match-gauge";
    gauge.style.setProperty("--match", `${entry.matchPercent}%`);
    gauge.setAttribute("role", "img");
    gauge.setAttribute("aria-label", `${label} ${entry.matchPercent}%`);
    const gaugeInner = document.createElement("div");
    gaugeInner.className = "match-gauge-inner";
    gaugeInner.textContent = String(entry.matchPercent);
    const percent = document.createElement("small");
    percent.textContent = "%";
    gaugeInner.append(percent);
    gauge.append(gaugeInner);
    const matchLabel = document.createElement("span");
    matchLabel.className = "match-label";
    matchLabel.textContent = label;
    matchWrap.append(gauge, matchLabel);
    return matchWrap;
  }

  function createTags(anime, limit = 4) {
    const tags = document.createElement("div");
    tags.className = "rec-tags";
    anime.tags.slice(0, limit).forEach((tagText) => {
      const tag = document.createElement("span");
      tag.className = "rec-tag";
      tag.textContent = tagText;
      tags.append(tag);
    });
    return tags;
  }

  function createEvidence(anime) {
    const evidence = document.createElement("div");
    evidence.className = "rec-evidence";
    const scorePills = [
      {
        text: `MAL ${anime.quality.malScore !== null ? formatScore(anime.quality.malScore) : "—"}`,
        href: anime.malId ? `https://myanimelist.net/anime/${anime.malId}` : null,
        score: true
      },
      {
        text: `AniList ${anime.quality.anilistScore ?? "—"}`,
        href: anime.anilistUrl || null,
        score: true
      },
      { text: `MAL ${formatCount(anime.quality.malScoredBy)}人评分` },
      { text: studioLabel(anime.studio) }
    ];
    scorePills.forEach((item) => {
      const tagName = item.href ? "a" : "span";
      const pill = document.createElement(tagName);
      pill.className = "rec-evidence-pill";
      if (item.score) pill.classList.add("is-score");
      pill.textContent = item.text;
      if (item.href) {
        pill.href = item.href;
        pill.target = "_blank";
        pill.rel = "noopener noreferrer";
        pill.title = "打开该平台的作品页";
        pill.classList.add("is-link");
      }
      evidence.append(pill);
    });
    const band = document.createElement("span");
    band.className = "rec-band";
    band.textContent = anime.quality.band;
    evidence.append(band);
    return evidence;
  }

  function createEssence(anime) {
    const essence = document.createElement("p");
    essence.className = "rec-essence";
    const topFeature = FEATURE_KEYS
      .map((key) => ({ ...FEATURE_MAP[key], value: anime.features[key] || 0 }))
      .sort((a, b) => b.value - a.value)[0];
    const featureEvidence = findFeatureTagEvidence(topFeature.key, anime.tags);
    essence.textContent = featureEvidence.length
      ? `它最鲜明的方向是「${featureEvidence.slice(0, 2).join("、")}」：${FEATURE_PITCH[topFeature.key]}。`
      : `它在「${anime.tags.slice(0, 3).join("、")}」这些标签上最有辨识度，类型并不单一，适合先试一集再判断。`;
    return essence;
  }

  function createBreakdown(entry) {
    const breakdown = document.createElement("details");
    breakdown.className = "rec-breakdown";
    const summary = document.createElement("summary");
    summary.textContent = "查看匹配构成";
    const components = document.createElement("div");
    components.className = "rec-components";
    [
      ["直接口味", entry.components.taste, 50],
      ["Big Five 辅助", entry.components.personality, 14],
      ["观看习惯", entry.components.habit, 10],
      ["口碑质量", entry.components.quality, 18],
      ["制作信号", entry.components.craft, 8]
    ].forEach(([label, value, weight]) => {
      const row = document.createElement("div");
      row.className = "rec-component";
      const name = document.createElement("span");
      name.textContent = `${label} · ${weight}%`;
      const track = document.createElement("span");
      track.className = "rec-component-track";
      const fill = document.createElement("i");
      fill.style.width = `${value}%`;
      track.append(fill);
      const score = document.createElement("b");
      score.textContent = String(value);
      row.append(name, track, score);
      components.append(row);
    });
    const breakdownNote = document.createElement("p");
    breakdownNote.className = "rec-component-note";
    breakdownNote.textContent = "各项先归一化为 0–100 的匹配度，再按左列权重合成；不是直接相加的原始分数。";
    breakdown.append(summary, components, breakdownNote);
    return breakdown;
  }

  function renderRecommendations(result) {
    dom.recommendations.replaceChildren();
    result.top3.forEach((entry, index) => {
      const anime = entry.anime;
      const card = document.createElement("article");
      card.className = `rec-card rec-summary-card${index === 0 ? " is-primary" : ""}`;

      const body = document.createElement("div");
      body.className = "rec-body";

      const top = document.createElement("div");
      top.className = "rec-topline";
      const topLeft = document.createElement("div");
      const kickerRow = document.createElement("div");
      kickerRow.className = "rec-kicker-row";
      const rankLabel = document.createElement("span");
      rankLabel.className = "rec-rank-label";
      rankLabel.textContent = `${padNumber(index + 1)} / ${RANK_LABELS[index]}`;
      kickerRow.append(rankLabel, createTags(anime, 4));
      topLeft.append(kickerRow);
      top.append(topLeft, createMatchWrap(entry));

      const title = document.createElement("h3");
      title.className = "rec-title";
      title.textContent = anime.title;
      const titleSub = document.createElement("small");
      titleSub.textContent = formatTitleSub(anime);
      title.append(titleSub);

      body.append(top, title, createEvidence(anime), createEssence(anime));
      card.append(createPoster(anime, index), body);
      dom.recommendations.append(card);
    });
  }

  function renderRecommendationReasons(result) {
    dom.recommendationReasons.replaceChildren();

    result.top3.forEach((entry, index) => {
      const anime = entry.anime;
      const card = document.createElement("article");
      card.className = "reason-card";

      const head = document.createElement("div");
      head.className = "reason-card-head";
      const rank = document.createElement("span");
      rank.className = "reason-index";
      rank.textContent = `NO.${padNumber(index + 1)}`;
      const heading = document.createElement("div");
      heading.className = "reason-heading";
      const title = document.createElement("h3");
      title.textContent = anime.title;
      const meta = document.createElement("p");
      meta.textContent = `${RANK_LABELS[index]} · ${anime.quality.band} · 制作 ${studioLabel(anime.studio)}`;
      heading.append(title, meta);
      head.append(rank, heading, createMatchWrap(entry, "综合匹配"));

      const tags = document.createElement("div");
      tags.className = "reason-tags";
      tags.append(createTags(anime, 5));

      const reasons = document.createElement("div");
      reasons.className = "rec-reasons";
      const reasonsLabel = document.createElement("div");
      reasonsLabel.className = "rec-reasons-label";
      reasonsLabel.textContent = "为什么推荐给你";
      const reasonList = document.createElement("ul");
      entry.reasons.forEach((reasonText) => {
        const item = document.createElement("li");
        item.textContent = reasonText;
        reasonList.append(item);
      });
      reasons.append(reasonsLabel, reasonList);

      card.append(head, tags, reasons, createBreakdown(entry));

      if (anime.caveats && anime.caveats.length) {
        const caveat = document.createElement("p");
        caveat.className = "rec-caveat";
        const label = document.createElement("strong");
        label.textContent = "注意";
        caveat.append(label, document.createTextNode(anime.caveats.join("；")));
        card.append(caveat);
      }

      dom.recommendationReasons.append(card);
    });
  }

  function renderResult(result) {
    const topTrait = result.traits[0];
    dom.profileCard.style.setProperty("--profile-tone", topTrait.color);
    dom.typeEmoji.textContent = result.archetype.emoji || "✦";
    dom.typeName.textContent = result.archetype.name;

    const topFeatures = result.preferenceEntries.slice(0, 2);
    dom.typeDescription.textContent = `${result.archetype.description} 在本次作答里，你最先想看的是「${topFeatures.map((feature) => feature.short).join("」「")}」这类内容；这些显式口味会优先于性格标签参与排序。`;
    const traitByKey = new Map(result.traits.map((trait) => [trait.key, trait]));
    const canonicalTraits = TRAITS.map((trait) => ({ ...trait, score: traitByKey.get(trait.key)?.score ?? 50 }));

    dom.traitChips.replaceChildren();
    result.traits.slice(0, 2).forEach((trait) => {
      const chip = document.createElement("span");
      chip.className = "trait-chip";
      const strong = document.createElement("b");
      strong.textContent = trait.key;
      const text = document.createElement("span");
      text.textContent = `${trait.name} ${trait.score}`;
      chip.append(strong, text);
      dom.traitChips.append(chip);
    });
    topFeatures.forEach((feature) => {
      const chip = document.createElement("span");
      chip.className = "trait-chip taste-chip";
      const emoji = document.createElement("span");
      emoji.textContent = feature.emoji;
      const text = document.createElement("span");
      text.textContent = `${feature.short} ${feature.value}/5`;
      chip.append(emoji, text);
      dom.traitChips.append(chip);
    });

    renderRadar(canonicalTraits);
    renderBigFive(canonicalTraits);
    renderTaste(result);
    renderRecommendations(result);
    renderRecommendationReasons(result);
    resetFavoriteForm();
    setSubmitButtonBusy(false);
    dom.favoriteThanks.hidden = true;
    dom.favoriteForm.hidden = false;
  }

  /* ------------------------------------------------------------------
     Favorite collection
     ------------------------------------------------------------------ */

  function resetFavoriteForm() {
    if (!dom.favoriteForm) return;
    dom.favoriteForm.reset();
    dom.favoriteForm.hidden = false;
    dom.favoriteThanks.hidden = true;
    dom.formError.hidden = true;
    dom.formError.textContent = "";
    dom.favoriteTitle.removeAttribute("aria-invalid");
    dom.reasonCount.textContent = "0";
    dom.consentCheckbox.checked = true;
    dom.saveStatus.classList.remove("is-local");
    dom.saveStatusText.textContent = "正在保存…";
  }

  function setSubmitButtonBusy(isBusy) {
    if (!dom.submitFavorite) return;
    dom.submitFavorite.disabled = isBusy;
    if (isBusy) {
      dom.submitFavorite.replaceChildren(document.createTextNode("正在收录…"));
    } else {
      const label = document.createElement("span");
      label.textContent = "提交我的本命，继续浏览";
      const arrow = document.createElement("span");
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "→";
      dom.submitFavorite.replaceChildren(label, arrow);
    }
  }

  function showFormError(message) {
    dom.formError.textContent = message;
    dom.formError.hidden = false;
    dom.favoriteTitle.setAttribute("aria-invalid", "true");
    dom.favoriteTitle.focus();
  }

  function normalizeTitle(value) {
    return String(value)
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/[\s《》〈〉「」『』【】\[\]()（）:：!！?？·・.,，。;；\-—_'"“”‘’]+/g, "");
  }

  function compareFavorite(rawTitle) {
    const normalized = normalizeTitle(rawTitle);
    let matchedAnime = null;

    if (normalized.length >= 2) {
      matchedAnime = ANIME_CATALOG.find((anime) => {
        const candidates = [anime.title, anime.romaji, anime.english, anime.native, ...(anime.aliases || [])]
          .map(normalizeTitle)
          .filter((candidate) => candidate.length >= 2);
        return candidates.some((candidate) => {
          if (candidate === normalized) return true;
          if (normalized.length >= 3 && candidate.includes(normalized)) return true;
          if (candidate.length >= 3 && normalized.includes(candidate)) return true;
          return false;
        });
      }) || null;
    }

    if (!matchedAnime || !state.result) {
      return {
        normalizedTitle: normalized,
        matchedAnimeId: null,
        matchedAnimeTitle: null,
        predictedRank: null,
        matchStatus: "none"
      };
    }

    const rankedEntry = state.result.ranking.find((entry) => entry.anime.id === matchedAnime.id);
    const predictedRank = rankedEntry ? rankedEntry.rank : null;
    let matchStatus = "catalog";
    if (predictedRank === 1) matchStatus = "top1";
    else if (predictedRank && predictedRank <= 3) matchStatus = "top3";

    return {
      normalizedTitle: normalized,
      matchedAnimeId: matchedAnime.id,
      matchedAnimeTitle: matchedAnime.title,
      predictedRank,
      matchStatus,
      recommendable: Boolean(matchedAnime.quality?.eligible)
    };
  }

  function buildRecord(rawTitle, reason, consent, comparison) {
    const result = state.result;
    const scores = {
      bigFive: Object.fromEntries(result.traits.map((trait) => [trait.key, trait.score])),
      preferences: Object.fromEntries(FEATURES.map((feature) => [feature.key, result.preferences[feature.key] || 3])),
      habits: { ...result.habits }
    };

    return {
      schemaVersion: 2,
      testVersion: TEST_VERSION,
      algorithmVersion: ALGORITHM_VERSION,
      catalogVersion: CATALOG_META.sourceSnapshotDate || CATALOG_META.generatedAt || "unknown",
      id: uid(),
      createdAt: new Date().toISOString(),
      locale: navigator.language || "zh-CN",
      answers: QUESTIONS.map((question, index) => {
        const value = state.answers[index];
        return {
          id: question.id,
          itemKey: question.itemKey,
          section: question.section,
          trait: question.trait,
          feature: question.feature,
          habit: question.habit,
          value,
          reverse: question.reverse,
          attention: question.attention,
          expected: question.expected,
          passed: question.attention ? value === question.expected : null
        };
      }),
      scores,
      archetype: {
        key: result.archetypeKey,
        name: result.archetype.name
      },
      quality: {
        ...result.quality,
        attentionChecks: result.attentionChecks
      },
      recommendations: result.top3.map((entry) => ({
        rank: entry.rank,
        animeId: entry.anime.id,
        title: entry.anime.title,
        matchPercent: entry.matchPercent,
        rawScore: Number(entry.rawScore.toFixed(4)),
        components: entry.components,
        qualityScore: entry.anime.quality?.communityScore ?? null
      })),
      actualFavorite: {
        title: rawTitle,
        reason,
        normalizedTitle: comparison.normalizedTitle,
        matchedAnimeId: comparison.matchedAnimeId,
        matchedAnimeTitle: comparison.matchedAnimeTitle,
        predictedRank: comparison.predictedRank,
        matchStatus: comparison.matchStatus
      },
      responseTimesMs: state.responseTimes.map((value) => (Number.isFinite(value) ? value : null)),
      consent: Boolean(consent)
    };
  }

  function loadLocalRecords() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((record) => record && typeof record === "object") : [];
    } catch (error) {
      console.warn("Could not read local samples:", error);
      return [];
    }
  }

  function saveLocalRecord(record) {
    const records = loadLocalRecords();
    records.push(record);
    const trimmed = records.slice(-MAX_LOCAL_RECORDS);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      state.localRecords = trimmed;
      return true;
    } catch (error) {
      console.warn("Could not save local sample:", error);
      return false;
    }
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function submitRecordToServer(record) {
    const response = await fetchWithTimeout(
      "/api/responses",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record)
      },
      5500
    );
    if (!response.ok) {
      let detail = "";
      try {
        const payload = await response.json();
        detail = payload && payload.error ? `：${payload.error}` : "";
      } catch (error) {
        // Ignore a non-JSON error body and use the status.
      }
      throw new Error(`Server returned ${response.status}${detail}`);
    }
    return response.json();
  }

  function buildQualitySentence(quality) {
    if (!quality) return "";
    if (quality.valid) return "本次作答通过注意力与完成质量校验，会计入有效样本统计。";
    const labels = quality.flags.map((flag) => FLAG_LABELS[flag] || flag);
    return `本次作答被标记为低可信度样本（${labels.join("、")}）；数据仍会匿名保留，但不计入有效统计。`;
  }

  function renderThanks(title, reason, comparison, saveMode) {
    dom.favoriteForm.hidden = true;
    dom.favoriteThanks.hidden = false;
    dom.thanksTitle.textContent = `《${title}》`;
    dom.thanksReason.textContent = reason;
    dom.thanksReason.hidden = !reason;

    let comparisonText = "";
    if (comparison.matchStatus === "top1") {
      comparisonText = "算法这次命中了——这正是它为你排在第 1 位的作品。看来这套混合信号比想象中更懂你。";
    } else if (comparison.matchStatus === "top3") {
      comparisonText = `它出现在推荐榜第 ${comparison.predictedRank} 位。算法猜对了方向，但还没有完全读懂你。`;
    } else if (comparison.matchStatus === "catalog" && comparison.predictedRank) {
      comparisonText = `它在全部可推荐候选中排第 ${comparison.predictedRank} 位，没有进入 Top 3。这次失手比命中更有研究价值。`;
    } else if (comparison.matchStatus === "catalog") {
      comparisonText = "它在候选番池里，但未通过当前的口碑门槛，所以没有进入推荐排序。这个反馈会被记录下来。";
    } else {
      comparisonText = "它不在当前的候选番池里。新的本命已经被记下，之后可以考虑把它加入坐标库。";
    }
    dom.thanksCompare.textContent = comparisonText;

    const statusLabels = {
      server: "已匿名写入样本池（服务端与本机各一份）。",
      local: "已保存在本机浏览器。当前未连接收集服务，你可以在数据实验室导出样本。",
      error: "已保存在本机，但同步到收集服务失败。数据没有丢，稍后可以导出。",
      unsaved: "浏览器阻止了本地保存，且收集服务暂不可用，本次填写没有落库。",
      declined: "你选择不保存本次填写，因此这份本命和理由不会被记录。"
    };
    const qualitySentence = saveMode === "declined" || saveMode === "unsaved"
      ? ""
      : buildQualitySentence(state.result?.quality);
    dom.saveStatusText.textContent = `${statusLabels[saveMode] || statusLabels.local}${qualitySentence ? ` ${qualitySentence}` : ""}`;
    dom.saveStatus.classList.toggle("is-local", saveMode !== "server");
    dom.favoriteThanks.setAttribute("tabindex", "-1");
    dom.favoriteThanks.focus({ preventScroll: true });
  }

  async function handleFavoriteSubmit(event) {
    event.preventDefault();
    if (!state.result) return;

    const title = dom.favoriteTitle.value.trim();
    const reason = dom.favoriteReason.value.trim();
    const consent = dom.consentCheckbox.checked;

    if (!title) {
      showFormError("写下一部你真正喜欢的番，才能完成这份本命档案。");
      return;
    }

    dom.formError.hidden = true;
    dom.favoriteTitle.removeAttribute("aria-invalid");
    setSubmitButtonBusy(true);

    const comparison = compareFavorite(title);
    const record = buildRecord(title, reason, consent, comparison);
    state.submitted = true;
    let saveMode = "declined";

    if (consent) {
      const localSaved = saveLocalRecord(record);
      if (state.apiOnline) {
        try {
          await submitRecordToServer(record);
          saveMode = "server";
        } catch (error) {
          console.warn("Server sync failed:", error);
          saveMode = localSaved ? "error" : "unsaved";
          showToast(
            localSaved
              ? "收集服务暂时没有响应，本次样本已保存在本机。"
              : "收集服务暂时没有响应，浏览器也阻止了本地保存。"
          );
        }
      } else {
        saveMode = localSaved ? "local" : "unsaved";
      }
    }

    setSubmitButtonBusy(false);
    renderThanks(title, reason, comparison, saveMode);
  }

  /* ------------------------------------------------------------------
     Local/server status and data lab
     ------------------------------------------------------------------ */

  function updateReasonCount() {
    if (!dom.favoriteReason) return;
    dom.reasonCount.textContent = String(dom.favoriteReason.value.length);
  }

  async function detectServer() {
    if (!/^https?:$/.test(window.location.protocol)) {
      state.apiOnline = false;
      updateOnlineDot();
      return;
    }
    try {
      const response = await fetchWithTimeout("/api/health", { cache: "no-store" }, 2200);
      if (!response.ok) throw new Error("Health check failed");
      const data = await response.json();
      state.apiOnline = Boolean(data && data.ok);
      state.storageBackend = data?.storage === "netlify-blobs" ? "netlify-blobs" : "local-file";
      state.adminAuthRequired = Boolean(data?.adminAuth);
    } catch (error) {
      state.apiOnline = false;
      state.storageBackend = "local-file";
      state.adminAuthRequired = false;
    }
    updateOnlineDot();
    syncAdminPanel();
  }

  function syncAdminPanel() {
    if (!dom.adminExport) return;
    const shouldShow = state.apiOnline && state.adminAuthRequired;
    dom.adminExport.hidden = !shouldShow;
    if (shouldShow && !dom.adminToken.value) {
      try {
        const saved = window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
        if (saved) dom.adminToken.value = saved;
      } catch {
        // sessionStorage can be unavailable in strict privacy modes.
      }
    }
  }

  function updateOnlineDot() {
    const dot = $(".quiet-button .status-dot");
    const button = $(".quiet-button");
    if (dot) dot.classList.toggle("is-offline", !state.apiOnline);
    if (button) {
      button.title = state.apiOnline
        ? state.storageBackend === "netlify-blobs"
          ? "已连接 Netlify Functions · 样本保存在 Netlify Blobs"
          : "已连接本地样本收集服务"
        : "未连接收集服务，数据只保存在当前浏览器";
    }
  }

  function localQualitySummary(records) {
    const total = records.length;
    const valid = records.filter((record) => record.quality?.valid !== false).length;
    return {
      total,
      valid,
      flagged: total - valid
    };
  }

  function localStats(records) {
    const validRecords = records.filter((record) => record.quality?.valid !== false);
    const total = validRecords.length;
    const withReason = validRecords.filter((record) => {
      return String(record.actualFavorite?.reason || "").trim();
    }).length;
    const hits = validRecords.filter((record) => {
      const status = record.actualFavorite?.matchStatus;
      return status === "top1" || status === "top3";
    }).length;
    return {
      total,
      withReason,
      top3Hits: hits,
      hitRate: total ? Math.round((hits / total) * 100) : null,
      valid: total,
      flagged: records.length - total,
      rawTotal: records.length
    };
  }

  function setDataStats(stats) {
    dom.statTotal.textContent = String(stats.valid ?? stats.total ?? 0);
    dom.statReason.textContent = String(stats.withReason || 0);
    dom.statHit.textContent = stats.hitRate === null || stats.hitRate === undefined ? "—" : `${stats.hitRate}%`;
    const valid = Number(stats.valid ?? stats.total ?? 0);
    const flagged = Number(stats.flagged ?? 0);
    const rawTotal = Number(stats.rawTotal ?? (valid + flagged));
    dom.dataQualitySummary.textContent = rawTotal
      ? `当前共收得 ${rawTotal} 份样本：${valid} 份通过注意力与完成质量校验，${flagged} 份被标记但不参与命中率统计。`
      : "有效样本需要通过注意力检查、非直线作答和最低完成时长校验；被标记的样本会保留但不参与有效统计。";
  }

  function setDataSourceLabel(isServer) {
    dom.dataSource.classList.toggle("is-local", !isServer);
    const label = dom.dataSource.querySelector("span:last-child");
    if (label) {
      if (!isServer) {
        label.textContent = "未连接收集服务 · 显示当前浏览器保存的样本";
      } else if (state.storageBackend === "netlify-blobs") {
        label.textContent = "已连接 Netlify Functions · 样本保存在 Netlify Blobs";
      } else {
        label.textContent = "已连接本地收集服务 · 样本写入 data/responses.jsonl";
      }
    }
  }

  async function refreshDataLab() {
    dom.statTotal.textContent = "…";
    dom.statReason.textContent = "…";
    dom.statHit.textContent = "…";
    syncAdminPanel();
    setDataSourceLabel(state.apiOnline);

    if (!state.apiOnline) {
      const records = loadLocalRecords();
      state.localRecords = records;
      setDataStats(localStats(records));
      setDataSourceLabel(false);
      return;
    }

    try {
      const response = await fetchWithTimeout("/api/stats", { cache: "no-store" }, 3500);
      if (!response.ok) throw new Error("Stats request failed");
      const stats = await response.json();
      setDataStats(stats);
      setDataSourceLabel(true);
    } catch (error) {
      console.warn("Could not load server stats:", error);
      const records = loadLocalRecords();
      state.localRecords = records;
      setDataStats(localStats(records));
      setDataSourceLabel(false);
    }
  }

  function openDataLab() {
    state.lastFocusedElement = document.activeElement;
    dom.dataModal.hidden = false;
    document.body.classList.add("modal-open");
    syncAdminPanel();
    refreshDataLab();
    window.requestAnimationFrame(() => {
      const closeButton = $(".modal-close", dom.dataModal);
      if (closeButton) closeButton.focus({ preventScroll: true });
    });
  }

  function closeDataLab() {
    if (dom.dataModal.hidden) return;
    dom.dataModal.hidden = true;
    document.body.classList.remove("modal-open");
    if (state.lastFocusedElement && typeof state.lastFocusedElement.focus === "function") {
      state.lastFocusedElement.focus({ preventScroll: true });
    }
  }

  function trapModalFocus(event) {
    if (event.key !== "Tab" || dom.dataModal.hidden) return;
    const focusable = $$(
      'a[href], button:not([disabled]), details summary, input, textarea, select, [tabindex]:not([tabindex="-1"])',
      dom.dataModal
    ).filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function downloadBlob(content, filename, mimeType) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csvEscape(value) {
    let text = String(value === undefined || value === null ? "" : value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function recordsToCsv(records) {
    const headers = [
      "id",
      "createdAt",
      "valid",
      "archetype",
      "bigFive",
      "favoriteTitle",
      "favoriteReason",
      "matchStatus",
      "predictedRank",
      "recommendations",
      "preferences",
      "habits",
      "durationSeconds",
      "qualityFlags",
      "answersJson",
      "testVersion",
      "algorithmVersion",
      "catalogVersion"
    ];
    const rows = records.map((record) => {
      const favorite = record.actualFavorite || {};
      const bigFive = TRAITS
        .map((trait) => `${trait.key}:${record.scores?.bigFive?.[trait.key] ?? ""}`)
        .join("/");
      return [
        record.id,
        record.createdAt,
        record.quality?.valid,
        record.archetype?.name,
        bigFive,
        favorite.title,
        favorite.reason,
        favorite.matchStatus,
        favorite.predictedRank,
        (record.recommendations || []).map((item) => `${item.rank}:${item.title}`).join(" | "),
        JSON.stringify(record.scores?.preferences || {}),
        JSON.stringify(record.scores?.habits || {}),
        record.quality?.durationSeconds,
        (record.quality?.flags || []).join("|"),
        JSON.stringify(record.answers || []),
        record.testVersion,
        record.algorithmVersion,
        record.catalogVersion
      ].map(csvEscape).join(",");
    });
    return `\uFEFF${headers.map(csvEscape).join(",")}\r\n${rows.join("\r\n")}`;
  }

  function dateStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  async function exportData(format) {
    const safeFormat = format === "csv" ? "csv" : "json";
    const filename = `anime-soul-samples-${dateStamp()}.${safeFormat}`;
    const buttons = [dom.exportJson, dom.exportCsv];
    buttons.forEach((button) => {
      if (button) button.disabled = true;
    });

    try {
      if (state.apiOnline) {
        let token = "";
        if (state.adminAuthRequired) {
          token = dom.adminToken.value.trim();
          if (!token) {
            showToast("原始样本受管理员密钥保护，请先填写 ADMIN_TOKEN。");
            dom.adminToken.focus();
            return;
          }
        }
        const response = await fetchWithTimeout(`/api/export?format=${safeFormat}`, {
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        }, 6000);
        if (!response.ok) {
          let detail = "导出失败";
          try {
            const payload = await response.json();
            if (payload && payload.error) detail = payload.error;
          } catch {
            // Keep the generic message if the server did not return JSON.
          }
          throw new Error(detail);
        }
        const blob = await response.blob();
        downloadBlob(blob, filename);
        showToast("已导出收集服务中的匿名样本。");
      } else {
        const records = loadLocalRecords();
        if (!records.length) {
          showToast("本机还没有可导出的样本。完成一次本命填写后再来吧。");
          return;
        }
        if (safeFormat === "csv") {
          downloadBlob(recordsToCsv(records), filename, "text/csv;charset=utf-8");
        } else {
          const payload = {
            exportedAt: new Date().toISOString(),
            schemaVersion: 2,
            count: records.length,
            responses: records
          };
          downloadBlob(JSON.stringify(payload, null, 2), filename, "application/json;charset=utf-8");
        }
        showToast(`已导出本机的 ${records.length} 份匿名样本。`);
      }
    } catch (error) {
      console.error(error);
      const message = error && error.name === "AbortError"
        ? "导出请求超时，请稍后重试。"
        : error.message || "导出失败，请稍后重试。";
      showToast(message);
      if (state.adminAuthRequired && /密钥|授权|ADMIN_TOKEN/.test(message)) {
        dom.adminToken.focus();
      }
    } finally {
      buttons.forEach((button) => {
        if (button) button.disabled = false;
      });
    }
  }

  function renderCatalogList() {
    if (!dom.catalogList) return;
    const eligible = ANIME_CATALOG
      .filter((anime) => anime.quality?.eligible)
      .slice()
      .sort((a, b) => (b.quality.communityScore || 0) - (a.quality.communityScore || 0));
    const fragment = document.createDocumentFragment();

    eligible.forEach((anime, index) => {
      const row = document.createElement("div");
      row.className = "catalog-row";
      const number = document.createElement("span");
      number.className = "catalog-number";
      number.textContent = padNumber(index + 1);

      const info = document.createElement("div");
      info.className = "catalog-info";
      const title = document.createElement(anime.anilistUrl ? "a" : "span");
      title.className = "catalog-title";
      title.textContent = anime.title;
      if (anime.anilistUrl) {
        title.href = anime.anilistUrl;
        title.target = "_blank";
        title.rel = "noopener noreferrer";
      }
      const meta = document.createElement("small");
      meta.textContent = `${anime.year} · ${studioLabel(anime.studio)} · ${anime.tags.slice(0, 3).join(" / ")}`;
      info.append(title, meta);

      const score = document.createElement("span");
      score.className = "catalog-score";
      score.innerHTML = `${formatScore(anime.quality.communityScore)}<small>/10</small>`;
      row.append(number, info, score);
      fragment.append(row);
    });

    dom.catalogList.replaceChildren(fragment);
    $$("[data-catalog-count]").forEach((node) => {
      node.textContent = String(eligible.length);
    });
  }

  /* ------------------------------------------------------------------
     Navigation & events
     ------------------------------------------------------------------ */

  function clearFormIfNeededBeforeLeave() {
    const hasDraft = dom.favoriteTitle.value.trim() || dom.favoriteReason.value.trim();
    if (!state.submitted && hasDraft) {
      return window.confirm("当前本命档案还没有提交，离开会丢失这些内容。确定继续吗？");
    }
    return true;
  }

  function handleRetake() {
    if (!clearFormIfNeededBeforeLeave()) return;
    startTest();
  }

  function handleGoHome() {
    if (state.screen === "test" && state.answers.some(Boolean)) {
      const confirmed = window.confirm("测试进度不会保留，确定退出吗？");
      if (!confirmed) return;
    }
    cleanupTimers();
    closeDataLab();
    showScreen("intro");
  }

  function handleTestExit() {
    if (state.answers.some(Boolean)) {
      const confirmed = window.confirm("测试进度不会保留，确定退出吗？");
      if (!confirmed) return;
    }
    cleanupTimers();
    showScreen("intro");
  }

  function scrollToMethod() {
    if (state.screen !== "intro") {
      showToast("推荐由直接口味 50% + 口碑质量 18% + Big Five 14% + 观看动机 10% + 制作信号 8% 混合排序，并要求作品通过双平台口碑门槛。");
      return;
    }
    const method = $("#method");
    if (!method) return;
    method.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }

  function scrollToFavoriteForm() {
    const panel = $("#favorite-panel");
    if (!panel) return;
    panel.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    window.setTimeout(() => {
      dom.favoriteTitle.focus({ preventScroll: true });
    }, prefersReducedMotion() ? 0 : 450);
  }

  function scrollToReasons() {
    const section = $(".reasons-section");
    if (!section) return;
    section.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }

  function bindEvents() {
    dom.startButton.addEventListener("click", startTest);
    $$("[data-go-home]").forEach((button) => {
      button.addEventListener("click", handleGoHome);
    });
    $$(".js-retake").forEach((button) => {
      button.addEventListener("click", handleRetake);
    });
    $$("[data-scroll-method]").forEach((button) => {
      button.addEventListener("click", scrollToMethod);
    });
    $$("[data-scroll-favorite]").forEach((button) => {
      button.addEventListener("click", scrollToFavoriteForm);
    });
    $$("[data-scroll-reasons]").forEach((button) => {
      button.addEventListener("click", scrollToReasons);
    });
    $$(".js-open-lab").forEach((button) => {
      button.addEventListener("click", openDataLab);
    });

    dom.prevButton.addEventListener("click", goToPreviousQuestion);
    dom.testExitButton.addEventListener("click", handleTestExit);
    dom.favoriteReason.addEventListener("input", updateReasonCount);
    dom.favoriteForm.addEventListener("submit", handleFavoriteSubmit);
    dom.favoriteTitle.addEventListener("input", () => {
      if (dom.favoriteTitle.value.trim()) {
        dom.favoriteTitle.removeAttribute("aria-invalid");
        dom.formError.hidden = true;
      }
    });

    dom.dataModal.addEventListener("click", (event) => {
      if (event.target.hasAttribute("data-close-modal")) closeDataLab();
    });
    dom.exportJson.addEventListener("click", () => exportData("json"));
    dom.exportCsv.addEventListener("click", () => exportData("csv"));
    dom.adminToken.addEventListener("input", () => {
      try {
        window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, dom.adminToken.value.trim());
      } catch {
        // Ignore storage restrictions; the field still works for this tab.
      }
    });

    document.addEventListener("keydown", (event) => {
      if (!dom.dataModal.hidden) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeDataLab();
          return;
        }
        trapModalFocus(event);
        return;
      }
      if (state.screen === "test") handleTestKeydown(event);
    });
  }

  function init() {
    if (!Array.isArray(ANIME_CATALOG) || !ANIME_CATALOG.length) {
      console.error("Catalog not loaded.");
      showToast("番剧数据没有加载成功，请刷新页面。");
      return;
    }

    const eligibleCount = ANIME_CATALOG.filter((anime) => anime.quality?.eligible).length;
    $$("[data-anime-count]").forEach((node) => {
      node.textContent = String(eligibleCount);
    });
    $$("[data-question-count]").forEach((node) => {
      node.textContent = String(QUESTIONS.length);
    });

    state.localRecords = loadLocalRecords();
    bindEvents();
    detectServer();
    updateReasonCount();
    renderCatalogList();
  }

  init();
})();
