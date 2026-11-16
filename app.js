/* global SCHEMA_VERSION, QUESTIONNAIRE_VERSION, TEST_VERSION, QUESTIONS, QUESTION_MAP, WORK_TYPES, LIKE_STRENGTHS, FAVORITE_REASONS, getQuestion, getFavoriteReasonLabel, CATALOG_META, ANIME_CATALOG, ANIME_MEDIA */

(function () {
  "use strict";

  const ALGORITHM_VERSION = "rec-v5-balanced";
  const ONLINE_ALGORITHM = "bangumi-signals-1";
  const PROFILE_VERSION = "profile-v4.0.0";
  const SESSION_KEY = "anime-soul-lab:session:v4";
  const GUEST_RESULT_KEY = "anime-soul-lab:guest-result:v1";
  const COMPLETED_KEY = "anime-soul-lab:completed:v1";
  const RECORDS_KEY = "anime-soul-lab:questionnaires:v4";
  const RATINGS_KEY = "anime-soul-lab:ratings:v4";
  const LEGACY_KEYS = ["anime-soul-lab:responses:v3", "anime-soul-lab:responses:v2"];
  const ACTIVE_TAB_KEY = "anime-soul-lab:active-tab:v4";
  const TOTAL_QUESTIONS = 40;

  const CONFIG = {
    version: ALGORITHM_VERSION,
    anchor: 0.32,
    taste: 0.50,
    context: 0.08,
    craft: 0.08,
    quality: 0.02,
    avoidancePenalty: 0.34,
    repeatPenalty: 0.12,
    diversityPenalty: 0.18,
    note: "初始权重，未经大样本验证；锚点与直接审美高于情境、质量与人格自述。"
  };

  const FEEDBACK_OPTIONS = [
    { code: "want", label: "想看" },
    { code: "like", label: "喜欢" },
    { code: "neutral", label: "一般" },
    { code: "not_interested", label: "没兴趣" },
    { code: "unsuitable", label: "不适合" },
    { code: "seen", label: "已看" }
  ];

  const FEEDBACK_REASON_TAGS = [
    { code: "setting", label: "题材" },
    { code: "pace", label: "节奏" },
    { code: "character", label: "人物关系" },
    { code: "emotion", label: "情感" },
    { code: "visual_music", label: "音乐 / 视觉" },
    { code: "theme", label: "主题" },
    { code: "other", label: "其他" }
  ];

  const REVIEW_STATUSES = [
    { code: "want", label: "想看" },
    { code: "watching", label: "在看" },
    { code: "seen", label: "看过" },
    { code: "on_hold", label: "搁置" },
    { code: "dropped", label: "不想看" }
  ];

  const state = {
    screen: "intro",
    questionIndex: 0,
    answers: {},
    favorites: [],
    consent: { profile_storage: true, similar_taste_anonymous_use: false },
    result: null,
    record: null,
    responseId: null,
    saveMode: null,
    editingResponseId: null,
    accountMode: "login",
    adminView: "dashboard",
    feedback: {},
    ratings: [],
    localRecords: [],
    legacyRecords: [],
    apiOnline: false,
    treeTab: "reviews",
    currentPost: null,
    pendingGuestRecord: null,
    guestDashboard: false,
    footprintTab: "own",
    preferences: {},
    account: null,
    accountReactions: [],
    accountsAvailable: false,
    externalSearchAvailable: false,
    treeSearch: "",
    treeSelectedWork: null,
    testStartedAt: null,
    testFinishedAt: null,
    lastAnswerAt: null,
    locked: false,
    advanceTimer: null,
    loadingTimer: null,
    sessionReady: false,
    restoringSession: false,
    savedSession: null,
    pendingReactions: new Set()
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const dom = {
    screens: {
      intro: $("#screen-intro"),
      test: $("#screen-test"),
      favorites: $("#screen-favorites"),
      loading: $("#screen-loading"),
      result: $("#screen-result"),
      tree: $("#screen-tree")
    },
    startButton: $("#start-btn"),
    resumeCard: $("#resume-card"),
    resumeTitle: $("#resume-title"),
    resumeText: $("#resume-text"),
    resumeButton: $("#resume-btn"),
    questionGroup: $("#question-group"),
    questionText: $("#question-text"),
    questionCounter: $("#question-counter"),
    questionNumber: $("#question-number"),
    questionKind: $("#question-kind"),
    scaleInstruction: $("#scale-instruction"),
    options: $("#options"),
    progressFill: $("#progress-fill"),
    progressTrack: $(".progress-track"),
    prevButton: $("#prev-btn"),
    testExitButton: $("#test-exit-btn"),
    keyboardHint: $("#keyboard-hint"),
    testProgressNote: $("#test-progress-note"),
    favoritesBackButton: $("#favorites-back-btn"),
    favoritesForm: $("#favorites-form"),
    favoriteEntries: $("#favorite-entries"),
    addFavorite: $("#add-favorite"),
    submitFavorites: $("#submit-favorites"),
    favoritesError: $("#favorites-error"),
    loadingTitle: $("#loading-title"),
    resultSaveState: $("#result-save-state"),
    profileCard: $("#profile-card"),
    profileTitle: $("#profile-title"),
    profileSummary: $("#profile-summary"),
    profileEvidence: $("#profile-evidence"),
    profileUncertainty: $("#profile-uncertainty"),
    recommendations: $("#recommendations"),
    communitySection: $("#community-section"),
    communityList: $("#community-list"),
    resultDetails: $("#result-details"),
    resultHeading: $(".result-heading"),
    treeBackButton: $("#tree-back-btn"),
    treeContent: $("#tree-content"),
    accountModal: $("#account-modal"),
    toast: $("#toast")
  };

  function padNumber(value, length = 2) {
    return String(value).padStart(length, "0");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      dom.toast.hidden = true;
    }, 3800);
  }

  function normalizeTitle(value) {
    return String(value || "")
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/[\s《》〈〉「」『』【】\[\]()（）:：!！?？·・.,，。;；\-—_'"“”‘’]+/g, "");
  }

  function showScreen(name) {
    Object.entries(dom.screens).forEach(([key, element]) => {
      if (!element) return;
      element.classList.toggle("is-active", key === name);
    });
    state.screen = name;
    document.body.classList.toggle("is-focus-mode", ["test", "favorites", "loading"].includes(name));
    scrollToTop();
    if (state.sessionReady && !state.restoringSession && name !== "loading") {
      saveSession();
      markActiveTab();
    }
  }

  function markActiveTab() {
    try {
      window.sessionStorage.setItem(ACTIVE_TAB_KEY, "1");
    } catch {
      // Ignore sessionStorage restrictions.
    }
  }

  function isAnswered(question, value) {
    if (!question) return false;
    if (question.type === "likert") return Boolean(value && Number.isInteger(Number(value.value)) && value.code);
    if (question.type === "single") return typeof value === "string" && value.length > 0;
    if (question.type === "multi") {
      if (!Array.isArray(value) || value.length === 0) return false;
      if (value.length > question.maxSelections) return false;
      if (question.noneCode && value.includes(question.noneCode) && value.length !== 1) return false;
      return value.every((code) => question.options.some((option) => option.code === code));
    }
    if (question.type === "rank") {
      return Array.isArray(value) && value.length === question.rankCount && new Set(value).size === value.length &&
        value.every((code) => question.options.some((option) => option.code === code));
    }
    if (question.type === "matrix") {
      return Boolean(value) && question.rows.every((row) => typeof value[row.key] === "string" &&
        row.options.some((option) => option.code === value[row.key]));
    }
    return false;
  }

  function countAnswered() {
    return QUESTIONS.filter((question) => isAnswered(question, state.answers[question.id])).length;
  }

  function getAnswerCode(questionId) {
    const question = getQuestion(questionId);
    const value = state.answers[questionId];
    if (!question || !value) return null;
    if (question.type === "single") return value;
    if (question.type === "likert") return value.code;
    return null;
  }

  function getLikertValue(questionId) {
    const value = state.answers[questionId];
    return value && Number.isFinite(Number(value.value)) ? Number(value.value) : null;
  }

  function externalRefForAnime(anime) {
    return {
      provider: "anilist-candidate-snapshot",
      year: anime.year,
      features: anime.tags,
      provider_id: String(anime.anilistId || anime.id),
      canonical_url: anime.anilistUrl || "",
      title_canonical: anime.title,
      title_display: anime.title,
      media_type: String(anime.format || "unknown").toLowerCase() === "tv" ? "tv"
        : String(anime.format || "").toLowerCase() === "movie" ? "movie"
          : String(anime.format || "").toLowerCase() === "ova" ? "ova"
            : String(anime.format || "").toLowerCase() === "ona" ? "ona" : "unknown",
      lookup_status: "matched",
      resolved_at: new Date().toISOString()
    };
  }

  function manualRef(title) {
    return {
      provider: "manual",
      provider_id: "",
      canonical_url: `https://bgm.tv/subject_search/${encodeURIComponent(title)}?cat=2`,
      title_canonical: title,
      title_display: title,
      media_type: "unknown",
      lookup_status: "unmatched",
      resolved_at: null
    };
  }

  function catalogAnimeForRef(ref) {
    if (!ref) return null;
    if (ref.provider === "series") {
      const group = ANIME_SERIES.byId.get(ref.provider_id);
      return ANIME_CATALOG.find((anime) => group?.members.includes(anime.id)) || null;
    }
    const titles = [ref.title_display, ref.title_canonical].map(normalizeTitle).filter(Boolean);
    return ANIME_CATALOG.find((anime) => {
      if (["anilist", "anilist-candidate-snapshot"].includes(ref.provider) && ref.provider_id) {
        return String(anime.anilistId) === String(ref.provider_id);
      }
      return [anime.title, anime.romaji, anime.english, anime.native, ...(anime.aliases || [])]
        .map(normalizeTitle).some((title) => title && titles.includes(title));
    }) || null;
  }

  function sameWork(left, right) {
    if (!left || !right) return false;
    if (["series", "bangumi-series"].includes(left.provider) || ["series", "bangumi-series"].includes(right.provider)) {
      return left.provider === right.provider && left.provider_id === right.provider_id;
    }
    const provider = (ref) => ref.provider === "anilist-candidate-snapshot" ? "anilist" : ref.provider;
    if (left.provider_id && right.provider_id && provider(left) === provider(right)) {
      return String(left.provider_id) === String(right.provider_id);
    }
    if (left.year && right.year && Number(left.year) !== Number(right.year)) return false;
    if (left.media_type && right.media_type && left.media_type !== "unknown" && right.media_type !== "unknown" &&
        left.media_type !== right.media_type) return false;
    const titles = [left.title_display, left.title_canonical].map(normalizeTitle).filter(Boolean);
    if ([right.title_display, right.title_canonical].map(normalizeTitle).some((title) => titles.includes(title))) return true;
    const anime = catalogAnimeForRef(left);
    return Boolean(anime && anime === catalogAnimeForRef(right));
  }

  const workSearches = new Map();
  const workSeries = new Map();

  function findWorks(query, mode = "remote") {
    const search = query.trim();
    const key = mode + ":" + search.normalize("NFKC").toLowerCase();
    if (workSearches.has(key)) return workSearches.get(key);
    if (!state.externalSearchAvailable) return Promise.resolve({ items: [], exact: null, fallback: true });
    const params = new URLSearchParams({ q: search, mode });
    const lookup = apiJson(`/api/anime-search?${params}`, undefined, mode === "character" ? 9000 : 5800)
      .then((data) => formatWorkResults(data)).catch(() => ({ items: [], exact: null, fallback: true }));
    workSearches.set(key, lookup);
    lookup.then(({ fallback }) => { if (fallback) workSearches.delete(key); });
    if (workSearches.size > 30) workSearches.delete(workSearches.keys().next().value);
    return lookup;
  }

  function formatWorkResults(data) {
    if (!data.series) return data;
    const series = { id: `bgm-${data.series.id}`, bangumiId: data.series.id, title: data.series.title };
    return { ...data, series, grouped: new Set(data.items.filter((item) => item.series_id === data.series.id).map((item) => item.provider_id)) };
  }

  async function expandWorkResults(data) {
    const basis = data.exact || data.items[0];
    if (data.series || !basis || basis.provider !== "bangumi") return data;
    let request = workSeries.get(basis.provider_id);
    if (!request) {
      request = apiJson(`/api/anime-search?related=${basis.provider_id}`, undefined, 3800);
      workSeries.set(basis.provider_id, request);
      if (workSeries.size > 30) workSeries.delete(workSeries.keys().next().value);
    }
    try {
      const group = await request;
      if (!group.items?.length) return data;
      const root = group.root || basis;
      const series = group.series || { id: root.provider_id, title: root.title_display };
      const children = [basis, ...group.items].map((item) => ({ ...item, series_id: series.id, series_title: series.title }));
      const items = [...new Map([...data.items, ...children].map((item) => [item.provider_id, item])).values()];
      return formatWorkResults({ ...data, items, series });
    } catch {
      workSeries.delete(basis.provider_id);
      return data;
    }
  }

  function renderWorkChoices(container, items, choose, { favorite = false, series, grouped } = {}) {
    const groups = new Map();
    const singles = [];
    const add = (target, ref) => {
      const button = searchResultButton(ref, favorite);
      button.addEventListener("click", () => choose(ref));
      target.append(button);
    };
    if (series) groups.set(series, []);
    for (const ref of items) {
      const group = ref.provider === "bangumi" && grouped?.has(ref.provider_id) ? series
        : ANIME_SERIES.identify(ref, catalogAnimeForRef(ref));
      if (!group) singles.push(ref);
      else {
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(ref);
      }
    }
    for (const [group, children] of groups) {
      const details = document.createElement("details");
      details.className = "series-result";
      details.open = Boolean(series === group || groups.size === 1 && !singles.length);
      const label = document.createElement("summary");
      label.textContent = group.title + " · 系列";
      const options = document.createElement("div");
      options.className = "series-options";
      const pickSeries = textButton("选择整个系列", () => choose({ ...ANIME_SERIES.reference(group),
        members: children.map((ref) => ref.provider_id) }));
      options.append(pickSeries);
      for (const ref of children.sort((a, b) => (a.year || 0) - (b.year || 0))) add(options, ref);
      details.append(label, options);
      container.append(details);
    }
    for (const ref of singles) add(container, ref);
  }

  function searchResultButton(ref, favorite = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = favorite ? "favorite-search-result" : "tree-search-result";
    const title = document.createElement("strong");
    title.textContent = ref.title_display;
    const meta = document.createElement("span");
    meta.textContent = [ref.year, { tv: "TV", movie: "剧场版", ova: "OVA", ona: "网络动画" }[ref.media_type],
      ref.provider === "bangumi" ? "Bangumi" : "AniList"].filter(Boolean).join(" · ");
    button.append(title, meta);
    return button;
  }

  function formatDate(iso) {
    if (!iso) return "时间未知";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
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

  function fetchWithTimeout(url, options = {}, timeout = 5500) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => window.clearTimeout(timer));
  }

  /* ------------------------------------------------------------------ */
  /* Session and local data                                            */
  /* ------------------------------------------------------------------ */

  function emptyFavorite() {
    return {
      draftId: uid(),
      title_raw: "",
      work_type: "unknown",
      external_ref: null,
      like_strength: "like",
      reasons: [],
      reason_text: "",
      confidence_title_match: "unmatched"
    };
  }

  function ensureFavoritesDraft() {
    if (!Array.isArray(state.favorites) || state.favorites.length === 0) {
      state.favorites = [emptyFavorite()];
    }
  }

  function loadLocalJson(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (error) {
      console.warn(`Could not read ${key}:`, error);
      return fallback;
    }
  }

  function saveLocalJson(key, value) {
    if (state.account) return false;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn(`Could not save ${key}:`, error);
      return false;
    }
  }

  function loadLocalData() {
    const records = loadLocalJson(RECORDS_KEY, []);
    state.localRecords = Array.isArray(records) ? records : [];
    const legacy = [];
    LEGACY_KEYS.forEach((key) => {
      const items = loadLocalJson(key, []);
      if (Array.isArray(items)) {
        items.forEach((record) => {
          if (record && typeof record === "object" && !legacy.some((item) => item.id === record.id)) {
            legacy.push(record);
          }
        });
      }
    });
    state.legacyRecords = legacy;
    const ratings = loadLocalJson(RATINGS_KEY, []);
    state.ratings = Array.isArray(ratings) ? ratings : [];
  }

  let experience;

  function buildSessionSnapshot() {
    return {
      version: 4,
      savedAt: new Date().toISOString(),
      screen: state.screen,
      questionIndex: state.questionIndex,
      answers: state.answers,
      favorites: state.favorites,
      preferences: state.preferences,
      consent: state.consent,
      result: state.result?.online ? { ...state.result, pending: false } : state.result,
      record: state.record,
      responseId: state.responseId,
      saveMode: state.saveMode,
      editingResponseId: state.editingResponseId,
      feedback: state.feedback,
      testStartedAt: state.testStartedAt,
      testFinishedAt: state.testFinishedAt,
      lastAnswerAt: state.lastAnswerAt
    };
  }

  function saveSession() {
    if (state.restoringSession || state.account) return;
    if (state.result && !state.consent.profile_storage) return;
    const hasProgress = Object.keys(state.answers).length > 0 || state.favorites.some((item) => item.title_raw || item.reason_text) || state.result;
    if (!hasProgress) return;
    const snapshot = buildSessionSnapshot();
    if (snapshot.result && snapshot.record) {
      state.guestResult = snapshot;
      return saveLocalJson(GUEST_RESULT_KEY, snapshot);
    }
    if (!["test", "favorites"].includes(snapshot.screen)) snapshot.screen = Object.keys(state.answers).length >= 39 ? "favorites" : "test";
    state.savedSession = snapshot;
    return saveLocalJson(SESSION_KEY, snapshot);
  }

  function loadSavedSession() {
    const session = loadLocalJson(SESSION_KEY, null);
    if (!session || session.version !== 4) return null;
    return session;
  }

  function clearSession() {
    try {
      window.localStorage.removeItem(SESSION_KEY);
      window.sessionStorage.removeItem(ACTIVE_TAB_KEY);
    } catch {
      // Ignore.
    }
    state.savedSession = null;
    if (dom.resumeCard) dom.resumeCard.hidden = true;
  }

  function resumeSummary(session) {
    if (!session) return null;
    if (session.result) return { title: "上次的推荐结果还在", text: "可以回到上次结果，也可以重新测试。", action: "查看上次结果" };
    if (session.screen === "favorites") return { title: "上次已经做到第 40 题", text: "你的 1–39 题答案还在，可以继续填写真正喜欢的作品。", action: "继续第 40 题" };
    const answered = Object.keys(session.answers || {}).length;
    if (answered > 0) return { title: "上次的问卷没有做完", text: `已完成 ${Math.min(answered, 39)} / 40 题，刷新或关闭页面都不会丢。`, action: "继续问卷" };
    return null;
  }

  function renderResumeCard(session) {
    const summary = resumeSummary(session);
    if (!summary) {
      dom.resumeCard.hidden = true;
      return;
    }
    dom.resumeTitle.textContent = summary.title;
    dom.resumeText.textContent = summary.text;
    dom.resumeButton.textContent = summary.action;
    dom.resumeCard.hidden = false;
  }

  function restoreSession(session, { auto = false } = {}) {
    if (!session || session.version !== 4) return false;
    state.restoringSession = true;
    state.answers = session.answers && typeof session.answers === "object" ? session.answers : {};
    state.preferences = WATCH_MODEL.choices(session.preferences);
    state.favorites = Array.isArray(session.favorites) && session.favorites.length ? session.favorites : [emptyFavorite()];
    state.consent = {
      profile_storage: session.consent?.profile_storage !== false,
      similar_taste_anonymous_use: session.consent?.similar_taste_anonymous_use === true
    };
    state.questionIndex = clamp(Number(session.questionIndex) || 0, 0, 39);
    state.testStartedAt = session.testStartedAt || null;
    state.testFinishedAt = session.testFinishedAt || null;
    state.lastAnswerAt = session.lastAnswerAt || null;
    state.result = session.result || null;
    state.record = session.record || null;
    state.responseId = session.responseId || null;
    state.saveMode = session.saveMode || null;
    if (!state.account && state.saveMode === "local" && state.record?.evaluation_version === "shared-1") state.pendingGuestRecord = state.record;
    state.editingResponseId = session.editingResponseId || null;
    state.feedback = session.feedback && typeof session.feedback === "object" ? session.feedback : {};

    try {
      window.sessionStorage.setItem(ACTIVE_TAB_KEY, "1");
    } catch {
      // Ignore.
    }

    if (session.result) {
      renderResult(session.result);
      showScreen("result");
    } else if (session.screen === "favorites" || Object.keys(state.answers).length >= 39) {
      renderFavoriteEntries();
      showScreen("favorites");
    } else if (session.screen === "test") {
      renderQuestion({ announce: false });
      showScreen("test");
    } else {
      showScreen("intro");
    }
    state.restoringSession = false;
    state.sessionReady = true;
    saveSession();
    if (auto) showToast("已恢复上次进度。");
    return true;
  }

  function handleGoHome() {
    if (state.screen === "loading") return;
    cleanupTimers();
    if (state.account || state.guestDashboard) openTree("profile");
    else if (state.result) showScreen("result");
    else {
      showScreen("intro");
      renderResumeCard(state.savedSession?.result ? null : state.savedSession);
    }
  }

  function handleRetake() {
    const hasProgress = Object.keys(state.answers).length > 0 || state.result;
    if (hasProgress && !window.confirm("开始一份新的问卷？当前草稿会被替换。")) return;
    startNewQuestionnaire();
  }

  function cleanupTimers() {
    window.clearTimeout(state.advanceTimer);
    window.clearTimeout(state.loadingTimer);
    state.advanceTimer = null;
    state.loadingTimer = null;
    state.locked = false;
  }

  /* ------------------------------------------------------------------ */
  /* Question flow                                                      */
  /* ------------------------------------------------------------------ */

  function startNewQuestionnaire() {
    if (!state.account) clearSession();
    state.preferences = {};
    state.pendingGuestRecord = null;
    state.editingResponseId = null;
    cleanupTimers();
    state.screen = "test";
    state.questionIndex = 0;
    state.answers = {};
    state.favorites = [emptyFavorite()];
    state.consent = { profile_storage: true, similar_taste_anonymous_use: false };
    state.result = null;
    state.record = null;
    state.responseId = null;
    state.saveMode = null;
    state.feedback = {};
    state.testStartedAt = Date.now();
    state.testFinishedAt = null;
    state.lastAnswerAt = state.testStartedAt;
    state.locked = false;
    state.sessionReady = true;
    showScreen("test");
    renderQuestion();
    saveSession();
    markActiveTab();
  }

  function renderQuestion({ announce = true } = {}) {
    const question = QUESTIONS[state.questionIndex];
    if (!question || question.type === "favorites") {
      showFavoriteScreen();
      return;
    }
    const value = state.answers[question.id];
    dom.questionGroup.textContent = question.groupLabel;
    dom.questionKind.textContent = `${question.groupLabel} · ${question.number} / 40`;
    dom.questionCounter.innerHTML = `${padNumber(question.number)} <em>/ 40</em>`;
    dom.questionNumber.textContent = `q${padNumber(question.number)}`;
    dom.questionText.textContent = question.text;
    dom.scaleInstruction.textContent = "";
    dom.prevButton.disabled = state.questionIndex === 0;
    dom.options.replaceChildren();
    dom.options.className = "options-grid";

    if (question.type === "likert") renderLikert(question, value);
    else if (question.type === "single") renderSingle(question, value);
    else if (question.type === "multi") renderMulti(question, value);
    else if (question.type === "rank") renderRank(question, value);
    else if (question.type === "matrix") renderMatrix(question, value);

    updateProgress();
    if (announce) {
      window.requestAnimationFrame(() => dom.questionText.focus({ preventScroll: true }));
    }
  }

  function likertLabel(question, value) {
    return question.options.find((option) => Number(option.value) === Number(value))?.label || "";
  }

  function renderLikert(question, value) {
    dom.options.classList.add("scale-grid");
    dom.scaleInstruction.textContent = "1 = 左端，5 = 右端。按平时的你作答，不必猜测“正确答案”。";
    const anchors = document.createElement("div");
    anchors.className = "likert-anchors";
    const left = document.createElement("span");
    left.textContent = `1 · ${question.leftLabel}`;
    const right = document.createElement("span");
    right.textContent = `5 · ${question.rightLabel}`;
    anchors.append(left, right);
    dom.options.append(anchors);

    question.options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "scale-option";
      button.dataset.value = String(option.value);
      button.dataset.code = option.code;
      const selected = value && Number(value.value) === Number(option.value);
      button.classList.toggle("is-selected", Boolean(selected));
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      const number = document.createElement("span");
      number.className = "scale-number";
      number.textContent = String(option.value);
      const label = document.createElement("span");
      label.className = "scale-label";
      label.textContent = option.label;
      button.append(number, label);
      button.addEventListener("click", () => {
        if (state.locked) return;
        state.answers[question.id] = { value: Number(option.value), code: option.code };
        markAnswerTime();
        saveSession();
        updateProgress();
        state.locked = true;
        $$(".scale-option", dom.options).forEach((item) => {
          item.disabled = true;
          item.classList.toggle("is-selected", item.dataset.code === option.code);
        });
        state.advanceTimer = window.setTimeout(() => {
          state.locked = false;
          advanceQuestion();
        }, 240);
      });
      dom.options.append(button);
    });
    dom.keyboardHint.innerHTML = "按 <kbd>1</kbd> – <kbd>5</kbd> 选择";
    dom.testProgressNote.textContent = "作答后自动进入下一题";
  }

  function renderSingle(question, value) {
    dom.options.classList.add("choice-grid");
    dom.scaleInstruction.textContent = "只选一个。看不出来时可以选择“不确定 / 无特别偏好”。";
    question.options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-option";
      button.classList.toggle("is-selected", value === option.code);
      button.setAttribute("aria-pressed", value === option.code ? "true" : "false");
      const key = document.createElement("span");
      key.className = "choice-key";
      key.textContent = String.fromCharCode(65 + index);
      const label = document.createElement("span");
      label.className = "choice-label";
      label.textContent = option.label;
      button.append(key, label);
      button.addEventListener("click", () => {
        if (state.locked) return;
        state.answers[question.id] = option.code;
        markAnswerTime();
        saveSession();
        updateProgress();
        state.locked = true;
        $$(".choice-option", dom.options).forEach((item) => { item.disabled = true; });
        button.classList.add("is-selected");
        state.advanceTimer = window.setTimeout(() => {
          state.locked = false;
          advanceQuestion();
        }, 240);
      });
      dom.options.append(button);
    });
    dom.keyboardHint.innerHTML = `按 <kbd>1</kbd> – <kbd>${question.options.length}</kbd> 选择`;
    dom.testProgressNote.textContent = "作答后自动进入下一题";
  }

  function renderMulti(question, value) {
    let selected = Array.isArray(value) ? [...value] : [];
    dom.options.classList.add("multi-grid");
    dom.scaleInstruction.textContent = `最多选择 ${question.maxSelections} 项。${question.noneCode ? "选择“无特别偏好”时会清除其他选项。" : ""}`;
    const count = document.createElement("p");
    count.className = "multi-progress";

    function update() {
      count.textContent = `已选 ${selected.length} / ${question.maxSelections}`;
      $$(".choice-option", dom.options).forEach((button) => {
        const isSelected = selected.includes(button.dataset.code);
        button.classList.toggle("is-selected", isSelected);
        button.setAttribute("aria-pressed", isSelected ? "true" : "false");
        button.disabled = false;
      });
      const continueButton = $(".multi-continue", dom.options);
      if (continueButton) continueButton.disabled = selected.length === 0 || selected.length > question.maxSelections;
      state.answers[question.id] = selected.length ? [...selected] : null;
      updateProgress();
      saveSession();
    }

    question.options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-option";
      button.dataset.code = option.code;
      const key = document.createElement("span");
      key.className = "choice-key";
      key.textContent = "＋";
      const label = document.createElement("span");
      label.className = "choice-label";
      label.textContent = option.label;
      button.append(key, label);
      button.addEventListener("click", () => {
        if (state.locked) return;
        if (question.noneCode && option.code === question.noneCode) {
          selected = selected.includes(question.noneCode) ? [] : [question.noneCode];
        } else if (selected.includes(option.code)) {
          selected = selected.filter((code) => code !== option.code);
        } else {
          if (question.noneCode) selected = selected.filter((code) => code !== question.noneCode);
          if (selected.length >= question.maxSelections) {
            showToast(`这题最多选择 ${question.maxSelections} 项，可以先取消一项。`);
            return;
          }
          selected.push(option.code);
        }
        update();
      });
      dom.options.append(button);
    });

    const footer = document.createElement("div");
    footer.className = "multi-footer";
    footer.append(count);
    const next = document.createElement("button");
    next.type = "button";
    next.className = "primary-button multi-continue";
    next.textContent = "继续";
    next.disabled = selected.length === 0;
    next.addEventListener("click", () => {
      if (!selected.length || state.locked) return;
      state.answers[question.id] = [...selected];
      markAnswerTime();
      state.locked = true;
      next.disabled = true;
      saveSession();
      advanceQuestion();
    });
    footer.append(next);
    dom.options.append(footer);
    update();
    dom.keyboardHint.innerHTML = "点击选项，然后按“继续”";
    dom.testProgressNote.textContent = "选好后点继续";
  }

  function renderRank(question, value) {
    let selected = Array.isArray(value) ? [...value] : [];
    dom.options.classList.add("rank-grid");
    dom.scaleInstruction.textContent = `按点击顺序依次排第 1 到第 ${question.rankCount} 位；再次点击已选项目可取消。`;
    const status = document.createElement("p");
    status.className = "rank-status";
    const list = document.createElement("div");
    list.className = "rank-list";

    function update() {
      list.replaceChildren();
      question.options.forEach((option) => {
        const index = selected.indexOf(option.code);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "rank-option";
        button.classList.toggle("is-selected", index >= 0);
        const badge = document.createElement("span");
        badge.className = "rank-badge";
        badge.textContent = index >= 0 ? String(index + 1) : "＋";
        const label = document.createElement("span");
        label.className = "rank-label";
        label.textContent = option.label;
        button.append(badge, label);
        button.addEventListener("click", () => {
          if (state.locked) return;
          if (index >= 0) {
            selected = selected.filter((code) => code !== option.code);
          } else if (selected.length < question.rankCount) {
            selected.push(option.code);
          } else {
            showToast(`只需要排 ${question.rankCount} 项；先取消一项再改选。`);
            return;
          }
          state.answers[question.id] = selected.length === question.rankCount ? [...selected] : null;
          update();
          saveSession();
          updateProgress();
        });
        list.append(button);
      });
      status.textContent = `已排 ${selected.length} / ${question.rankCount}`;
      const next = $(".rank-continue", dom.options);
      if (next) next.disabled = selected.length !== question.rankCount;
    }

    dom.options.append(status, list);
    const footer = document.createElement("div");
    footer.className = "multi-footer rank-footer";
    const hint = document.createElement("span");
    hint.className = "multi-progress";
    hint.textContent = "第 1 位权重最高";
    const next = document.createElement("button");
    next.type = "button";
    next.className = "primary-button rank-continue";
    next.textContent = "继续";
    next.disabled = selected.length !== question.rankCount;
    next.addEventListener("click", () => {
      if (selected.length !== question.rankCount || state.locked) return;
      state.answers[question.id] = [...selected];
      markAnswerTime();
      state.locked = true;
      saveSession();
      advanceQuestion();
    });
    footer.append(hint, next);
    dom.options.append(footer);
    update();
    dom.keyboardHint.innerHTML = "点击选项排出前三";
    dom.testProgressNote.textContent = "排满后点继续";
  }

  function renderMatrix(question, value) {
    const selected = value && typeof value === "object" ? { ...value } : {};
    dom.options.classList.add("matrix-grid");
    dom.scaleInstruction.textContent = "每组必须选且只能选一侧；没有正确答案。";
    question.rows.forEach((row) => {
      const rowElement = document.createElement("div");
      rowElement.className = "matrix-row";
      const title = document.createElement("p");
      title.className = "matrix-row-label";
      title.textContent = row.label;
      const options = document.createElement("div");
      options.className = "matrix-options";
      row.options.forEach((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "matrix-option";
        button.classList.toggle("is-selected", selected[row.key] === option.code);
        button.textContent = option.label;
        button.addEventListener("click", () => {
          if (state.locked) return;
          selected[row.key] = option.code;
          state.answers[question.id] = { ...selected };
          $$(".matrix-option", options).forEach((item) => item.classList.remove("is-selected"));
          button.classList.add("is-selected");
          saveSession();
          updateProgress();
          const continueButton = $(".matrix-continue", dom.options);
          if (continueButton) continueButton.disabled = !isAnswered(question, selected);
        });
        options.append(button);
      });
      rowElement.append(title, options);
      dom.options.append(rowElement);
    });
    const footer = document.createElement("div");
    footer.className = "multi-footer";
    const hint = document.createElement("span");
    hint.className = "multi-progress";
    hint.textContent = "三组都要选择";
    const next = document.createElement("button");
    next.type = "button";
    next.className = "primary-button matrix-continue";
    next.textContent = "继续";
    next.disabled = !isAnswered(question, selected);
    next.addEventListener("click", () => {
      if (!isAnswered(question, selected) || state.locked) return;
      state.answers[question.id] = { ...selected };
      markAnswerTime();
      state.locked = true;
      saveSession();
      advanceQuestion();
    });
    footer.append(hint, next);
    dom.options.append(footer);
    dom.keyboardHint.textContent = "逐组选择，然后点继续";
    dom.testProgressNote.textContent = "三组选好后点继续";
  }

  function markAnswerTime() {
    const now = Date.now();
    if (state.lastAnswerAt) state.lastAnswerAt = now;
    else state.lastAnswerAt = now;
  }

  function updateProgress() {
    const answered = countAnswered();
    const percent = (answered / TOTAL_QUESTIONS) * 100;
    dom.progressFill.style.width = `${percent}%`;
    dom.progressTrack.setAttribute("aria-valuenow", String(Math.min(TOTAL_QUESTIONS, answered + 1)));
    dom.progressTrack.setAttribute("aria-valuetext", `已完成 ${answered} / ${TOTAL_QUESTIONS} 题`);
  }

  function advanceQuestion() {
    state.locked = false;
    if (state.questionIndex >= 39) {
      showFavoriteScreen();
      return;
    }
    state.questionIndex += 1;
    renderQuestion();
    scrollToTop();
    saveSession();
  }

  function goBack() {
    if (state.locked) return;
    if (state.screen === "favorites") {
      state.questionIndex = 38;
      showScreen("test");
      renderQuestion();
      return;
    }
    if (state.screen === "test" && state.questionIndex > 0) {
      state.questionIndex -= 1;
      renderQuestion();
      saveSession();
    }
  }

  function handleTestExit() {
    saveSession();
    handleGoHome();
  }

  function handleKeydown(event) {
    if (dom.accountModal.open) return;
    if (state.screen !== "test") return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const tag = event.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const question = QUESTIONS[state.questionIndex];
    if (!question) return;
    if (/^[1-9]$/.test(event.key)) {
      const number = Number(event.key);
      if (question.type === "likert" && number >= 1 && number <= 5) {
        const option = question.options[number - 1];
        $(`.scale-option[data-code="${option.code}"]`, dom.options)?.click();
        event.preventDefault();
      } else if (question.type === "single" && number <= question.options.length) {
        $$(".choice-option", dom.options)[number - 1]?.click();
        event.preventDefault();
      }
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goBack();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Question 40: real favorites                                        */
  /* ------------------------------------------------------------------ */

  function showFavoriteScreen() {
    ensureFavoritesDraft();
    renderFavoriteEntries();
    showScreen("favorites");
    updateProgress();
    saveSession();
  }

  function refreshFavoritePublishLabel() {
    const local = !state.accountsAvailable;
    const guest = !state.account;
    const archive = Boolean(state.editingResponseId && state.record && !state.record.publication);
    $("#favorite-publish-label").textContent = local ? "本机预览" : guest ? "先查看结果" : archive ? "更新旧测评档案" : "匿名发到树洞";
    $("#favorite-publish-note").textContent = local ? "当前环境会在此浏览器生成并保存结果。"
      : guest ? "先看推荐，登录后可把结果绑定账号，并匿名发布本命番。" : archive ? "这份旧测评会维持原有可见范围。"
      : "树洞显示这一步的作品和理由。审美维度和推荐结果保存在账号档案。";
    dom.submitFavorites.textContent = guest || archive || local ? "查看推荐"
      : state.editingResponseId ? "更新发言并查看推荐" : "发布并查看推荐";
  }

  function renderFavoriteEntries() {
    refreshFavoritePublishLabel();
    $("#taste-preferences").replaceChildren(experience.preferencesPanel(state.preferences, (preferences) => {
      state.preferences = preferences;
      saveSession();
    }));
    ensureFavoritesDraft();
    dom.favoriteEntries.replaceChildren();
    state.favorites.forEach((entry, index) => {
      dom.favoriteEntries.append(createFavoriteEntry(entry, index));
    });
    dom.addFavorite.disabled = state.favorites.length >= 5;
    dom.addFavorite.textContent = state.favorites.length >= 5
      ? "已达到 5 部上限"
      : `＋ 再添加一部（${state.favorites.length} / 5）`;
  }

  function updateFavorite(entry, patch) {
    Object.assign(entry, patch);
    saveSession();
  }

  function setFavoriteMatch(entry, ref, titleInput, status, results) {
    const external_ref = ref;
    const anime = ref.provider === "series" ? null : catalogAnimeForRef(ref);
    const type = anime ? externalRefForAnime(anime).media_type : ref.media_type;
    entry.title_raw = ref.title_display.slice(0, 120);
    entry.work_type = type || entry.work_type;
    entry.external_ref = external_ref;
    entry.confidence_title_match = "matched";
    titleInput.value = entry.title_raw;

    status.replaceChildren(workLink(ref, "查看已选条目 ↗"));
    status.className = "favorite-match-status is-matched";
    results.replaceChildren();
    results.hidden = true;
    saveSession();
  }

  async function searchFavoriteResults(entry, query, titleInput, status, results) {
    results.hidden = false;
    results.textContent = "搜索中…";
    const available = await findWorks(query.trim());
    const stillLooking = () => results.isConnected && titleInput.value === query && !entry.external_ref;
    if (!stillLooking()) return;
    if (available.intent === "season" && available.exact) {
      setFavoriteMatch(entry, available.exact, titleInput, status, results);
      return;
    }
    const manual = document.createElement("button");
    manual.type = "button";
    manual.className = "text-button";
    manual.textContent = "使用原题名";
    manual.addEventListener("click", () => {
      updateFavorite(entry, { external_ref: manualRef(query.trim()), confidence_title_match: "unmatched" });
      status.textContent = "将使用原题名";
      results.hidden = true;
    });
    const paint = (data) => {
      if (!stillLooking()) return;
      results.replaceChildren();
      if (data.items.length) renderWorkChoices(results, data.items,
        (ref) => setFavoriteMatch(entry, ref, titleInput, status, results), { ...data, favorite: true });
      results.append(manual);
    };
    paint(available);
    expandWorkResults(available).then((data) => { if (data !== available) paint(data); });
  }

  function createFavoriteEntry(entry, index) {
    const card = document.createElement("article");
    card.className = "favorite-entry";
    const head = document.createElement("div");
    head.className = "favorite-entry-head";
    const number = document.createElement("span");
    number.className = "favorite-entry-number";
    number.textContent = `作品 ${index + 1}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = "移除此条";
    remove.disabled = state.favorites.length <= 1;
    remove.addEventListener("click", () => {
      state.favorites.splice(index, 1);
      renderFavoriteEntries();
      saveSession();
    });
    head.append(number, remove);

    const titleGroup = document.createElement("div");
    titleGroup.className = "field-group";
    const titleLabel = document.createElement("label");
    titleLabel.textContent = "作品名（必填）";
    titleLabel.htmlFor = `favorite-title-${entry.draftId}`;
    const titleInput = document.createElement("input");
    titleInput.id = `favorite-title-${entry.draftId}`;
    titleInput.type = "text";
    titleInput.maxLength = 120;
    titleInput.autocomplete = "off";
    titleInput.placeholder = "例如：钢之炼金术师 FA";
    titleInput.value = entry.title_raw || "";
    const status = document.createElement("p");
    status.className = "favorite-match-status";
    if (entry.external_ref && entry.confidence_title_match === "matched") {
      status.append(workLink(entry.external_ref, "查看已选条目 ↗"));
    }
    const results = document.createElement("div");
    results.className = "favorite-search-results";
    results.hidden = true;

    let searchTimer = null;
    titleInput.addEventListener("input", () => {
      const value = titleInput.value;
      updateFavorite(entry, { title_raw: value });
      if (entry.external_ref && normalizeTitle(entry.external_ref.title_display) !== normalizeTitle(value)) {
        updateFavorite(entry, {
          external_ref: null,
          confidence_title_match: "unmatched"
        });
        status.textContent = "";
        status.className = "favorite-match-status is-unmatched";
      }
      window.clearTimeout(searchTimer);
      if (value.trim()) {
        searchTimer = window.setTimeout(() => searchFavoriteResults(entry, value, titleInput, status, results), 220);
      } else {
        results.hidden = true;
      }
    });
    titleInput.addEventListener("focus", () => {
      if (titleInput.value.trim() && !entry.external_ref) {
        window.clearTimeout(searchTimer);
        searchFavoriteResults(entry, titleInput.value, titleInput, status, results);
      }
    });
    if (titleInput.value.trim() && !entry.external_ref) {
      queueMicrotask(() => {
        if (card.isConnected) searchFavoriteResults(entry, titleInput.value, titleInput, status, results);
      });
    }
    titleGroup.append(titleLabel, titleInput, status, results);

    const grid = document.createElement("div");
    grid.className = "favorite-field-grid";

    const strengthGroup = document.createElement("div");
    strengthGroup.className = "field-group";
    const strengthLabel = document.createElement("label");
    strengthLabel.textContent = "喜欢强度";
    strengthLabel.htmlFor = `favorite-strength-${entry.draftId}`;
    const strengthSelect = document.createElement("select");
    strengthSelect.id = `favorite-strength-${entry.draftId}`;
    LIKE_STRENGTHS.forEach((strength) => {
      const option = document.createElement("option");
      option.value = strength.code;
      option.textContent = strength.label;
      strengthSelect.append(option);
    });
    strengthSelect.value = entry.like_strength || "like";
    strengthSelect.addEventListener("change", () => updateFavorite(entry, { like_strength: strengthSelect.value }));
    strengthGroup.append(strengthLabel, strengthSelect);
    grid.append(strengthGroup);
    const review = experience.reviewEditor(entry.review || {
      tags: (entry.reasons || []).map(getFavoriteReasonLabel), comment: entry.reason_text || ""
    }, (value) => updateFavorite(entry, { review: value }));
    card.append(head, titleGroup, grid, review.node);
    return card;
  }

  function validateFavoriteEntries() {
    const entries = state.favorites.filter((entry) =>
      String(entry.title_raw || "").trim() ||
      String(entry.review?.comment || entry.reason_text || "").trim() ||
      Boolean(entry.review?.tags?.length || Object.values(entry.review?.dimensions || {}).some(Boolean))
    );
    if (!entries.length) return { ok: false, error: "至少填写 1 部你真正喜欢的作品。" };
    if (entries.length > 5) return { ok: false, error: "最多填写 5 部作品。" };
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const title = String(entry.title_raw || "").trim();
      if (!title) return { ok: false, error: `作品 ${index + 1} 还缺少作品名。` };
      if (title.length > 120) return { ok: false, error: `作品 ${index + 1} 的作品名过长。` };
      if (!WORK_TYPES.some((type) => type.code === entry.work_type)) {
        return { ok: false, error: `作品 ${index + 1} 的作品类型不正确。` };
      }
      if (!LIKE_STRENGTHS.some((strength) => strength.code === entry.like_strength)) {
        return { ok: false, error: `作品 ${index + 1} 的喜欢强度不正确。` };
      }
      if (!WATCH_MODEL.review(entry.review)) return { ok: false, error: `作品 ${index + 1} 的每项维度都需选择 1–10 分。` };
    }
    return { ok: true, entries };
  }

  async function normalizedFavorites(entries) {
    return Promise.all(entries.map(async (entry) => {
      const title = String(entry.title_raw || "").trim();
      let ref = entry.external_ref;
      if (!ref) {
        const { exact, items, series } = await findWorks(title);
        const selected = entry.external_ref;
        ref = selected || exact;
        if (!ref && (items.length || series)) throw new Error(`请为「${title}」选择条目，或点击「使用原题名」。`);
        ref ||= manualRef(title);
      }
      const external_ref = ref;
      const matched = external_ref.lookup_status === "matched";
      return {
        title_raw: (matched ? external_ref.title_display : title).slice(0, 120),
        work_type: ["series", "bangumi-series"].includes(external_ref.provider) ? "unknown"
          : external_ref.media_type || entry.work_type || "unknown",
        external_ref,
        like_strength: entry.like_strength,
        review: WATCH_MODEL.review(entry.review),
        reasons: [],
        reason_text: "",
        confidence_title_match: matched ? "matched" : "unmatched"
      };
    }));
  }

  function showFavoritesError(message) {
    dom.favoritesError.textContent = message;
    dom.favoritesError.hidden = false;
    dom.favoritesError.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
  }

  async function handleFavoritesSubmit(event) {
    event.preventDefault();
    const validation = validateFavoriteEntries();
    if (!validation.ok) {
      showFavoritesError(validation.error);
      return;
    }
    const missingIndex = QUESTIONS.slice(0, 39).findIndex((question) => !isAnswered(question, state.answers[question.id]));
    if (missingIndex >= 0) {
      showToast(`第 ${missingIndex + 1} 题还没有完成，先补上再提交。`);
      state.questionIndex = missingIndex;
      showScreen("test");
      renderQuestion();
      return;
    }
    dom.favoritesError.hidden = true;
    dom.submitFavorites.disabled = true;
    dom.submitFavorites.textContent = "正在生成推荐…";
    state.consent = { profile_storage: true, similar_taste_anonymous_use: true };

    try {
      const favorites = await normalizedFavorites(validation.entries);
      if (favorites.some((favorite, index) => favorites.slice(0, index).some((earlier) =>
        sameWork(earlier.external_ref, favorite.external_ref)))) {
        throw new Error("同一部作品只需填写一次，请移除重复作品。");
      }
      state.favorites = validation.entries;
      state.testFinishedAt = Date.now();
      showScreen("loading");
      dom.loadingTitle.textContent = "正在整理你的回答";
      const profile = deriveProfile(state.answers, favorites);
      const responseId = state.editingResponseId || uid();
      const result = { online: true, items: [], pending: true, profile };
      const record = buildQuestionnaireRecord(responseId, profile, favorites, result);
      const previous = state.editingResponseId && state.record;
      if (previous) {
        record.submitted_at = previous.submitted_at;
        record.recommendation_snapshots = [...(previous.recommendation_snapshots || []),
          previous.recommendation_snapshot].filter(Boolean).slice(-5);
      }
      state.result = result;
      state.record = record;
      state.responseId = responseId;
      state.saveMode = null;
      renderResult(result);
      showScreen("result");
      await completeOnlineResult(result, record);
      if (state.record !== record) return;

      if (state.account) {
        try {
          await submitRecord(record, state.editingResponseId ? "update" : "create");
          saveQuestionnaireRecord(record);
          state.saveMode = "account";
        } catch (error) {
          console.warn("Cloud save failed:", error);
          state.saveMode = "account-error";
        }
      } else {
        state.pendingGuestRecord = record;
        state.saveMode = saveQuestionnaireRecord(record) ? "local" : "unsaved";
      }

      if (state.screen === "result") renderResult(state.result);
      if (!state.account && saveSession()) clearSession();
      saveLocalJson(COMPLETED_KEY, true);
      if (!state.account && state.screen === "result") openAccount({
        mode: "register",
        message: "登录可绑定这份审美画像与推荐、匿名发布本命番、维护追番清单和生成阅番海报。可先关闭窗口查看结果。"
      });
    } catch (error) {
      console.error(error);
      showScreen("favorites");
      showFavoritesError(error.message || "生成推荐时出了点问题，请稍后重试。");
    } finally {
      dom.submitFavorites.disabled = false;
      refreshFavoritePublishLabel();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Profile derivation                                                 */
  /* ------------------------------------------------------------------ */

  function codesOf(questionId) {
    const value = state.answers[questionId];
    return Array.isArray(value) ? value : value ? [value] : [];
  }

  function codeLabel(questionId, code) {
    const question = QUESTION_MAP.get(questionId);
    return question?.options?.find((option) => option.code === code)?.label || code;
  }

  function deriveProfile(answers, favorites) {
    const profile = {
      profile_version: PROFILE_VERSION,
      dimensions: ANIME_TASTE.userDimensions(answers),
      preferences: WATCH_MODEL.choices(state.preferences),
      computed_at: new Date().toISOString(),
      context: {
        watch_experience_band: answers.q01 || null,
        viewing_commitment: answers.q02 || null,
        current_watch_need: answers.q03 || [],
        entry_threshold: answers.q04 || null
      },
      self_description: {
        introversion_extraversion: answers.q05 || null,
        novelty_seeking: answers.q06 || null,
        structure_ambiguity: answers.q07 || null,
        emotion_importance: answers.q08 || null,
        low_inference_weight: true
      },
      taste: {
        setting_interest: answers.q09 || [],
        worldbuilding_value: answers.q10 || [],
        preferred_story_scope: answers.q11 || null,
        reality_distance: answers.q12 || null,
        narrative_drivers_ranked: answers.q13 || [],
        narrative_form: answers.q14 || null,
        information_explicitness: answers.q15 || null,
        closure: answers.q16 || null,
        ambiguity_tolerance: answers.q17 || null,
        character_values_ranked: answers.q18 || [],
        relationship_interest: answers.q19 || [],
        protagonist_moral_complexity: answers.q20 || null,
        cast_scope: answers.q21 || null,
        character_arc: answers.q22 || null,
        desired_emotions_ranked: answers.q23 || [],
        emotional_intensity: answers.q24 || null,
        emotion_expression: answers.q25 || null,
        comic_relief: answers.q26 || null,
        romance_role: answers.q27 || null,
        craft_values_ranked: answers.q28 || [],
        music_importance: answers.q29 || null,
        formal_experiment_interest: answers.q30 || null,
        performance_spectacle: answers.q31 || null,
        mood_vs_progress: answers.q32 || null,
        theme_interest: answers.q33 || [],
        theme_expression: answers.q34 || null,
        pace_preference: answers.q35 || null,
        pace_avoidance: answers.q36 || [],
        length_preference: answers.q37 || null,
        avoidance: answers.q38 || [],
        tradeoffs: answers.q39 || {}
      },
      anchors: {
        actual_favorites: favorites,
        matched_favorites: favorites.filter((favorite) => favorite.external_ref?.lookup_status === "matched").length,
        unmatched_favorites: favorites.filter((favorite) => favorite.external_ref?.lookup_status !== "matched").length
      },
      confidence: {
        level: "medium",
        notes: []
      }
    };
    const matched = favorites.filter((favorite) => catalogAnimeForRef(favorite.external_ref)).length;
    if (matched >= 2) {
      profile.confidence.level = "medium-high";
      profile.confidence.notes.push(`${matched} 部真实喜欢作品可定位到候选描述。`);
    } else if (matched === 0) {
      profile.confidence.level = "low";
      profile.confidence.notes.push("真实喜欢作品没有匹配到候选描述，推荐更依赖问卷维度。");
    }
    if (profile.taste.ambiguity_tolerance === "ambiguity_mid" || profile.taste.narrative_form === "form_unsure") {
      profile.confidence.notes.push("部分维度仍有不确定性，推荐解释会相应保守。");
    }
    return profile;
  }

  function describeLikert(questionId, low, high) {
    const value = getLikertValue(questionId);
    if (value === null) return null;
    if (value <= 2) return low;
    if (value >= 4) return high;
    return "在两端之间";
  }

  function buildProfileSummary(profile) {
    const taste = profile.taste;
    const drivers = (taste.narrative_drivers_ranked || []).map((code) => codeLabel("q13", code));
    const emotions = (taste.desired_emotions_ranked || []).map((code) => codeLabel("q23", code));
    const relations = (taste.relationship_interest || []).map((code) => codeLabel("q19", code));
    const craft = (taste.craft_values_ranked || []).map((code) => codeLabel("q28", code));
    const settings = (taste.setting_interest || []).map((code) => codeLabel("q09", code));
    const parts = [];
    if (drivers.length) parts.push(`最驱动你追看的前三项是「${drivers.join("」「")}」`);
    if (settings.length && !settings.includes("无特别偏好")) parts.push(`容易被「${settings.slice(0, 3).join("、")}」这样的舞台吸引`);
    if (emotions.length) parts.push(`最想带走的感受包括「${emotions.slice(0, 2).join("、")}」`);
    if (relations.length) parts.push(`容易被打动的关系是「${relations.slice(0, 2).join("、")}」`);
    if (craft.length) parts.push(`最看重的制作面向是「${craft[0]}」`);
    if (!parts.length) return "这份回答还没有形成清晰的偏好轮廓。";
    return `${parts.join("。")}。`;
  }

  function profileEvidence(profile) {
    const evidence = [];
    const rankDrivers = profile.taste.narrative_drivers_ranked || [];
    if (rankDrivers[0]) evidence.push({ text: `q13 第一驱动：${codeLabel("q13", rankDrivers[0])}`, tone: "strong" });
    const settings = profile.taste.setting_interest || [];
    if (settings.length && settings[0] !== "set_no_pref") evidence.push({ text: `q09 舞台：${codeLabel("q09", settings[0])}`, tone: "normal" });
    const emotions = profile.taste.desired_emotions_ranked || [];
    if (emotions[0]) evidence.push({ text: `q23 第一感受：${codeLabel("q23", emotions[0])}`, tone: "normal" });
    const craft = profile.taste.craft_values_ranked || [];
    if (craft[0]) evidence.push({ text: `q28 第一制作面向：${codeLabel("q28", craft[0])}`, tone: "normal" });
    const avoid = profile.taste.avoidance || [];
    if (avoid.length && !avoid.includes("avoid_none")) evidence.push({ text: `q38 明确排斥：${avoid.map((code) => codeLabel("q38", code)).slice(0, 2).join("、")}`, tone: "warn" });
    return evidence;
  }

  function buildQuestionnaireRecord(responseId, profile, favorites, result) {
    const answers = {};
    QUESTIONS.slice(0, 39).forEach((question) => {
      if (state.answers[question.id] !== undefined) answers[question.id] = state.answers[question.id];
    });
    answers.q40 = { favorites };
    return {
      schemaVersion: 4,
      questionnaire_version: QUESTIONNAIRE_VERSION,
      response_id: responseId,
      submitted_at: new Date().toISOString(),
      locale: navigator.language || "zh-CN",
      source: "questionnaire",
      answers,
      preferences: WATCH_MODEL.choices(state.preferences),
      completion: {
        answered_required: 40,
        total_required: 40,
        draft: false,
        submitted: true
      },
      profile_version: PROFILE_VERSION,
      evaluation_version: "shared-1",
      derived_profile: profile,
      context: profile.context,
      self_description: profile.self_description,
      anchors: profile.anchors,
      actual_favorites: favorites,
      recommendation_snapshots: [],
      recommendation_snapshot: onlineSnapshot(result),
      consent: {
        profile_storage: Boolean(state.consent.profile_storage),
        similar_taste_anonymous_use: Boolean(state.consent.similar_taste_anonymous_use)
      }
    };
  }

  function onlineSnapshot(result, community) {
    return {
      algorithm_version: ONLINE_ALGORITHM,
      computed_at: new Date().toISOString(),
      top: result.items.map((work, index) => ({
        rank: index + 1, anime_id: `bgm-${work.provider_id}`, title: work.title_display,
        external_ref: { provider: work.provider, provider_id: work.provider_id, canonical_url: work.canonical_url,
          title_display: work.title_display, title_canonical: work.title_canonical, year: work.year,
          media_type: work.media_type, lookup_status: work.lookup_status, features: work.features },
        score: work.score, source: "Bangumi", evidence: work.overlap || []
      })),
      ...(community && { community_pick: community })
    };
  }

  async function completeOnlineResult(result, record) {
    if (!state.apiOnline) {
      result.error = "联网后可获取番剧推荐。";
      result.pending = false;
      return;
    }
    const favorites = (record.actual_favorites || []).map(({ external_ref }) => external_ref)
      .filter((ref) => ref?.provider === "bangumi").map((ref) => ref.provider_id);
    const found = apiJson("/api/discover", {
      assessment: { answers: record.answers, preferences: record.preferences, favorites }
    }, 13500);
    const community = selectCommunityPick(result, record);
    try {
      const data = await found;
      let old = false;
      result.items = data.items.filter((item) => {
        if (!item.older) return true;
        if (old) return false;
        old = true;
        return true;
      }).slice(0, 4);
    } catch (error) {
      result.error = error.message;
    }
    const pick = await community;
    record.recommendation_snapshot = onlineSnapshot(result, pick && !result.items.some((item) => sameWork(item, pick.external_ref)) ? pick : null);
    result.pending = false;
  }

  function saveQuestionnaireRecord(record) {
    const index = state.localRecords.findIndex((item) => item.response_id === record.response_id);
    if (index >= 0) state.localRecords[index] = record;
    else state.localRecords.push(record);
    if (state.account) return true;
    state.localRecords = state.localRecords.slice(-100);
    return saveLocalJson(RECORDS_KEY, state.localRecords);
  }

  async function submitRecord(record, action = "create") {
    const data = await apiJson("/api/responses", {
      ...record, account: true, account_username: state.account?.username,
      action, import_local: action === "import"
    }, 8500);
    record.publication = data.publication;
    return data;
  }

  /* ------------------------------------------------------------------ */
  /* Result rendering and feedback                                      */
  /* ------------------------------------------------------------------ */

  function formatScore(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(1) : "—";
  }

  function formatCount(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
    if (number >= 1000) return `${Math.round(number / 1000)}k`;
    return String(number);
  }

  function studioLabel(name) {
    return String(name || "制作信息以公开资料为准")
      .split(" ")
      .map((word) => word ? word[0].toUpperCase() + word.slice(1) : word)
      .join(" ");
  }

  function createCover(anime, index) {
    const media = ANIME_MEDIA[anime.id] || {};
    const cover = document.createElement("div");
    cover.className = "rec-cover";
    cover.style.setProperty("--cover-color", media.color || "#e8ece8");
    const fallback = document.createElement("div");
    fallback.className = "cover-fallback";
    const emoji = document.createElement("span");
    emoji.textContent = anime.emoji || "◒";
    const title = document.createElement("strong");
    title.textContent = anime.title;
    fallback.append(emoji, title);
    const image = document.createElement("img");
    image.alt = `《${anime.title}》封面`;
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.src = media.cover || "";
    let triedRemote = false;
    image.addEventListener("error", () => {
      if (!triedRemote && media.remote && image.src !== media.remote) {
        triedRemote = true;
        image.src = media.remote;
      } else {
        cover.classList.add("is-fallback");
      }
    });
    image.addEventListener("load", () => cover.classList.add("is-loaded"));
    const badge = document.createElement("span");
    badge.className = "cover-index";
    badge.textContent = `NO.${padNumber(index + 1)}`;
    cover.append(fallback, image, badge);
    return cover;
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

  function createMatchBadge(entry) {
    const wrap = document.createElement("div");
    wrap.className = "match-wrap";
    const gauge = document.createElement("div");
    gauge.className = "match-gauge";
    gauge.style.setProperty("--match", String(entry.matchPercent));
    gauge.setAttribute("role", "img");
    gauge.setAttribute("aria-label", `匹配指数 ${entry.matchPercent}`);
    const inner = document.createElement("div");
    inner.className = "match-gauge-inner";
    inner.textContent = String(entry.matchPercent);
    const percent = document.createElement("small");
    percent.textContent = "%";
    inner.append(percent);
    gauge.append(inner);
    const label = document.createElement("span");
    label.className = "match-label";
    label.textContent = "匹配指数";
    wrap.append(gauge, label);
    return wrap;
  }

  function renderResult(result) {
    $("#result-home").hidden = !state.account && !state.guestDashboard;
    const profile = result.profile || state.record?.derived_profile;
    if (!profile) {
      showToast("画像数据缺失，请重新提交问卷。");
      return;
    }
    dom.profileTitle.textContent = "本次回答的轮廓";
    dom.profileSummary.textContent = buildProfileSummary(profile);
    dom.profileEvidence.replaceChildren();
    profileEvidence(profile).forEach((item) => {
      const chip = document.createElement("span");
      chip.className = `trait-chip${item.tone === "warn" ? " is-warning" : ""}`;
      chip.textContent = item.text;
      dom.profileEvidence.append(chip);
    });
    const matched = profile.anchors?.matched_favorites || 0;
    dom.profileUncertainty.textContent = matched ? `${matched} 部本命番已定位` : "";

    dom.recommendations.replaceChildren();
    if (result.online) {
      experience.renderOnlinePicks(dom.recommendations, result.items, { rate: reviewWork });
      if (result.pending || !result.items.length) {
        const notice = document.createElement("p");
        notice.className = "empty-state";
        notice.textContent = result.pending ? "正在按你的口味搜索 Bangumi…" : result.error || "这次暂时没有匹配的作品。";
        dom.recommendations.append(notice);
        if (!result.pending) dom.recommendations.append(textButton("重新查询推荐", () => recalculateRecommendations()));
      }
    } else if (!result.top.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "候选都被你的排除项过滤了。可以去树洞调整评价，或解除一个“不适合”的标记后再试。";
      dom.recommendations.append(empty);
    } else {
      result.top.forEach((entry, index) => dom.recommendations.append(renderRecommendationCard(entry, index)));
    }

    $("#next-exploration").hidden = result.online || !state.record || (result.exploration?.candidates.length || 0) < 2;
    renderResultDetails(result, profile);
    if (profile.dimensions) dom.resultDetails.append(experience.radarPanel(Object.fromEntries(
      Object.entries(ANIME_TASTE.AXES).map(([key, label]) => [label, profile.dimensions[key] ?? 50])), 100), dimensionsList(profile.dimensions));
    renderResultSaveState();
    renderCommunityPick(state.record?.recommendation_snapshot?.community_pick);
  }

  function renderResultSaveState() {
    const messages = {
      server: "已保存问卷。登录后可导入本机档案。",
      account: state.record?.publication?.deleted_at ? "推荐已保存，原发言已删除。"
        : state.record?.publication?.moderated ? "结果已保存。树洞发言已被管理员隐藏。"
        : state.record?.publication ? "本命番已匿名发布，推荐已保存到账号。" : "推荐已保存到账号。",
      "account-error": "云端保存失败。请重试，避免离开页面后丢失结果。",
      local: "结果已保存在此浏览器，注册或登录可绑定到账号。",
      error: "已保存在本机，但同步到服务器失败；数据没有丢。",
      unsaved: "浏览器阻止了本机保存，服务端也不可用；本次数据只在当前页面有效期。",
      declined: "你没有允许保存画像；结果只保留在当前页面。"
    };
    dom.resultSaveState.textContent = messages[state.saveMode] || "结果已生成。";
    dom.resultSaveState.classList.toggle("is-warning", ["account-error", "error", "unsaved", "declined"].includes(state.saveMode));
    dom.resultSaveState.hidden = false;
    if (state.saveMode === "account-error") {
      const retry = document.createElement("button");
      retry.className = "text-button";
      retry.type = "button";
      retry.textContent = "重试保存";
      retry.addEventListener("click", async () => {
        retry.disabled = true;
        try {
          await submitRecord(state.record, state.editingResponseId ? "update" : "create");
          saveQuestionnaireRecord(state.record);
          state.saveMode = "account";
          renderResultSaveState();
        } catch (error) {
          showToast(error.message || "暂时无法保存");
          retry.disabled = false;
        }
      });
      dom.resultSaveState.append(" ", retry);
    }
  }

  function renderRecommendationCard(entry, index) {
    const anime = entry.anime;
    const card = document.createElement("article");
    card.className = "rec-card";
    const body = document.createElement("div");
    body.className = "rec-body";

    const top = document.createElement("div");
    top.className = "rec-topline";
    const left = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "rec-title";
    title.textContent = anime.title;
    const sub = document.createElement("small");
    sub.textContent = `${anime.year || "年份未知"} · ${anime.format || "类型未知"}${anime.episodes ? ` · ${anime.episodes} 集` : ""}`;
    title.append(sub);
    left.append(title);
    top.append(left, createMatchBadge(entry));

    const tags = createTags(anime, 5);
    const synopsis = document.createElement("p");
    synopsis.className = "rec-synopsis";
    synopsis.textContent = ANIME_MEDIA[anime.id]?.synopsis || "";

    const evidenceList = document.createElement("ul");
    evidenceList.className = "rec-reason-list";
    entry.evidence.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item.text;
      evidenceList.append(li);
    });

    const sourceRow = document.createElement("div");
    sourceRow.className = "rec-source-row";
    const external = document.createElement("a");
    external.className = "rec-external-link";
    external.href = anime.anilistUrl || "#";
    external.target = "_blank";
    external.rel = "noopener noreferrer";
    external.textContent = "在 AniList 查看 ↗";
    sourceRow.append(external);
    const series = ANIME_SERIES.identify(null, anime);
    if (series) sourceRow.append(workLink(ANIME_SERIES.reference(series), "查看系列条目 ↗"));

    const feedback = renderFeedbackControls(entry);
    const details = document.createElement("details");
    details.className = "rec-breakdown";
    const summary = document.createElement("summary");
    summary.textContent = "匹配详情";
    const componentBox = document.createElement("div");
    componentBox.className = "rec-components";
    [
      ["真实作品锚点", entry.anchor, CONFIG.anchor],
      ["直接审美", entry.taste, CONFIG.taste],
      ["情境与门槛", entry.context, CONFIG.context],
      ["制作信号", entry.craft, CONFIG.craft],
      ["质量平局项", entry.quality, CONFIG.quality]
    ].forEach(([label, value, weight]) => {
      const row = document.createElement("div");
      row.className = "rec-component";
      const name = document.createElement("span");
      name.textContent = `${label} · ${Math.round(weight * 100)}%`;
      const track = document.createElement("span");
      track.className = "rec-component-track";
      const fill = document.createElement("i");
      fill.style.width = `${Math.round(value * 100)}%`;
      track.append(fill);
      const score = document.createElement("b");
      score.textContent = String(Math.round(value * 100));
      row.append(name, track, score);
      componentBox.append(row);
    });
    const penalty = document.createElement("p");
    penalty.className = "rec-component-note";
    penalty.textContent = entry.avoidance > 0
      ? `已按你的明确排斥项扣除 ${Math.round(entry.avoidance * 100)} 分；候选簇为 ${entry.clusterKey}。`
      : `未触发明确排斥项；候选簇为 ${entry.clusterKey}。多样性重排只会在相近候选之间降低重复曝光。`;
    details.append(summary, componentBox, penalty);
    const actions = document.createElement("div");
    actions.className = "experience-actions";
    const ref = externalRefForAnime(anime);
    actions.append(experience.wantButton(ref), textButton("评价这部作品", () => {
      openTree("library");
      openReviewEditor(ref, dom.treeContent);
    }));
    body.append(top, tags, synopsis, evidenceList, sourceRow, actions, feedback, details);
    card.append(createCover(anime, index), body);
    return card;
  }

  function renderFeedbackControls(entry) {
    const container = document.createElement("div");
    container.className = "rec-feedback";
    const existing = state.feedback[entry.anime.id] || null;
    const label = document.createElement("span");
    label.className = "feedback-label";
    label.textContent = "看完之后：";
    const options = document.createElement("div");
    options.className = "feedback-options";
    const buttons = [];

    FEEDBACK_OPTIONS.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "feedback-button";
      button.textContent = option.label;
      button.dataset.status = option.code;
      button.classList.toggle("is-selected", existing?.status === option.code);
      button.setAttribute("aria-pressed", existing?.status === option.code ? "true" : "false");
      button.addEventListener("click", () => {
        if (state.pendingReactions.has(`${state.responseId}:${entry.anime.id}`)) return;
        const current = state.feedback[entry.anime.id] || { reason_tags: [], comment: "" };
        state.feedback[entry.anime.id] = { ...current, status: option.code, at: new Date().toISOString() };
        paintFeedbackStatus(buttons, option.code);
        saveFeedbackToRecord(entry.anime.id);
        saveSession();
        submitFeedback(entry, statusText);
      });
      options.append(button);
      buttons.push(button);
    });

    const statusText = document.createElement("span");
    statusText.className = "feedback-status";
    statusText.setAttribute("role", "status");
    statusText.textContent = existing?.status ? "已记录" : "点击即记录";

    const supplement = document.createElement("details");
    supplement.className = "feedback-supplement";
    const summary = document.createElement("summary");
    summary.textContent = "补充理由（可选）";
    const tagRow = document.createElement("div");
    tagRow.className = "feedback-tag-row";
    const tagInputs = [];
    FEEDBACK_REASON_TAGS.forEach((tag) => {
      const tagLabel = document.createElement("label");
      tagLabel.className = "feedback-tag";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = tag.code;
      input.checked = Boolean(existing?.reason_tags?.includes(tag.code));
      const text = document.createElement("span");
      text.textContent = tag.label;
      tagLabel.append(input, text);
      tagRow.append(tagLabel);
      tagInputs.push(input);
    });
    const comment = document.createElement("textarea");
    comment.rows = 2;
    comment.maxLength = 600;
    comment.placeholder = "可选：具体是哪一点让你这样判断？";
    comment.value = existing?.comment || "";
    const saveSupplement = document.createElement("button");
    saveSupplement.type = "button";
    saveSupplement.className = "outline-button";
    saveSupplement.textContent = "保存补充";
    saveSupplement.addEventListener("click", () => {
      const current = state.feedback[entry.anime.id] || {};
      state.feedback[entry.anime.id] = {
        ...current,
        reason_tags: tagInputs.filter((input) => input.checked).map((input) => input.value),
        comment: comment.value.trim(),
        at: new Date().toISOString()
      };
      saveFeedbackToRecord(entry.anime.id);
      saveSession();
      submitFeedback(entry, statusText);
      showToast("补充理由已保存。");
    });
    supplement.append(summary, tagRow, comment, saveSupplement);
    container.append(label, options, statusText, supplement);
    return container;
  }

  function paintFeedbackStatus(buttons, status) {
    buttons.forEach((button) => {
      const selected = button.dataset.status === status;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  }

  function saveFeedbackToRecord(animeId) {
    const feedback = state.feedback[animeId];
    if (!feedback || !state.record) return;
    if (!Array.isArray(state.record.feedback)) state.record.feedback = [];
    state.record.feedback = state.record.feedback.filter((item) => item.animeId !== animeId);
    state.record.feedback.push({ animeId, ...feedback });
    if (!state.account && state.consent.profile_storage) {
      const index = state.localRecords.findIndex((item) => item.response_id === state.record.response_id);
      if (index >= 0) {
        state.localRecords[index] = state.record;
        saveLocalJson(RECORDS_KEY, state.localRecords);
      }
    }
  }

  function removeFeedbackFromRecord(animeId) {
    if (!state.record) return;
    if (!Array.isArray(state.record.feedback)) state.record.feedback = [];
    state.record.feedback = state.record.feedback.filter((item) => item.animeId !== animeId);
    if (!state.account && state.consent.profile_storage) {
      const index = state.localRecords.findIndex((item) => item.response_id === state.record.response_id);
      if (index >= 0) {
        state.localRecords[index] = state.record;
        saveLocalJson(RECORDS_KEY, state.localRecords);
      }
    }
  }

  async function submitFeedback(entry, statusElement) {
    const animeId = entry.anime.id;
    const feedback = state.feedback[animeId];
    if (!feedback) return;
    const key = `${state.responseId}:${animeId}`;
    if (!state.apiOnline) {
      statusElement.textContent = state.account ? "未同步" : "已保存在本机";
      return;
    }
    if (!state.consent.profile_storage || !state.responseId) {
      statusElement.textContent = "仅保存在当前会话";
      return;
    }
    state.pendingReactions.add(key);
    statusElement.textContent = "正在记录…";
    try {
      const response = await fetchWithTimeout("/api/reactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 4,
          account: Boolean(state.account),
          account_username: state.account?.username,
          responseId: state.responseId,
          animeId,
          reaction: feedback.status,
          reason_tags: feedback.reason_tags || [],
          comment: feedback.comment || "",
          createdAt: feedback.at || new Date().toISOString(),
          source: "recommendation_feedback"
        })
      }, 5000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (state.account && key === `${state.responseId}:${animeId}`) {
        state.accountReactions = state.accountReactions.filter((item) => item.responseId !== state.responseId || item.animeId !== animeId);
        state.accountReactions.push({ responseId: state.responseId, animeId, reaction: feedback.status, ...feedback });
      }
      statusElement.textContent = "已记录";
    } catch (error) {
      console.warn("Feedback sync failed:", error);
      statusElement.textContent = state.account ? "未同步，可重新选择反馈" : "已存本机 · 未同步";
    } finally {
      state.pendingReactions.delete(key);
    }
  }

  function renderResultDetails(result, profile) {
    dom.resultDetails.replaceChildren();
    const block = document.createElement("div");
    block.className = "result-detail-grid";
    const currentNeed = (profile.context.current_watch_need || []).map((code) => codeLabel("q03", code));
    const rows = [
      ["短期观看状态", currentNeed.length ? currentNeed.join("、") : "无特别目的"],
      ["真实作品锚点", (profile.anchors.actual_favorites || []).map((item) => `《${item.title_raw}》`).join(" ") || "未填写"],
      ...(result.online ? [["推荐来源", "Bangumi 作品资料 · 优先检索 2012 年及以后首播作品"]]
        : [["匹配到的候选锚点", result.anchors?.length ? result.anchors.map((item) => `《${item.title}》`).join(" ") : "暂无"],
          ["候选数量", `${result.candidateCount} 部参与匹配，${result.filtered.length} 部被硬排除`],
          ["算法配置", CONFIG.version]])
    ];
    rows.forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "result-detail-row";
      const name = document.createElement("strong");
      name.textContent = label;
      const text = document.createElement("span");
      text.textContent = value;
      row.append(name, text);
      block.append(row);
    });
    dom.resultDetails.append(block);
  }

  function workLink(ref, text) {
    const anchor = document.createElement("a");
    const title = ref?.title_display || ref?.title_canonical || "";
    anchor.textContent = text || title;
    const params = new URLSearchParams();
    if (["bangumi", "bangumi-series"].includes(ref?.provider) && /^\d+$/.test(ref.provider_id)) {
      params.set("work", ref.provider_id);
    } else {
      params.set("workTitle", title);
      if (ref?.year) params.set("year", ref.year);
    }
    anchor.href = `?${params}`;
    anchor.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openWork(ref);
    });
    return anchor;
  }

  function externalWorkLink(ref, text = "在 Bangumi 查看 ↗") {
    const anchor = document.createElement("a");
    const title = ref?.title_display || ref?.title_canonical || "";
    anchor.textContent = text;
    try {
      const url = new URL(ref?.canonical_url);
      if (url.protocol !== "https:" || !["bgm.tv", "anilist.co", "myanimelist.net"].includes(url.hostname)) throw new Error();
      anchor.href = url.href;
    } catch {
      anchor.href = `https://bgm.tv/subject_search/${encodeURIComponent(title)}?cat=2`;
    }
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    return anchor;
  }

  function openWork(ref) {
    if (!ref) return;
    if (state.screen !== "tree" || state.treeTab !== "work") state.workReturn = { screen: state.screen, tab: state.treeTab };
    state.currentWork = ref;
    openTree("work");
  }

  function reviewWork(ref, watched = false, review, love) {
    openTree("library");
    if (state.screen !== "tree" || state.treeTab !== "library") return;
    const existing = state.ratings.find((rating) => sameWork(ref, rating.external_ref));
    openReviewEditor(ref, dom.treeContent, existing, watched ? { ...existing, status: "seen", review: review || existing?.review, love } : null);
  }

  function openBoard(ref) {
    const id = ref.series_id || ref.provider_id;
    if (!/^\d{1,12}$/.test(id || "")) return;
    state.currentBoard = { id, title: ref.series_title || ref.title_display || "" };
    openTree("board");
  }

  async function apiJson(path, payload, timeout = 8000) {
    const response = await fetchWithTimeout(path, payload === undefined ? { cache: "no-store" } : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    }, timeout);
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.error || "服务暂时不可用");
    return data;
  }

  async function selectCommunityPick(result, record) {
    if (!state.apiOnline) return null;
    const profile = result.profile;
    const taste = profile.taste;
    const consentSimilar = true;
    const favoriteRefs = (record.actual_favorites || []).map((entry) => entry.external_ref || manualRef(entry.title_raw));
    const alreadyKnown = [...(result.items || result.top.map(({ anime }) => externalRefForAnime(anime))), ...favoriteRefs,
      ...state.ratings.filter((rating) => rating.status !== "want" || rating.sentiment === "dislike").map((rating) => rating.external_ref)];
    try {
      const data = await apiJson("/api/community", {
        response_id: record.response_id,
        consent_similar: consentSimilar,
        dimensions: profile.dimensions,
        ...(consentSimilar && { personality: Object.fromEntries(["q05", "q06", "q07", "q08"].map((id) => [id, record.answers[id]])),
        signals: {
          settings: taste.setting_interest,
          relationships: taste.relationship_interest,
          themes: taste.theme_interest,
          drivers: taste.narrative_drivers_ranked.slice(0, 1)
        } })
      }, 5000);
      return [...(data.similar || []), ...(data.community || [])].find((item) => {
        const ref = item.external_ref;
        if (!ref || alreadyKnown.some((known) => sameWork(ref, known))) return false;
        return Number(ref.year) >= 2012;
      }) || null;
    } catch (error) {
      console.warn("Community recommendation unavailable:", error);
      return null;
    }
  }

  function renderCommunityPick(pick) {
    dom.communityList.replaceChildren();
    dom.communitySection.hidden = !pick?.external_ref;
    if (dom.communitySection.hidden) return;
    const card = document.createElement("article");
    card.className = "tree-card community-pick";
    const info = document.createElement("div");
    const title = document.createElement("h3");
    title.append(workLink(pick.external_ref));
    const meta = document.createElement("p");
    meta.className = "tree-copy";
    meta.textContent = pick.source === "similar"
      ? `${pick.signal_count} 位口味相近的用户选为本命番`
      : `来自树洞好评 · ${pick.signal_count} 条评价`;
    info.append(title, meta);
    const rate = document.createElement("button");
    rate.type = "button";
    rate.className = "outline-button";
    rate.textContent = "写评价";
    rate.addEventListener("click", () => reviewWork(pick.external_ref));
    card.append(info, experience.wantButton(pick.external_ref), rate);
    dom.communityList.append(card);
  }

  /* ------------------------------------------------------------------ */
  /* Tree Hollow                                                        */
  /* ------------------------------------------------------------------ */

  function openTree(tab = "reviews") {
    if (state.screen === "loading") return;
    if (!state.account && !state.guestDashboard && !["data", "thread", "shared", "work", "board"].includes(tab)) {
      if (state.result || tab === "library") openAccount({ message: "登录后可以使用追番清单和树洞互动。" });
      return;
    }
    if (tab === "admin" && state.account?.role !== "admin") return;
    if (!state.account && ["wanted", "watched", "discover", "history", "settings"].includes(tab)) {
      openAccount({ message: "登录后可使用找番、追番清单和个人设置。" });
      return;
    }
    if (state.screen !== "tree") state.treeReturnScreen = state.screen;
    state.treeParent = state.treeTab;
    state.treeTab = tab;
    showScreen("tree");
    renderTree();
  }

  function closeTree() {
    const tab = state.treeTab;
    const previous = state.treeParent;
    if (tab === "work" && state.workReturn) {
      if (state.workReturn.screen === "tree" && state.workReturn.tab !== "work") openTree(state.workReturn.tab);
      else if (state.workReturn.screen === "result" && state.result) showScreen("result");
      else handleGoHome();
      return;
    }
    if (tab === "library" && ["work", "wanted", "watched", "board"].includes(previous)) { openTree(previous); return; }
    if (state.account || state.guestDashboard) {
      if (tab === "thread" && previous === "history") openTree("history");
      else if (tab === "library" && previous === "history") openTree("history");
      else if (tab === "thread" && state.currentBoard) openTree("board");
      else if (["library", "thread", "board"].includes(tab)) openTree("reviews");
      else openTree("profile");
      return;
    }
    if (tab === "data" && ["test", "favorites", "result"].includes(state.treeReturnScreen)) {
      showScreen(state.treeReturnScreen);
    } else handleGoHome();
  }

  function renderTree() {
    const community = ["reviews", "library", "thread", "board"].includes(state.treeTab);
    const personal = ["profile", "history", "settings", "admin"].includes(state.treeTab);
    const watchlist = ["wanted", "watched"].includes(state.treeTab);
    const active = community ? "reviews" : watchlist ? "wanted" : personal ? "profile" : state.treeTab;
    const dashboard = community || personal || watchlist || ["discover", "search", "work"].includes(state.treeTab);
    const hub = $(".hub-pieces");
    hub.hidden = !dashboard || (!state.account && !state.guestDashboard);
    dom.treeBackButton.hidden = !["library", "thread", "shared", "data", "work", "board"].includes(state.treeTab);
    for (const piece of $$("[data-area]", hub)) {
      const locked = !state.account && ["wanted", "discover"].includes(piece.dataset.area);
      piece.classList.toggle("requires-account", locked);
      piece.classList.toggle("is-active", piece.dataset.area === active);
      piece.setAttribute("aria-pressed", String(piece.dataset.area === active));
    }
    $("#watchlist-tabs").hidden = !watchlist;
    $("#personal-tabs").hidden = !personal;
    $$("[data-tree-tab]").forEach((button) => {
      const active = button.dataset.treeTab === state.treeTab;
      const locked = !state.account && ["history", "settings"].includes(button.dataset.treeTab);
      button.classList.toggle("requires-account", locked);
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    dom.treeContent.replaceChildren();
    if (state.treeTab === "thread") experience.renderThread(dom.treeContent, state.currentPost);
    else if (state.treeTab === "work") experience.renderWorkDetail(dom.treeContent, state.currentWork);
    else if (state.treeTab === "search") experience.renderSearch(dom.treeContent);
    else if (state.treeTab === "board") renderBoard(dom.treeContent);
    else if (state.treeTab === "discover") experience.renderDiscovery(dom.treeContent);
    else if (watchlist) experience.renderWatchlist(dom.treeContent, state.treeTab);
    else if (state.treeTab === "shared") experience.renderShared(dom.treeContent, state.shareToken);
    else if (state.treeTab === "reviews") renderPublicReviews(dom.treeContent);
    else if (state.treeTab === "profile") renderTreeProfile(dom.treeContent);
    else if (state.treeTab === "library") renderTreeLibrary(dom.treeContent);
    else if (state.treeTab === "history") renderTreeHistory(dom.treeContent);
    else if (state.treeTab === "settings") renderPersonalSettings(dom.treeContent);
    else if (state.treeTab === "admin" && state.account?.role === "admin") renderAdminHome(dom.treeContent);
    else renderTreeData(dom.treeContent);
  }

  function storedFeedback(record) {
    if (!state.account) return Object.fromEntries((record.feedback || []).map((item) => [item.animeId, item]));
    return Object.fromEntries(state.accountReactions.filter((item) => item.responseId === record.response_id)
      .map((item) => [item.animeId, {
        status: item.reaction, reason_tags: item.reason_tags, comment: item.comment, at: item.createdAt
      }]));
  }

  function currentProfileRecord() {
    if (state.result?.profile) return { profile: state.result.profile, record: state.record, live: true };
    if (state.record?.derived_profile) return { profile: state.record.derived_profile, record: state.record, live: true };
    const latest = [...state.localRecords].sort((a, b) => String(b.submitted_at || "").localeCompare(String(a.submitted_at || "")))[0];
    if (latest?.derived_profile) return { profile: latest.derived_profile, record: latest, live: false };
    return null;
  }

  function editFavoritesFromRecord(record) {
    if (!record) return;
    state.answers = {};
    QUESTIONS.slice(0, 39).forEach((question) => {
      if (record.answers?.[question.id] !== undefined) state.answers[question.id] = record.answers[question.id];
    });
    state.favorites = (record.actual_favorites || []).map((favorite) => ({
      draftId: uid(),
      title_raw: favorite.title_raw,
      work_type: favorite.work_type || "unknown",
      external_ref: favorite.external_ref || null,
      like_strength: favorite.like_strength || "like",
      reasons: [...(favorite.reasons || [])],
      reason_text: favorite.reason_text || "",
      review: favorite.review || null,
      confidence_title_match: favorite.confidence_title_match || "unmatched"
    }));
    if (!state.favorites.length) state.favorites = [emptyFavorite()];
    state.record = record;
    state.responseId = record.response_id;
    state.preferences = WATCH_MODEL.choices(record.preferences);
    state.editingResponseId = record.response_id;
    state.consent = {
      profile_storage: record.consent?.profile_storage !== false,
      similar_taste_anonymous_use: record.consent?.similar_taste_anonymous_use === true
    };
    state.result = null;
    state.feedback = {};
    state.sessionReady = true;
    showFavoriteScreen();
  }

  function renderTreeProfile(container) {
    const current = currentProfileRecord();
    const heading = document.createElement("div");
    heading.className = "tree-section-head";
    const owner = document.createElement("section");
    owner.className = "tree-card";
    owner.classList.add("personal-hero");
    if (state.account?.avatar) {
      const avatar = document.createElement("img");
      avatar.className = "profile-avatar";
      avatar.src = state.account.avatar;
      avatar.alt = "";
      owner.append(avatar);
    }
    if (state.account) {
      owner.append(titleElement(state.account.nickname || `@${state.account.username}`, `ID · ${state.account.code || "—"}`));
      if (state.account.bio) {
        const bio = document.createElement("p");
        bio.className = "tree-copy";
        bio.textContent = state.account.bio;
        owner.append(bio);
      }
    }
    else owner.append(titleElement("访客", "登录可把本机测评绑定到账号。"), textButton("登录 / 注册", () => openAccount()));
    container.append(owner);
    const title = document.createElement("h2");
    title.textContent = "我的档案";
    const actions = document.createElement("div");
    actions.className = "tree-actions";
    if (current || state.guestResult?.result) actions.append(textButton("重新测试", handleRetake));
    if (state.result || (!state.account && state.guestResult?.result) || current?.record?.recommendation_snapshot?.top?.length) {
      actions.append(textButton("查看测试结果", () => {
        if (!state.account && state.guestResult?.result && state.result !== state.guestResult.result) restoreSession(state.guestResult);
        else if (state.result) { renderResult(state.result); showScreen("result"); }
        else $("#saved-test-results")?.focus();
      }));
    }
    if (!state.account && state.savedSession && !state.savedSession.result && resumeSummary(state.savedSession)) {
      actions.append(textButton("继续未完成的问卷", () => restoreSession(state.savedSession)));
    }
    heading.append(title, actions);
    container.append(heading);

    if (!current) {
      const empty = document.createElement("div");
      empty.className = "tree-empty";
      const text = document.createElement("p");
      text.textContent = state.accountLoading ? "正在读取账号档案…" : "完成测评后，你的画像和推荐会出现在这里。";
      const start = document.createElement("button");
      start.type = "button";
      start.className = "primary-button";
      start.textContent = "开始 40 题问卷";
      start.addEventListener("click", handleRetake);
      empty.append(text);
      if (!state.accountLoading) empty.append(start);
      container.append(empty);
      return;
    }

    const profile = current.profile;
    const intro = document.createElement("section");
    intro.className = "tree-card";
    const title2 = document.createElement("h3");
    title2.textContent = "审美画像";
    const summary = document.createElement("p");
    summary.className = "tree-copy";
    summary.textContent = buildProfileSummary(profile);
    const evidence = document.createElement("div");
    evidence.className = "trait-chips";
    profileEvidence(profile).forEach((item) => {
      const chip = document.createElement("span");
      chip.className = `trait-chip${item.tone === "warn" ? " is-warning" : ""}`;
      chip.textContent = item.text;
      evidence.append(chip);
    });
    const dimensions = current.record?.analysis?.dimensions || ANIME_TASTE.userDimensions(current.record?.answers || {});
    intro.append(title2, summary, evidence, experience.radarPanel(Object.fromEntries(
      Object.entries(ANIME_TASTE.AXES).map(([key, label]) => [label, dimensions[key] ?? 50])), 100), dimensionsList(dimensions));
    container.append(intro);

    const context = document.createElement("section");
    context.className = "tree-card";
    const contextTitle = document.createElement("h3");
    contextTitle.textContent = "这次想要的观看状态";
    const contextText = document.createElement("p");
    const needs = (profile.context.current_watch_need || []).map((code) => codeLabel("q03", code));
    contextText.textContent = needs.length ? `本轮：${needs.join("、")}。这是短期状态，下一次问卷会重新询问。` : "这轮没有特别目的。";
    context.append(contextTitle, contextText);
    if (needs.length) {
      const clearContext = document.createElement("button");
      clearContext.type = "button";
      clearContext.className = "text-button";
      clearContext.textContent = "清除本次短期状态";
      clearContext.addEventListener("click", async () => {
        profile.context.current_watch_need = [];
        if (current.record) {
          current.record.context = current.record.context || {};
          current.record.context.current_watch_need = [];
          const index = state.localRecords.findIndex((item) => item.response_id === current.record.response_id);
          if (index >= 0) {
            state.localRecords[index] = current.record;
            await persistProfileEdit(current.record);
          }
        }
        renderTree();
      });
      context.append(clearContext);
    }
    container.append(context);

    const anchors = document.createElement("section");
    anchors.className = "tree-card";
    anchors.append(titleElement("本命番"));
    const visibility = current.record?.publication?.deleted_at ? "树洞发言已删除"
      : current.record?.publication?.moderated ? "树洞发言已隐藏"
      : current.record?.publication ? "已匿名发布到树洞" : "";
    if (visibility) {
      const indicator = document.createElement("p");
      indicator.className = "tree-copy";
      indicator.textContent = visibility;
      anchors.append(indicator);
    }
    const favoriteList = document.createElement("div");
    favoriteList.className = "tree-anchor-list";
    (profile.anchors.actual_favorites || []).forEach((favorite) => {
      const item = document.createElement("div");
      item.className = "tree-anchor";
      const name = workLink(favorite.external_ref || manualRef(favorite.title_raw), favorite.title_raw);
      const meta = document.createElement("span");
      meta.textContent = `${favorite.like_strength === "love" ? "长期最喜欢" : favorite.like_strength === "recent_like" ? "近期特别喜欢" : "很喜欢"} · ${favorite.external_ref?.lookup_status === "matched" ? "已定位条目" : "原题名"}`;
      const reasons = document.createElement("small");
      reasons.textContent = favorite.reasons.map((code) => getFavoriteReasonLabel(code)).join(" / ");
      item.append(name, meta, reasons);
      favoriteList.append(item);
    });
    anchors.append(favoriteList);
    if (current.record?.answers) {
      anchors.append(textButton("编辑本命番", () => editFavoritesFromRecord(current.record)));
    }
    container.append(anchors);

    const avoid = document.createElement("section");
    avoid.className = "tree-card";
    avoid.append(titleElement("观看偏好"));
    const avoidList = document.createElement("div");
    avoidList.className = "trait-chips";
    const avoidCodes = profile.taste.avoidance || [];
    if (!avoidCodes.length || avoidCodes.includes("avoid_none")) {
      const none = document.createElement("span");
      none.className = "trait-chip";
      none.textContent = "没有明确排斥";
      avoidList.append(none);
    } else {
      avoidCodes.forEach((code) => {
        const chip = document.createElement("span");
        chip.className = "trait-chip is-warning";
        chip.textContent = codeLabel("q38", code);
        avoidList.append(chip);
      });
    }
    avoid.append(avoidList);
    container.append(avoid);

    if (Object.keys(state.feedback).length) {
      const feedbackCard = document.createElement("section");
      feedbackCard.className = "tree-card";
      feedbackCard.append(titleElement("推荐反馈", "这些反馈已经进入本机记录，并会作为下一次推荐的近端证据。"));
      const feedbackList = document.createElement("div");
      feedbackList.className = "tree-rating-list";
      Object.entries(state.feedback).forEach(([animeId, feedback]) => {
        const title = state.result?.top.find((entry) => entry.anime.id === animeId)?.anime.title
          || ANIME_CATALOG.find((anime) => anime.id === animeId)?.title || animeId;
        const row = document.createElement("div");
        row.className = "tree-rating-item";
        const info = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = title;
        const meta = document.createElement("span");
        meta.textContent = `${FEEDBACK_OPTIONS.find((item) => item.code === feedback.status)?.label || feedback.status}${feedback.comment ? ` · ${feedback.comment}` : ""}`;
        info.append(name, meta);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "text-button";
        remove.textContent = "删除";
        remove.addEventListener("click", async () => {
          if (state.account) {
            try {
              await apiJson("/api/reactions", { action: "delete", account: true, account_username: state.account.username,
                responseId: state.responseId, animeId });
            } catch (error) {
              showToast(error.message);
              return;
            }
          }
          state.accountReactions = state.accountReactions.filter((item) => item.responseId !== state.responseId || item.animeId !== animeId);
          delete state.feedback[animeId];
          removeFeedbackFromRecord(animeId);
          saveSession();
          renderTree();
        });
        row.append(info, remove);
        feedbackList.append(row);
      });
      feedbackCard.append(feedbackList);
      container.append(feedbackCard);
    }

    const savedLinks = savedRecommendationLinks(current.record);
    if (savedLinks) {
      const saved = document.createElement("section");
      saved.className = "tree-card";
      saved.id = "saved-test-results";
      saved.tabIndex = -1;
      saved.append(titleElement("上次推荐"), savedLinks);
      const recalc = document.createElement("button");
      recalc.type = "button";
      recalc.className = "outline-button";
      recalc.textContent = "根据评价更新推荐";
      recalc.addEventListener("click", () => {
        recalc.disabled = true;
        state.record = current.record;
        state.responseId = state.record.response_id;
        state.editingResponseId = state.record.response_id;
        state.answers = { ...state.record.answers };
        state.consent = { ...state.record.consent };
        state.result = null;
        state.feedback = storedFeedback(state.record);
        recalculateRecommendations();
      });
      saved.append(recalc);
      container.append(saved);
    }

    const earlier = state.localRecords.filter((record) => record.response_id !== current.record?.response_id).slice(-20).reverse();
    if (earlier.length) {
      const archives = document.createElement("section");
      archives.className = "tree-card";
      archives.append(titleElement("往期测评"));
      for (const record of earlier) {
        const item = document.createElement("details");
        const label = document.createElement("summary");
        label.textContent = `${formatDate(record.submitted_at)} · ${record.actual_favorites?.map(({ title_raw }) => title_raw).join("、") || "测评"}`;
        item.append(label);
        if (record.analysis?.dimensions) item.append(dimensionsList(record.analysis.dimensions));
        const links = savedRecommendationLinks(record);
        if (links) item.append(links);
        archives.append(item);
      }
      container.append(archives);
    }

  }

  function dimensionsList(dimensions) {
    const list = document.createElement("dl");
    list.className = "dimensions-list";
    for (const [key, label] of Object.entries(ANIME_TASTE.AXES)) {
      const name = document.createElement("dt");
      name.textContent = label;
      const score = document.createElement("dd");
      score.textContent = dimensions[key] === undefined ? "—" : `${dimensions[key]} / 100`;
      list.append(name, score);
    }
    return list;
  }

  function renderAdminHome(container) {
    const head = document.createElement("header");
    head.className = "admin-home-head";
    head.append(titleElement("管理员主页"));
    const overview = document.createElement("p");
    overview.className = "tree-copy";
    overview.id = "admin-overview";
    head.append(overview);
    const actions = document.createElement("div");
    actions.className = "tree-actions";
    for (const [format, label] of [["summary", "汇总 JSON"], ["json", "完整 JSON"], ["csv", "问卷 CSV"]]) {
      const button = textButton(label, async () => {
        button.disabled = true;
        try { await exportAdminData(format); }
        finally { button.disabled = false; }
      });
      actions.append(button);
    }
    head.append(actions);
    const tabs = document.createElement("div");
    tabs.className = "account-modes";
    for (const [view, label] of [["dashboard", "图表总览"], ["results", "测评结果"], ["posts", "管理发言"],
      ["users", "用户与处罚"], ["feedback", "站点反馈"], ["tags", "标签审核"]]) {
      const button = textButton(label, () => {
        state.adminView = view;
        renderTree();
      });
      button.setAttribute("aria-pressed", String(view === state.adminView));
      tabs.append(button);
    }
    container.append(head, tabs);
    if (state.adminView === "dashboard") renderAdminMetrics(container);
    else if (state.adminView === "feedback") renderAdminFeedback(container);
    else if (state.adminView === "tags") renderTagReview(container);
    else renderPagedPosts(container, { admin: true, view: state.adminView });
  }

  function bars(title, rows, max, vertical = false) {
    const section = document.createElement("section");
    section.className = "tree-card dashboard-chart";
    section.append(titleElement(title));
    const graph = document.createElement("div");
    graph.className = vertical ? "chart-columns" : "chart-bars";
    for (const { label, value } of rows) {
      const row = document.createElement("div");
      row.className = "chart-point";
      const name = document.createElement("span");
      name.textContent = label;
      const meter = document.createElement("meter");
      meter.min = 0;
      meter.max = Math.max(1, max);
      meter.value = value;
      meter.setAttribute("aria-label", label);
      const total = document.createElement("strong");
      total.textContent = value;
      row.append(name, meter, total);
      graph.append(row);
    }
    if (!rows.length) section.append("暂无数据");
    else section.append(graph);
    return section;
  }

  async function renderAdminMetrics(container) {
    const area = document.createElement("div");
    area.textContent = "正在汇总数据…";
    container.append(area);
    try {
      const data = await apiJson("/api/admin-metrics", undefined, 12000);
      if (!area.isConnected) return;
      const totals = document.createElement("dl");
      totals.className = "dashboard-totals";
      for (const [key, label] of Object.entries({ accounts: "注册账号", assessments: "测评结果", publicReviews: "公开评价",
        watchlist: "追番记录", generalPosts: "散贴", feedback: "收到反馈", pendingFeedback: "待处理反馈" })) {
        const cell = document.createElement("div");
        const name = document.createElement("dt");
        const value = document.createElement("dd");
        name.textContent = label;
        value.textContent = data.totals[key];
        cell.append(name, value);
        totals.append(cell);
      }
      area.replaceChildren(totals, textButton("导出图表数据 JSON", () =>
        downloadBlob(JSON.stringify(data, null, 2), "anime-soul-dashboard.json", "application/json")));
      for (const [key, label, max] of [["assessments", "近 14 天的测评"], ["ratings", "近 14 天的评价"], ["feedback", "近 14 天的反馈"],
        ["preferences", "测评维度均值", 100], ["dimensions", "树洞评价维度均值", 10], ["feedbackKinds", "反馈分类"]]) {
        const rows = data[key];
        area.append(bars(label, rows, max || Math.max(1, ...rows.map(({ value }) => value)), rows.length === 14));
      }
    } catch (error) { area.textContent = error.message; }
  }

  function renderAdminFeedback(container) {
    const filters = document.createElement("div");
    filters.className = "tree-actions";
    const states = labeledSelect("处理状态", [{ code: "", label: "全部" }, { code: "open", label: "待处理" },
      { code: "handled", label: "已处理" }], "open");
    const kinds = { bug: "功能问题", data: "番剧资料", idea: "功能建议", other: "其他" };
    const categories = labeledSelect("反馈类型", [{ code: "", label: "全部" }, ...Object.entries(kinds).map(([code, label]) => ({ code, label }))], "");
    filters.append(states.wrap, categories.wrap);
    const list = document.createElement("div");
    const more = textButton("加载更多", () => load(page + 1));
    more.hidden = true;
    container.append(filters, list, more);
    let page = 0;
    let sequence = 0;
    async function load(next) {
      const version = ++sequence;
      if (!next) list.textContent = "正在读取反馈…";
      const params = new URLSearchParams({ state: states.select.value, kind: categories.select.value, page: next });
      try {
        const data = await apiJson(`/api/site-feedback?${params}`);
        if (!list.isConnected || version !== sequence) return;
        if (!next) list.replaceChildren();
        if (!next && !data.items.length) list.textContent = "暂无符合条件的反馈。";
        for (const item of data.items) {
          const card = document.createElement("article");
          card.className = "tree-card";
          card.append(titleElement(kinds[item.kind], `${formatDate(item.created)} · ${item.author ? "@" + item.author : "访客"}`));
          const message = document.createElement("p");
          message.className = "feedback-message";
          message.textContent = item.message;
          const action = textButton(item.state === "open" ? "标记已处理" : "移回待处理", async () => {
            action.disabled = true;
            try {
              await apiJson("/api/site-feedback", { action: "review", id: item.id, state: item.state === "open" ? "handled" : "open" });
              await load(0);
            } catch (error) { showToast(error.message); action.disabled = false; }
          });
          card.append(message, action);
          list.append(card);
        }
        page = next;
        more.hidden = !data.more;
      } catch (error) { list.textContent = error.message; }
    }
    states.select.addEventListener("change", () => load(0));
    categories.select.addEventListener("change", () => load(0));
    load(0);
  }

  async function renderTagReview(container) {
    const queue = document.createElement("div");
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.className = "tree-copy";
    status.textContent = "正在读取待审核标签…";
    container.append(queue, status);
    try {
      const { pending } = await apiJson("/api/tags?view=review");
      if (!queue.isConnected) return;
      status.textContent = pending.length ? `${pending.length} 条待审核` : "暂无待审核标签。";
      for (const { label, submitted } of pending) {
        const card = document.createElement("article");
        card.className = "tree-card";
        const actions = document.createElement("div");
        actions.className = "tree-actions";
        for (const [decision, caption] of [["approved", "通过"], ["rejected", "拒绝"]]) {
          actions.append(textButton(caption, async () => {
            const buttons = $$("button", actions);
            buttons.forEach((button) => { button.disabled = true; });
            try {
              await apiJson("/api/tags", { action: "decide", label, status: decision, account: true,
                account_username: state.account.username });
              showToast(decision === "approved" ? "标签已加入可选列表。" : "标签提议已拒绝。");
              if (queue.isConnected) renderTree();
            } catch (error) {
              showToast(error.message);
              buttons.forEach((button) => { button.disabled = false; });
            }
          }));
        }
        card.append(titleElement(label, formatDate(submitted)), actions);
        queue.append(card);
      }
    } catch (error) { status.textContent = error.message; }
  }

  function adminMemberControls(member, reload, overline = true) {
    const card = document.createElement("div");
    card.className = "admin-member";
    if (overline) {
      const content = document.createElement("p");
      content.className = "tree-copy";
      content.textContent = `${member.nickname ? `${member.nickname} · ` : ""}@${member.username}${member.code ? ` · #${member.code}` : ""}`;
      card.append(content);
    }
    if (member.mutedUntil) card.append(titleElement(`禁言至 ${formatDate(member.mutedUntil)}`, member.moderationReason));
    const form = document.createElement("form");
    form.className = "tree-form";
    const term = labeledSelect("处罚期限", [1, 7, 30].map((days) => ({ code: String(days), label: `禁言 ${days} 天` })), "7");
    const label = document.createElement("label");
    label.textContent = "处罚原因";
    const reason = document.createElement("input");
    reason.required = true;
    reason.maxLength = 160;
    label.append(reason);
    const apply = document.createElement("button");
    apply.textContent = "执行禁言";
    apply.className = "outline-button";
    form.append(term.wrap, label, apply);
    const submit = async (days) => {
      if (!window.confirm(days ? `禁言 @${member.username} ${days} 天？` : `解除 @${member.username} 的禁言？`)) return;
      apply.disabled = true;
      try {
        await apiJson("/api/admin", { action: "sanction", id: member.id, username: member.username,
          days, reason: reason.value });
        await reload();
      } catch (error) { showToast(error.message); }
      finally { apply.disabled = false; }
    };
    form.addEventListener("submit", (event) => { event.preventDefault(); submit(Number(term.select.value)); });
    card.append(form);
    if (member.mutedUntil) card.append(textButton("解除禁言", () => submit(0), "text-button"));
    return card;
  }

  function adminResultCard(row) {
    const card = document.createElement("details");
    card.className = "tree-card admin-result";
    const heading = document.createElement("summary");
    heading.textContent = `${formatDate(row.date)} · ${row.titles.join("、") || "测评档案"}`;
    const detail = document.createElement("div");
    card.append(heading, detail);
    let loaded = false;
    card.addEventListener("toggle", async () => {
      if (!card.open || loaded) return;
      loaded = true;
      detail.textContent = "读取结果…";
      try {
        const data = await apiJson(`/api/admin?${new URLSearchParams({ id: row.id, owner: row.owner })}`);
        detail.replaceChildren();
        const record = data.record;
        if (record.derived_profile?.taste) {
          const profile = document.createElement("p");
          profile.textContent = buildProfileSummary(record.derived_profile);
          detail.append(profile);
        }
        if (record.analysis?.dimensions) detail.append(dimensionsList(record.analysis.dimensions));
        const links = savedRecommendationLinks(record);
        if (links) detail.append(titleElement("推荐作品"), links);
        const raw = document.createElement("details");
        const rawTitle = document.createElement("summary");
        rawTitle.textContent = "查看问卷与推荐快照";
        const pre = document.createElement("pre");
        pre.className = "history-json";
        pre.textContent = JSON.stringify(record, null, 2);
        raw.append(rawTitle, pre);
        detail.append(raw);
      } catch (error) {
        detail.textContent = error.message;
        loaded = false;
      }
    });
    return card;
  }

  function titleElement(title, description = "") {
    const fragment = document.createDocumentFragment();
    const heading = document.createElement("h3");
    heading.textContent = title;
    fragment.append(heading);
    if (description) {
      const copy = document.createElement("p");
      copy.className = "tree-copy";
      copy.textContent = description;
      fragment.append(copy);
    }
    return fragment;
  }

  async function recalculateRecommendations() {
    const record = state.record;
    const profile = state.result?.profile || record?.derived_profile;
    if (!record || !profile) return;
    const result = { online: true, items: [], pending: true, profile };
    state.result = result;
    renderResult(result);
    showScreen("result");
    const previous = record.recommendation_snapshot;
    await completeOnlineResult(result, record);
    if (record !== state.record || result !== state.result) return;
    if (previous?.top?.length) {
      record.recommendation_snapshots = [...(record.recommendation_snapshots || []), previous].slice(-5);
    }
    if (!result.error || !previous?.top?.length) await persistProfileEdit(record);
    else record.recommendation_snapshot = previous;
    saveSession();
    if (state.screen === "result") renderResult(result);
  }

  function renderTreeLibrary(container) {
    container.replaceChildren();
    const head = document.createElement("div");
    head.className = "tree-section-head";
    const title = document.createElement("div");
    title.innerHTML = "<h2>写评价</h2>";
    head.append(title);
    if (!state.treeSelectedWork) head.append(textButton("写散贴", () => renderGeneralEditor(container)));
    container.append(head);

    const search = document.createElement("form");
    search.className = "tree-search";
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "搜索作品名";
    input.setAttribute("aria-label", "作品名");
    input.maxLength = 120;
    input.value = state.treeSearch;
    const button = document.createElement("button");
    button.type = "submit";
    button.className = "primary-button";
    button.textContent = "搜索";
    search.append(input, button);
    search.addEventListener("submit", (event) => {
      event.preventDefault();
      state.treeSearch = input.value.trim();
      renderTreeLibrary(container);
    });
    container.append(search);

    if (state.treeSearch) {
      const keyword = state.treeSearch;
      const box = document.createElement("section");
      box.className = "tree-card tree-search-results";
      const heading = document.createElement("h3");
      heading.textContent = "作品条目";
      const list = document.createElement("div");
      list.className = "tree-search-results";
      list.textContent = "搜索中…";
      box.append(heading, list);
      container.append(box);
      const paint = (data) => {
        if (!list.isConnected) return;
        list.replaceChildren();
        if (!data.items.length) list.textContent = data.fallback ? "作品索引暂时繁忙，请稍后重试。" : "未找到条目。";
        renderWorkChoices(list, data.items, (ref) => openReviewEditor(ref, container), data);
      };
      findWorks(keyword).then((data) => {
        paint(data);
        return expandWorkResults(data).then((group) => { if (group !== data) paint(group); });
      });
    }

    if (state.treeSelectedWork) {
      container.append(renderReviewEditor(container));
    }

  }

  function openReviewEditor(workRef, container, existing = null, draft = null) {
    const previous = existing || state.ratings.find((rating) => sameWork(workRef, rating.external_ref));
    state.treeSelectedWork = { ref: previous?.external_ref || workRef, existingId: previous?.id || null, draftId: uid(), draft };
    renderTreeLibrary(container);
    $(".review-editor select", container)?.focus({ preventScroll: true });
    $(".review-editor", container)?.scrollIntoView({ block: "nearest" });
  }

  function renderReviewEditor(container) {
    const selected = state.treeSelectedWork;
    const workRef = selected.ref;
    const existing = state.ratings.find((rating) => rating.id === selected.existingId) || null;
    const values = selected.draft || existing;
    const card = document.createElement("section");
    card.className = "tree-card review-editor";
    const heading = document.createElement("h3");
    heading.textContent = existing ? "编辑评价" : "新增评价";
    const subtitle = document.createElement("p");
    subtitle.className = "tree-copy";
    subtitle.append(workLink(workRef));
    card.append(heading, subtitle);

    const form = document.createElement("form");
    form.className = "tree-form";
    const statusField = labeledSelect("状态", REVIEW_STATUSES, values?.status || "seen");
    const sentimentField = labeledSelect("喜爱程度", [
      { code: "favorite", label: "最喜欢" }, { code: "like", label: "喜欢" },
      { code: "neutral", label: "一般" }, { code: "dislike", label: "不喜欢" }
    ], values?.love || values?.sentiment || "neutral");
    const editor = experience.reviewEditor(values?.review || {
      tags: values?.reason_tags || [], comment: values?.comment || ""
    }, undefined, { work: workRef });
    form.append(statusField.wrap, sentimentField.wrap, editor.node);

    const note = document.createElement("p");
    note.className = "tree-copy";
    note.textContent = existing?.publication?.moderated ? "这条发言已被管理员隐藏。"
      : "评价会匿名公开到该作品的系列讨论区。";
    form.append(note);

    const actions = document.createElement("div");
    actions.className = "tree-actions";
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "primary-button";
    save.textContent = !state.account ? "登录后发布" : existing ? "保存修改" : "匿名发布";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "text-button";
    cancel.textContent = "取消";
    cancel.addEventListener("click", () => {
      state.treeSelectedWork = null;
      if (selected.returnToHistory) openTree("history");
      else renderTreeLibrary(container);
    });
    actions.append(save, cancel);
    form.append(actions);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const review = WATCH_MODEL.review(editor.read());
      if (!review) { showToast("请为每一项维度选择 1–10 分。"); return; }
      const rating = {
        review,
        evaluation_version: "shared-1",
        love: sentimentField.select.value,
        id: existing?.id || selected.draftId,
        external_ref: workRef,
        status: statusField.select.value,
        rating: Math.max(1, Math.round(WATCH_MODEL.average(review.dimensions) / 2)),
        sentiment: sentimentField.select.value === "favorite" ? "like" : sentimentField.select.value,
        reason_tags: [],
        comment: review.comment,
        created_at: existing?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      if (!state.account) {
        selected.draft = rating;
        openAccount({ message: "登录后可以发布评价。已填写的内容会保留。" });
        return;
      }
      save.disabled = true;
      try {
        const saved = await saveCloudRating(rating, Boolean(existing));
        state.ratings = state.ratings.filter((item) => item.id !== rating.id && item.id !== saved.id);
        state.ratings.push(saved);
        if (rating.status === "seen") {
          try { await experience.saveWatch(workRef, "save", { status: "watched", love: rating.love, review }); }
          catch (error) { console.warn("Watchlist sync:", error); }
        }
      } catch (error) {
        showToast(error.message || "无法保存评价");
        save.disabled = false;
        return;
      }
      state.treeSelectedWork = null;
      showToast(existing ? "评价已更新。" : "评价已匿名发布。");
      if (selected.returnToHistory) openTree("history");
      else if (state.screen === "tree" && state.treeTab === "library") {
        if (state.treeParent === "watchlist" || ["wanted", "watched", "work", "board"].includes(state.treeParent)) closeTree();
        else renderTreeLibrary(container);
      }
    });

    card.append(form);
    return card;
  }

  function postCard(post, { detail = false, admin = false } = {}) {
    const item = document.createElement("article");
    item.className = "tree-card public-review";
    const meta = document.createElement("p");
    meta.className = "post-meta";
    meta.textContent = `${{ favorite: "测评本命番", review: "番剧评价", general: "散贴" }[post.type]} · ${formatDate(post.published_at)}`;
    item.append(meta);
    if (post.type === "general") {
      const body = document.createElement("p");
      body.className = "feedback-message";
      body.textContent = detail ? post.body : post.body.slice(0, 240);
      item.append(titleElement(post.title), body);
    }
    const highlight = post.highlight || post.works.map((work) => work.review?.comment || work.comment).find(Boolean);
    if (!detail && !admin && highlight) {
      const background = document.createElement("span");
      background.className = "post-highlight";
      background.setAttribute("aria-hidden", "true");
      background.textContent = highlight.slice(0, 66);
      item.append(background);
    }
    for (const work of post.works) {
      const block = document.createElement("div");
      block.className = "post-work";
      const title = document.createElement("h3");
      title.append(workLink(work.external_ref));
      block.append(title);
      if (work.watched) {
        const watched = document.createElement("span");
        watched.className = "watched-badge";
        watched.textContent = "作者已追";
        block.append(watched);
      }
      const label = work.strength ? LIKE_STRENGTHS.find(({ code }) => code === work.strength)?.label
        : { like: "喜欢", dislike: "不喜欢", neutral: "一般" }[work.sentiment];
      const description = document.createElement("p");
      description.className = "tree-copy";
      description.textContent = [
        !work.review && work.rating && `${work.rating}/5`, label,
        ...(work.reasons || []).map((code) => getFavoriteReasonLabel(code))
      ].filter(Boolean).join(" · ");
      if (description.textContent) block.append(description);
      if (detail && work.external_ref.features?.length) {
        const features = document.createElement("p");
        features.className = "tree-copy";
        features.textContent = `作品特征 · ${work.external_ref.features.slice(0, 8).join("、")}`;
        block.append(features);
      }
      const review = work.review;
      if (review) {
        const chips = document.createElement("div");
        chips.className = "experience-chips";
        for (const tag of review.tags) {
          const badge = document.createElement("a");
          badge.href = `https://bgm.tv/anime/tag/${encodeURIComponent(tag)}`;
          badge.target = "_blank";
          badge.rel = "noopener noreferrer";
          badge.textContent = tag;
          chips.append(badge);
        }
        if (chips.childElementCount) {
          chips.setAttribute("aria-label", "戳到我的点");
          block.append(chips);
        }
        if (detail) block.append(experience.radarPanel(Object.fromEntries(Object.entries(review.dimensions)
          .map(([key, value]) => [WATCH_MODEL.criteria[key], value])), 10));
        else {
          const score = document.createElement("p");
          score.className = "tree-copy";
          score.textContent = `维度均分 ${WATCH_MODEL.average(review.dimensions)} / 10`;
          block.append(score);
        }
      }
      if (review?.comment || work.comment) {
        const comment = document.createElement("p");
        comment.textContent = review?.comment || work.comment;
        block.append(comment);
      }
      if (!admin) block.append(experience.wantButton(work.external_ref));
      item.append(block);
    }
    if (post.id && !detail && !admin) item.append(textButton(`查看帖子 · ${post.replies || 0} 回复 · ${post.likes || 0} 赞`, () => {
      state.currentPost = post.id;
      openTree("thread");
    }));
    return item;
  }

  function textButton(label, onClick, style = "outline-button") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = style;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function renderPagedPosts(container, { admin = false, view = "posts", board, boardTitle } = {}) {
    const form = document.createElement("form");
    form.className = "tree-search feed-controls";
    const input = document.createElement("input");
    input.type = "search";
    input.maxLength = 120;
    input.placeholder = view === "users" ? "搜索昵称、用户名或 ID" : "按番名或帖子标题搜索";
    input.setAttribute("aria-label", input.placeholder);
    const search = document.createElement("button");
    search.type = "submit";
    search.className = "outline-button";
    search.textContent = "搜索";
    const filter = labeledSelect("类型", [
      { code: "", label: "全部发言" }, { code: "general", label: "散贴" },
      { code: "favorite", label: "测评本命番" }, { code: "review", label: "番剧评价" }
    ], "");
    filter.select.setAttribute("aria-label", "发言类型");
    form.append(input, search);
    if (view === "posts" && !board) form.prepend(filter.select);
    if (!admin) form.append(textButton("写评价", () => {
      state.treeSelectedWork = null;
      openTree("library");
      if (board && state.currentBoard?.title) {
        state.treeSearch = state.currentBoard.title;
        renderTreeLibrary(dom.treeContent);
      }
    }, "primary-button"));

    const list = document.createElement("div");
    list.className = "post-list";
    const status = document.createElement("p");
    status.className = "tree-copy";
    status.setAttribute("role", "status");
    const more = textButton("加载更多", () => load(true));
    more.hidden = true;
    container.append(form, list, status, more);
    let query = "";
    let next = null;
    let request = 0;
    async function load(append) {
      const generation = ++request;
      status.textContent = "正在加载…";
      more.disabled = true;
      try {
        const params = new URLSearchParams({ q: query, type: filter.select.value, view });
        if (board) params.set("board", board);
        if (append && next) params.set(view === "users" ? "after" : "before", next);
        const data = await apiJson(`/api/${admin ? "admin" : "reviews"}?${params}`);
        if (!list.isConnected || generation !== request) return;
        if (boardTitle && data.board?.title) {
          boardTitle.textContent = data.board.title;
          state.currentBoard.title = data.board.title;
        }
        if (!append) list.replaceChildren();
        if (view === "results") {
          for (const row of data.results) list.append(adminResultCard(row));
          $("#admin-overview").textContent = `共 ${data.summary.total} 份测评`;
        } else if (view === "users") {
          for (const member of data.users) {
            const card = document.createElement("article");
            card.className = "tree-card";
            card.append(adminMemberControls(member, () => load(false)));
            list.append(card);
          }
        } else {
          for (const post of data.posts) {
            const item = postCard(post, { admin });
            if (admin) {
              const button = textButton(post.moderated ? "恢复显示" : "隐藏发言", async () => {
                button.disabled = true;
                try {
                  await apiJson("/api/admin", { ...post.target, moderated: !post.moderated });
                  await load(false);
                } catch (error) {
                  showToast(error.message);
                  button.disabled = false;
                }
              });
              const remove = textButton("删除发言", async () => {
                if (!window.confirm("删除这条公开发言？")) return;
                remove.disabled = true;
                try {
                  await apiJson("/api/admin", { ...post.target, action: "delete" });
                  await load(false);
                } catch (error) { showToast(error.message); remove.disabled = false; }
              }, "text-button danger-text");
              item.append(button, remove);
              if (post.member) {
                const member = document.createElement("details");
                const title = document.createElement("summary");
                title.textContent = `作者 ${post.member.nickname || "@" + post.member.username}`;
                member.append(title, adminMemberControls(post.member, () => load(false)));
                item.append(member);
              }
              item.classList.toggle("is-moderated", post.moderated);
            }
            list.append(item);
          }
        }
        next = data.next;
        more.hidden = !next;
        status.textContent = list.children.length ? "" : view === "results" ? "暂无匹配的测评。" : view === "users" ? "暂无匹配的用户。" : "暂无匹配的发言。";
      } catch (error) {
        if (generation === request) status.textContent = error.message || "暂时无法加载。";
      } finally {
        if (generation === request) more.disabled = false;
      }
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      query = input.value.trim();
      load(false);
    });
    filter.select.addEventListener("change", () => load(false));
    load(false);
  }

  function renderPublicReviews(container) {
    const find = document.createElement("form");
    find.className = "tree-search board-search";
    const input = document.createElement("input");
    input.type = "search";
    input.maxLength = 120;
    input.setAttribute("aria-label", "搜索番剧讨论区");
    input.placeholder = "按番名或别称找系列讨论区";
    const button = document.createElement("button");
    button.className = "outline-button";
    button.textContent = "找讨论区";
    const list = document.createElement("div");
    list.className = "tree-search-results";
    find.append(input, button);
    find.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!input.value.trim()) return;
      list.textContent = "正在搜索讨论区…";
      button.disabled = true;
      const data = await findWorks(input.value.trim());
      if (!list.isConnected) return;
      list.replaceChildren();
      if (!data.items.length) list.textContent = data.fallback ? "作品索引暂时繁忙。" : "没有找到对应的系列。";
      else renderWorkChoices(list, data.items, openBoard, data);
      button.disabled = false;
    });
    container.append(find, list);
    renderPagedPosts(container);
  }

  function renderBoard(container) {
    const board = state.currentBoard;
    const heading = document.createElement("h2");
    heading.textContent = board.title || "系列讨论";
    container.append(heading);
    renderPagedPosts(container, { board: board.id, boardTitle: heading });
  }

  function renderGeneralEditor(container, existing = state.generalDraft) {
    container.replaceChildren(titleElement(existing?.recordId ? "编辑散贴" : "写散贴"));
    const form = document.createElement("form");
    form.className = "tree-card tree-form";
    const input = document.createElement("input");
    input.placeholder = "标题";
    input.setAttribute("aria-label", "散贴标题");
    input.maxLength = 80;
    input.required = true;
    input.value = existing?.title || "";
    const body = document.createElement("textarea");
    body.placeholder = "正文";
    body.setAttribute("aria-label", "散贴正文");
    body.maxLength = 1600;
    body.rows = 5;
    body.required = true;
    body.value = existing?.body || "";
    const action = document.createElement("button");
    action.className = "primary-button";
    action.textContent = existing?.recordId ? "保存修改" : "匿名发布";
    form.append(input, body, action, textButton("取消", () => {
      state.generalDraft = null;
      if (existing?.recordId) openTree("history");
      else renderTreeLibrary(container);
    }, "text-button"));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.account) {
        state.generalDraft = { title: input.value, body: body.value };
        openAccount({ message: "登录后可以匿名发帖。" });
        return;
      }
      action.disabled = true;
      try {
        await apiJson("/api/forum", { account: true, account_username: state.account.username,
          action: existing?.recordId ? "edit" : "create", id: existing?.recordId, title: input.value, body: body.value });
        state.generalDraft = null;
        openTree(existing?.recordId ? "history" : "reviews");
      } catch (error) { showToast(error.message); action.disabled = false; }
    });
    container.append(form);
  }

  function labeledSelect(labelText, options, value) {
    const wrap = document.createElement("div");
    wrap.className = "field-group";
    const label = document.createElement("label");
    label.textContent = labelText;
    const select = document.createElement("select");
    options.forEach((option) => {
      const item = document.createElement("option");
      item.value = option.code;
      item.textContent = option.label;
      select.append(item);
    });
    select.value = value;
    label.append(select);
    wrap.append(label);
    return { wrap, select };
  }

  function renderTreeHistory(container) {
    const view = state.footprintTab;
    const actions = document.createElement("nav");
    actions.className = "account-modes";
    actions.setAttribute("aria-label", "足迹与分享");
    for (const [key, label] of [["own", "我的发帖"], ["liked", "赞过的帖子"], ["saved", "收藏的帖子"], ["poster", "阅番海报"]]) {
      const button = textButton(label, () => { state.footprintTab = key; renderTree(); });
      button.setAttribute("aria-pressed", String(key === view));
      actions.append(button);
    }
    container.append(actions);
    if (view === "poster") { experience.renderShare(container); return; }

    const list = document.createElement("div");
    list.className = "post-list";
    const status = document.createElement("p");
    status.className = "tree-copy";
    status.setAttribute("role", "status");
    const toolbar = document.createElement("div");
    toolbar.className = "tree-actions footprint-tools";
    toolbar.hidden = true;
    const checks = new Map();
    const selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    const selectLabel = document.createElement("label");
    selectLabel.append(selectAll, "全选");
    const batch = textButton("撤回所选", () => withdraw([...checks.keys()].filter((post) => checks.get(post).checked)), "outline-button danger-text");
    toolbar.append(selectLabel, batch);
    const more = textButton("加载更多", () => load(next));
    more.hidden = true;
    container.append(toolbar, status, list, more);
    let next = null;
    let busy = false;

    function updateSelection() {
      const boxes = [...checks.values()];
      const count = boxes.filter((box) => box.checked).length;
      selectAll.checked = boxes.length > 0 && count === boxes.length;
      selectAll.indeterminate = count > 0 && count !== boxes.length;
      batch.textContent = count ? `撤回所选（${count}）` : "撤回所选";
      batch.disabled = busy || !count;
    }
    selectAll.addEventListener("change", () => {
      checks.forEach((box) => { box.checked = selectAll.checked; });
      updateSelection();
    });

    function ownCard(post) {
      const card = postCard(post);
      if (post.moderated) card.append(titleElement("已被管理员隐藏"));
      const buttons = document.createElement("div");
      buttons.className = "tree-actions footprint-tools";
      const label = document.createElement("label");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.setAttribute("aria-label", `选择发言：${post.title || post.works.map(({ external_ref }) => external_ref.title_display).join("、")}`);
      check.addEventListener("change", updateSelection);
      checks.set(post, check);
      label.append(check, "选择");
      buttons.append(label);
      const record = post.type === "favorite"
        ? state.localRecords.find(({ response_id }) => response_id === post.recordId)
        : state.ratings.find(({ id }) => id === post.recordId);
      if (record) buttons.append(textButton("编辑", () => {
        if (post.type === "favorite") editFavoritesFromRecord(record);
        else {
          openTree("library");
          openReviewEditor(record.external_ref, dom.treeContent, record);
          state.treeSelectedWork.returnToHistory = true;
        }
      }, "text-button"));
      if (post.type === "general") buttons.append(textButton("编辑", () => {
        openTree("library");
        renderGeneralEditor(dom.treeContent, post);
      }, "text-button"));
      buttons.append(textButton("撤回发言", () => withdraw([post]), "text-button danger-text"));
      card.append(buttons);
      return card;
    }

    async function load(cursor) {
      more.disabled = true;
      status.textContent = "正在加载…";
      try {
        const params = new URLSearchParams({ view });
        if (cursor) params.set("before", cursor);
        const data = await apiJson(`/api/footprints?${params}`);
        if (!list.isConnected) return;
        if (!cursor) { list.replaceChildren(); checks.clear(); }
        for (const post of data.posts) list.append(view === "own" ? ownCard(post) : postCard(post));
        next = data.next;
        more.hidden = !next;
        toolbar.hidden = !checks.size;
        updateSelection();
        status.textContent = list.childElementCount ? "" : { own: "还没有发帖。", liked: "还没有赞过帖子。", saved: "还没有收藏帖子。" }[view];
      } catch (error) { status.textContent = error.message; }
      finally { more.disabled = false; }
    }

    async function withdraw(posts) {
      if (busy || !posts.length || !window.confirm(`从树洞撤回这 ${posts.length} 条发言？测评档案和追番记录会保留。`)) return;
      busy = true;
      updateSelection();
      const username = state.account.username;
      let removed = 0;
      let errorMessage = "";
      try {
        for (let start = 0; start < posts.length; start += 50) {
          const selected = posts.slice(start, start + 50).map(({ type, recordId }) => ({ type, id: recordId }));
          const { results } = await apiJson("/api/footprints", { account: true, account_username: username, posts: selected });
          if (state.account?.username !== username) return;
          for (const result of results.filter(({ removed }) => removed)) {
            removed += 1;
            if (result.type === "review") state.ratings = state.ratings.filter(({ id }) => id !== result.id);
            else if (result.publication) {
              for (const record of [...state.localRecords, state.record]) {
                if (record?.response_id === result.id) record.publication = result.publication;
              }
            }
          }
        }
      } catch (error) { errorMessage = error.message; }
      finally { busy = false; }
      if (list.isConnected) await load(null);
      showToast(removed === posts.length ? `已撤回 ${removed} 条发言。`
        : `已撤回 ${removed} 条，${posts.length - removed} 条待重试。${errorMessage}`);
    }

    load(null);
  }

  function applyPersonalAppearance() {
    document.documentElement.dataset.accent = state.account?.accent || "jade";
    document.documentElement.classList.toggle("compact-feed", state.account?.compact === true);
  }

  function renderPersonalSettings(container) {
    const account = state.account;
    const card = document.createElement("section");
    card.className = "tree-card";
    card.append(titleElement("个人设置", `账号 @${account.username} · ID ${account.code || "—"}`));
    if (account.mutedUntil) card.append(titleElement(`禁言至 ${formatDate(account.mutedUntil)}`, account.moderationReason));

    const form = document.createElement("form");
    form.className = "tree-form";
    const field = (label, element, value, limit) => {
      const wrap = document.createElement("label");
      wrap.textContent = label;
      const control = document.createElement(element);
      control.value = value;
      control.maxLength = limit;
      wrap.append(control);
      form.append(wrap);
      return control;
    };
    const nickname = field("昵称", "input", account.nickname || "", 24);
    nickname.placeholder = `默认 @${account.username}`;
    const bio = field("个人简介", "textarea", account.bio || "", 160);
    bio.rows = 3;
    let avatar = account.avatar || "";
    let avatarRevision = 0;
    let avatarTask = Promise.resolve();
    const avatarFile = field("头像（PNG、JPEG 或 WebP，会自动裁剪压缩）", "input", "", 0);
    avatarFile.type = "file";
    avatarFile.accept = "image/png,image/jpeg,image/webp";
    avatarFile.addEventListener("change", () => {
      const file = avatarFile.files?.[0];
      if (!file) return;
      if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 8000000) {
        showToast("请选择小于 8 MB 的 PNG、JPEG 或 WebP。");
        avatarFile.value = "";
        return;
      }
      const requested = ++avatarRevision;
      avatarTask = new Promise((resolve) => {
        const reader = new FileReader();
        reader.onerror = () => { showToast("无法读取头像。"); resolve(); };
        reader.onload = () => {
          const image = new Image();
          image.onerror = () => { showToast("无法解码头像。"); resolve(); };
          image.onload = () => {
            if (requested === avatarRevision) {
              const output = document.createElement("canvas");
              output.width = output.height = 160;
              const context = output.getContext("2d");
              if (context) {
                const side = Math.min(image.naturalWidth, image.naturalHeight);
                context.fillStyle = "#fff";
                context.fillRect(0, 0, 160, 160);
                context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2,
                  side, side, 0, 0, 160, 160);
                avatar = output.toDataURL("image/jpeg", 0.82);
              }
            }
            resolve();
          };
          image.src = String(reader.result);
        };
        reader.readAsDataURL(file);
      });
    });
    form.append(textButton("移除头像", () => {
      avatarRevision++;
      avatar = "";
      avatarFile.value = "";
      showToast("保存设置后移除头像。");
    }, "text-button"));
    const accent = labeledSelect("主题色", [
      { code: "jade", label: "青绿" }, { code: "blue", label: "雾蓝" }, { code: "amber", label: "暖棕" }
    ], account.accent);
    const compactLabel = document.createElement("label");
    compactLabel.className = "publish-option";
    const compact = document.createElement("input");
    compact.type = "checkbox";
    compact.checked = account.compact;
    compactLabel.append(compact, "紧凑显示树洞");
    const actions = document.createElement("div");
    actions.className = "tree-actions";
    const save = document.createElement("button");
    save.className = "primary-button";
    save.textContent = "保存设置";
    actions.append(save, textButton("退出登录", async () => {
      try {
        await apiJson("/api/account", { action: "logout" });
        applyAccountData({ user: null });
        openTree("reviews");
        showToast("已退出登录。");
      } catch (error) { showToast(error.message); }
    }, "text-button"));
    const local = loadLocalJson(RECORDS_KEY, []);
    if (Array.isArray(local) && local.some((record) => !state.localRecords.some((saved) => saved.response_id === record.response_id))) {
      const importButton = textButton("导入本机旧测评", () => importLocalData(importButton, status));
      actions.append(importButton);
    }
    const status = document.createElement("p");
    status.className = "tree-copy";
    status.setAttribute("role", "status");
    form.append(accent.wrap, compactLabel, actions, status);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        await avatarTask;
        const data = await apiJson("/api/account", { action: "settings", account: true, account_username: account.username,
          nickname: nickname.value, bio: bio.value, avatar, accent: accent.select.value, compact: compact.checked });
        Object.assign(account, data.settings);
        nickname.value = account.nickname;
        applyPersonalAppearance();
        status.textContent = "设置已保存。";
      } catch (error) { status.textContent = error.message; }
      finally { save.disabled = false; }
    });
    card.append(form);
    container.append(card);
  }

  function savedRecommendationLinks(record) {
    const snapshot = record?.recommendation_snapshot;
    const items = [...(snapshot?.top || []), ...(snapshot?.community_pick ? [snapshot.community_pick] : [])];
    if (!items.length) return null;
    const list = document.createElement("ul");
    list.className = "saved-recommendations";
    for (const item of items) {
      const anime = ANIME_CATALOG.find(({ id }) => id === item.anime_id);
      const ref = item.external_ref || (anime ? externalRefForAnime(anime) : manualRef(item.title));
      const row = document.createElement("li");
      row.append(workLink(ref));
      if (item.source === "similar" || item.source === "reviews") row.append(" · 社区加推");
      list.append(row);
    }
    return list;
  }

  function renderTreeData(container) {
    const sections = [
      ["测评", "40 道题用于描述番剧审美。第 40 题的本命番与前面的审美选择共同决定核心推荐。性格自述在相似口味匹配中占较低权重。"],
      ["社区加推", "推荐会优先从相似用户共同选择的本命番中挑一部。样本不足时使用树洞好评。有合适的作品时才显示，推荐结果会保留作品链接。"],
      ["追番与分享", "待追与已追清单按账号保存。已追作品的重刷次数、喜爱程度与评价会帮助找番。分享页只显示你勾选的内容，访客无需登录。"],
      ["站外讨论", "按作品与年份匹配 Kitsu 评论，并展示提炼的标签、互动数和原文链接。Bangumi 提供作品和讨论入口。"],
      ["作品索引", "测评推荐和找番共用 Bangumi 检索，优先使用 2012 年及以后首播的作品。搜番支持别称、角色、剧情关键词和外部反向搜图。"],
      ["账号与树洞发言", "登录后发布的评价会匿名公开。一次测评会把第 40 题的本命番和喜欢理由发布为一条发言。十项标准维度和推荐结果保存在账号档案，可在个人中心编辑或撤下树洞发言。"],
      ["数据使用", "新测评的标准维度用于相似口味匹配。管理员可查看测评结果、处理公开发言并导出汇总。个人设置可导入旧测评档案，旧记录保留原有可见范围。"]
    ];
    for (const [title, copy] of sections) {
      const card = document.createElement("section");
      card.className = "tree-card";
      card.append(titleElement(title, copy));
      container.append(card);
    }
  }

  async function detectServer() {
    if (!/^https?:$/.test(window.location.protocol)) return;
    try {
      const data = await apiJson("/api/health", undefined, 2500);
      state.apiOnline = true;
      state.accountsAvailable = data.accounts === true;
      state.externalSearchAvailable = data.externalSearch === true;
    } catch {
      state.apiOnline = false;
    }
  }

  async function persistProfileEdit(record) {
    if (!record?.consent?.profile_storage) return;
    if (!state.account) {
      saveQuestionnaireRecord(record);
      return;
    }
    try {
      await submitRecord(record, "update");
      saveQuestionnaireRecord(record);
      if (state.record === record) state.saveMode = "account";
    } catch (error) {
      if (state.record === record) state.saveMode = "account-error";
      showToast(error.message || "云端保存失败");
    }
  }

  async function saveCloudRating(rating, editing) {
    const data = await apiJson("/api/ratings", {
      ...rating, schemaVersion: 4, account: true, account_username: state.account.username, action: editing ? "update" : "create"
    });
    return data.rating;
  }

  function resetPersonalView() {
    cleanupTimers();
    state.answers = {};
    state.favorites = [emptyFavorite()];
    state.questionIndex = 0;
    state.consent = { profile_storage: true, similar_taste_anonymous_use: false };
    state.result = null;
    state.record = null;
    state.responseId = null;
    state.saveMode = null;
    state.feedback = {};
    state.savedSession = null;
    state.editingResponseId = null;
    state.treeSelectedWork = null;
    state.treeReturnScreen = "intro";
    dom.recommendations.replaceChildren();
    dom.communityList.replaceChildren();
    dom.resultDetails.replaceChildren();
    dom.favoriteEntries.replaceChildren();
    dom.resumeCard.hidden = true;
    showScreen("intro");
  }

  function applyAccountData(data) {
    const changed = state.account?.username !== data.user?.username;
    if (changed) resetPersonalView();
    state.account = data.user;
    if (state.account) {
      state.localRecords = (data.questionnaires || []).map((record) => {
        if (record.analysis && record.answers) {
          record.derived_profile = deriveProfile(record.answers, record.actual_favorites || []);
          record.derived_profile.preferences = WATCH_MODEL.choices(record.preferences);
          if (record.cleared_watch_need) record.derived_profile.context.current_watch_need = [];
        }
        return record;
      });
      state.ratings = data.ratings || [];
      state.accountReactions = data.reactions || [];
      state.legacyRecords = [];
    } else if (changed) {
      state.accountReactions = [];
      loadLocalData();
      state.savedSession = loadSavedSession();
      state.guestDashboard = loadLocalJson(COMPLETED_KEY, false) || Boolean(state.guestResult?.result) || state.localRecords.some((record) => record.response_id);
      renderResumeCard(state.savedSession);
    }
    applyPersonalAppearance();
    $("#account-open").hidden = Boolean(state.account);
    $("#admin-tab").hidden = state.account?.role !== "admin";
    if (state.screen === "tree" && ["profile", "history", "settings", "admin"].includes(state.treeTab)) renderTree();
  }

  function loadAccountArchive(user) {
    state.accountLoading = true;
    return apiJson("/api/account", undefined, 9500).then((data) => {
      if (state.account?.id !== user.id || data.user?.id !== user.id) return;
      state.accountLoading = false;
      applyAccountData(data);
    }).catch(() => {
      if (state.account?.id !== user.id) return;
      state.accountLoading = false;
      showToast("账号已登录，暂时无法读取档案。");
      if (state.screen === "tree" && state.treeTab === "profile") renderTree();
    });
  }

  function setAccountMode(mode) {
    state.accountMode = mode;
    const isRegister = mode === "register";
    $$("[data-account-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.accountMode === mode)));
    $("#account-confirm").hidden = !isRegister;
    $("#account-repeat").required = isRegister;
    $("#account-password").autocomplete = isRegister ? "new-password" : "current-password";
    $("#account-submit").textContent = isRegister ? "创建账号" : "登录";
    $("#account-status").textContent = "";
  }

  function openAccount({ message = "", mode = "login" } = {}) {
    if (!dom.accountModal.open) {
      setAccountMode(mode);
      const password = $("#account-password");
      password.type = "password";
      $("#account-show-password").textContent = "显示";
      $("#account-show-password").setAttribute("aria-pressed", "false");
      dom.accountModal.showModal();
    }
    const intro = $("#account-message");
    intro.textContent = message;
    intro.hidden = !message;
    $("#account-status").textContent = state.accountsAvailable ? "" : "当前环境未连接账号服务。";
  }

  async function handleAccountAction(action, fields = {}) {
    const status = $("#account-status");
    if (!state.accountsAvailable) {
      status.textContent = "账号服务暂时不可用。";
      return;
    }
    const buttons = $$("button", dom.accountModal);
    buttons.forEach((button) => { button.disabled = true; });
    status.textContent = "处理中…";
    try {
      await apiJson("/api/account", { action, ...fields });
      const needsArchive = state.pendingGuestRecord || state.guestResult?.record?.evaluation_version === "shared-1";
      const data = action === "logout" ? { user: null }
        : await apiJson(needsArchive ? "/api/account" : "/api/account?view=session");
      state.accountLoading = Boolean(data.user && !needsArchive);
      const fromResult = state.screen === "result" && Boolean(state.pendingGuestRecord);
      const guestRun = data.user && (fromResult ? buildSessionSnapshot() : state.guestResult);
      const pending = guestRun?.record?.evaluation_version === "shared-1" && guestRun.record;
      const inProgress = data.user && ["test", "favorites"].includes(state.screen) ? buildSessionSnapshot() : null;
      const resumeThread = data.user && state.treeTab === "thread" && state.screen === "tree" ? state.currentPost : null;
      const resumeReview = data.user && state.screen === "tree" ? state.treeSelectedWork : null;
      const resumeGeneral = data.user && state.screen === "tree" && state.treeTab === "library" ? state.generalDraft : null;
      applyAccountData(data);
      let bindError;
      if (pending) {
        status.textContent = "正在绑定本机测评…";
        restoreSession(guestRun);
        state.pendingGuestRecord = null;
        try {
          const boundId = state.record.response_id;
          if (!state.localRecords.some(({ response_id }) => response_id === boundId)) {
            await submitRecord(state.record, "create");
            saveQuestionnaireRecord(state.record);
          } else state.record = state.localRecords.find(({ response_id }) => response_id === boundId);
          if (!inProgress) clearSession();
          state.saveMode = "account";
          const localRecords = loadLocalJson(RECORDS_KEY, []);
          try {
            if (Array.isArray(localRecords)) window.localStorage.setItem(RECORDS_KEY,
              JSON.stringify(localRecords.filter(({ response_id }) => response_id !== boundId)));
            window.localStorage.removeItem(GUEST_RESULT_KEY);
          }
          catch { /* Keep the bound result available in memory. */ }
          state.guestResult = null;
        } catch (error) {
          state.saveMode = "account-error";
          bindError = error.message;
        }
        renderResultSaveState();
      }
      $("#account-form").reset();
      dom.accountModal.close();
      if (inProgress) {
        restoreSession(inProgress);
      } else if (resumeThread) {
        state.currentPost = resumeThread;
        openTree("thread");
      } else if (resumeReview) {
        openTree("library");
        openReviewEditor(resumeReview.ref, dom.treeContent, null, resumeReview.draft);
      } else if (resumeGeneral) {
        openTree("library");
        renderGeneralEditor(dom.treeContent, resumeGeneral);
      } else if (data.user && (!pending || !fromResult)) openTree("profile");
      else if (!data.user) handleGoHome();
      if (state.accountLoading && data.user) loadAccountArchive(data.user);
      showToast(bindError || (action === "logout" ? "已退出登录。" : pending ? "已登录，测评已绑定。" : "已登录。"));
    } catch (error) {
      status.textContent = error.message;
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  async function importLocalData(button, status) {
    const records = loadLocalJson(RECORDS_KEY, []);
    const missing = (Array.isArray(records) ? records : []).filter((record) =>
      record.consent?.profile_storage && !state.localRecords.some(({ response_id }) => response_id === record.response_id));
    button.disabled = true;
    status.textContent = "正在导入…";
    let saved = 0;
    let failed = 0;
    try {
      for (const record of missing) {
        try {
          await submitRecord(record, "import");
          saved += 1;
        } catch {
          failed += 1;
        }
      }
      applyAccountData(await apiJson("/api/account"));
      status.textContent = `已导入 ${saved} 条。${failed ? `${failed} 条未导入，可重试。` : ""}`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  async function exportAdminData(format) {
    try {
      const response = await fetchWithTimeout(`/api/export?format=${format}`, { cache: "no-store" }, 15000);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "导出暂时不可用");
      }
      const extension = format === "csv" ? "csv" : "json";
      downloadBlob(await response.blob(), `anime-soul-${format}-${new Date().toISOString().slice(0, 10)}.${extension}`);
      showToast("下载已开始。");
    } catch (error) {
      showToast(error.message);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Events and initialization                                          */
  /* ------------------------------------------------------------------ */

  function bindEvents() {
    $("#account-open").addEventListener("click", () => openAccount());
    dom.startButton.addEventListener("click", startNewQuestionnaire);
    $("#next-exploration").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try { await recalculateRecommendations({ nextExplore: true }); }
      finally { button.disabled = false; }
    });
    $$("[data-area]").forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.area === "reviews") state.currentBoard = null;
      openTree(button.dataset.area);
    }));
    $$("[data-go-home]").forEach((button) => button.addEventListener("click", handleGoHome));
    $("#result-home").addEventListener("click", handleGoHome);
    $("#help-open").addEventListener("click", () => openTree("data"));
    $("#feedback-open").addEventListener("click", () => $("#feedback-modal").showModal());
    $("#feedback-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button");
      const status = $("#feedback-status");
      button.disabled = true;
      status.textContent = "正在提交…";
      try {
        await apiJson("/api/site-feedback", Object.fromEntries(new FormData(form)));
        form.reset();
        status.textContent = "";
        $("#feedback-modal").close();
        showToast("反馈已提交。");
      } catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; }
    });
    dom.resumeButton.addEventListener("click", () => {
      if (state.savedSession) restoreSession(state.savedSession, { auto: true });
    });
    dom.testExitButton.addEventListener("click", handleTestExit);
    dom.prevButton.addEventListener("click", goBack);
    dom.favoritesBackButton.addEventListener("click", goBack);
    dom.favoritesForm.addEventListener("submit", handleFavoritesSubmit);
    dom.addFavorite.addEventListener("click", () => {
      if (state.favorites.length >= 5) return;
      state.favorites.push(emptyFavorite());
      renderFavoriteEntries();
      saveSession();
    });
    dom.treeBackButton.addEventListener("click", closeTree);
    $$("[data-tree-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        state.treeSelectedWork = null;
        openTree(button.dataset.treeTab);
      });
    });
    document.addEventListener("keydown", handleKeydown);
    $$("[data-account-mode]").forEach((button) => button.addEventListener("click", () => setAccountMode(button.dataset.accountMode)));
    $("#account-show-password").addEventListener("click", (event) => {
      const password = $("#account-password");
      const visible = password.type === "password";
      password.type = visible ? "text" : "password";
      event.currentTarget.textContent = visible ? "隐藏" : "显示";
      event.currentTarget.setAttribute("aria-pressed", String(visible));
    });
    $("#account-close").addEventListener("click", () => dom.accountModal.close());
    $("#account-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const fields = Object.fromEntries(new FormData(event.currentTarget));
      if (state.accountMode === "register" && (fields.password.length < 10 || fields.password !== $("#account-repeat").value)) {
        $("#account-status").textContent = fields.password.length < 10 ? "密码至少 10 个字符。" : "两次输入的密码不一致。";
        return;
      }
      handleAccountAction(state.accountMode, fields);
    });
  }

  async function init() {
    if (!Array.isArray(ANIME_CATALOG) || !ANIME_CATALOG.length) {
      console.error("Catalog missing");
      showToast("候选数据没有加载成功，请刷新页面。");
      return;
    }
    experience = createWatchExperience({ state, apiJson, openAccount, showToast, findWorks, renderWorkChoices,
      expandWorkResults, workLink, externalWorkLink, openWork, reviewWork, openBoard,
      textButton, openTree, sameWork, postCard });
    loadLocalData();
    state.savedSession = loadSavedSession();
    state.guestResult = loadLocalJson(GUEST_RESULT_KEY, null) || (state.savedSession?.result ? state.savedSession : null);
    state.guestDashboard = loadLocalJson(COMPLETED_KEY, false) || Boolean(state.guestResult?.result) || state.localRecords.some((record) => record.response_id);
    ensureFavoritesDraft();
    bindEvents();
    const landing = new URLSearchParams(location.search);
    const shareToken = landing.get("share");
    const sharedPost = landing.get("post");
    const targetWork = landing.get("work");
    const title = landing.get("workTitle");
    const board = landing.get("board");
    try {
      if (/^https?:$/.test(location.protocol)) {
        const data = await apiJson("/api/account?view=session", undefined, 4800);
        state.apiOnline = state.accountsAvailable = state.externalSearchAvailable = true;
        if (data.user) {
          state.accountLoading = true;
          applyAccountData(data);
          loadAccountArchive(data.user);
          state.sessionReady = true;
          if (shareToken) { state.shareToken = shareToken; openTree("shared"); }
          else if (sharedPost) { state.currentPost = sharedPost; openTree("thread"); }
          else if (board && /^\d{1,12}$/.test(board)) openBoard({ provider_id: board });
          else if (targetWork && /^\d{1,12}$/.test(targetWork)) openWork({ provider: "bangumi", provider_id: targetWork });
          else if (title) openWork({ ...manualRef(title), year: landing.get("year") });
          else openTree("profile");
          return;
        }
      }
    } catch {
      detectServer();
    } finally {
      $("#account-open").hidden = Boolean(state.account);
      dom.startButton.textContent = "开始测试";
      dom.startButton.disabled = false;
    }
    if (shareToken) { state.shareToken = shareToken; openTree("shared"); return; }
    if (sharedPost) { state.currentPost = sharedPost; openTree("thread"); return; }
    if (board && /^\d{1,12}$/.test(board)) { openBoard({ provider_id: board }); return; }
    if (targetWork && /^\d{1,12}$/.test(targetWork)) { openWork({ provider: "bangumi", provider_id: targetWork }); return; }
    if (title) { openWork({ ...manualRef(title), year: landing.get("year") }); return; }
    if (state.screen !== "intro") return;
    if (state.guestDashboard) {
      state.sessionReady = true;
      openTree("reviews");
      return;
    }
    let activeTab = false;
    try {
      activeTab = window.sessionStorage.getItem(ACTIVE_TAB_KEY) === "1";
    } catch {
      activeTab = false;
    }
    if (state.savedSession) {
      if (activeTab && ["test", "favorites"].includes(state.savedSession.screen)) {
        restoreSession(state.savedSession, { auto: true });
        return;
      }
      state.sessionReady = true;
      renderResumeCard(state.savedSession);
      return;
    }
    state.sessionReady = true;
  }

  init();
})();
