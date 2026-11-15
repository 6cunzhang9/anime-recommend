/* global SCHEMA_VERSION, QUESTIONNAIRE_VERSION, TEST_VERSION, QUESTIONS, QUESTION_MAP, WORK_TYPES, LIKE_STRENGTHS, FAVORITE_REASONS, getQuestion, getFavoriteReasonLabel, CATALOG_META, ANIME_CATALOG, ANIME_MEDIA */

(function () {
  "use strict";

  const ALGORITHM_VERSION = "rec-v4.0.0-initial";
  const PROFILE_VERSION = "profile-v4.0.0";
  const SESSION_KEY = "anime-soul-lab:session:v4";
  const RECORDS_KEY = "anime-soul-lab:questionnaires:v4";
  const RATINGS_KEY = "anime-soul-lab:ratings:v4";
  const LEGACY_KEYS = ["anime-soul-lab:responses:v3", "anime-soul-lab:responses:v2"];
  const ACTIVE_TAB_KEY = "anime-soul-lab:active-tab:v4";
  const TOTAL_QUESTIONS = 40;

  const CONFIG = {
    version: ALGORITHM_VERSION,
    anchor: 0.42,
    taste: 0.40,
    context: 0.06,
    craft: 0.08,
    quality: 0.04,
    avoidancePenalty: 0.34,
    repeatPenalty: 0.12,
    diversityPenalty: 0.18,
    maxCandidatesForDiversity: 12,
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
    adminView: "results",
    feedback: {},
    ratings: [],
    localRecords: [],
    legacyRecords: [],
    apiOnline: false,
    treeTab: "reviews",
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
    consentSimilar: $("#consent-similar"),
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
    adminOpenButton: $("#admin-open-btn"),
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
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
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

  function getOptionLabel(questionId, code) {
    const question = getQuestion(questionId);
    return question?.options?.find((option) => option.code === code)?.label || code;
  }

  function searchCatalog(query) {
    const normalized = normalizeTitle(query);
    if (!normalized) return [];
    const candidates = ANIME_CATALOG.map((anime) => {
      const titles = [anime.title, anime.romaji, anime.english, anime.native, ...(anime.aliases || [])]
        .filter(Boolean)
        .map(normalizeTitle);
      let score = 0;
      titles.forEach((title) => {
        if (title === normalized) score = Math.max(score, 100);
        else if (title.startsWith(normalized)) score = Math.max(score, 80);
        else if (title.includes(normalized)) score = Math.max(score, 60);
        else if (normalized.includes(title) && title.length >= 3) score = Math.max(score, 40);
      });
      return { anime, score };
    }).filter((item) => item.score > 0);
    return candidates.sort((a, b) => b.score - a.score || (b.anime.quality?.communityScore || 0) - (a.anime.quality?.communityScore || 0)).slice(0, 5);
  }

  function externalRefForAnime(anime) {
    return {
      provider: "anilist-candidate-snapshot",
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
    const provider = (ref) => ref.provider === "anilist-candidate-snapshot" ? "anilist" : ref.provider;
    if (left.provider_id && right.provider_id && provider(left) === provider(right)) {
      return String(left.provider_id) === String(right.provider_id);
    }
    const titles = [left.title_display, left.title_canonical].map(normalizeTitle).filter(Boolean);
    if ([right.title_display, right.title_canonical].map(normalizeTitle).some((title) => titles.includes(title))) return true;
    const anime = catalogAnimeForRef(left);
    return Boolean(anime && anime === catalogAnimeForRef(right));
  }

  async function lookupWorks(keyword) {
    const local = searchCatalog(keyword).map(({ anime }) => ({ ...externalRefForAnime(anime), year: anime.year }));
    const canonicalMatches = local.filter((ref) => {
      const anime = catalogAnimeForRef(ref);
      return anime && [anime.title, anime.romaji, anime.english, anime.native, ...(anime.aliases || [])]
        .some((name) => normalizeTitle(name) === normalizeTitle(keyword));
    });
    const localExact = canonicalMatches.length === 1 ? canonicalMatches[0] : null;
    if (!state.externalSearchAvailable) return { items: local, exact: localExact, fallback: true };
    try {
      const query = localExact?.title_display || keyword;
      const data = await apiJson(`/api/anime-search?q=${encodeURIComponent(query)}`, undefined, 4800);
      const remote = Array.isArray(data.items) ? data.items : [];
      const remoteExact = remote.filter((ref) => localExact
        ? sameWork(ref, localExact) && (!ref.year || !localExact.year || Number(ref.year) === Number(localExact.year))
        : [ref.title_display, ref.title_canonical].some((title) => normalizeTitle(title) === normalizeTitle(keyword)));
      return {
        items: [...remote, ...local.filter((candidate) => !remote.some((ref) => sameWork(ref, candidate)))].slice(0, 12),
        exact: remoteExact.length === 1 ? remoteExact[0] : localExact
      };
    } catch {
      return { items: local, exact: localExact, fallback: true };
    }
  }

  const workSearches = new Map();

  function findWorks(query) {
    const key = normalizeTitle(query);
    if (workSearches.has(key)) return workSearches.get(key);
    const lookup = lookupWorks(query);
    workSearches.set(key, lookup);
    lookup.then(({ fallback }) => { if (fallback) workSearches.delete(key); });
    if (workSearches.size > 30) workSearches.delete(workSearches.keys().next().value);
    return lookup;
  }

  function searchResultButton(ref, favorite = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = favorite ? "favorite-search-result" : "tree-search-result";
    const title = document.createElement("strong");
    title.textContent = ref.title_display;
    const meta = document.createElement("span");
    meta.textContent = [ref.year, ref.provider === "bangumi" ? "Bangumi" : "AniList"].filter(Boolean).join(" · ");
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

  function saveRatings() {
    saveLocalJson(RATINGS_KEY, state.ratings);
  }

  function buildSessionSnapshot() {
    return {
      version: 4,
      savedAt: new Date().toISOString(),
      screen: state.screen,
      questionIndex: state.questionIndex,
      answers: state.answers,
      favorites: state.favorites,
      consent: state.consent,
      result: state.result,
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
    if (!hasProgress && state.screen === "intro") return;
    const snapshot = buildSessionSnapshot();
    saveLocalJson(SESSION_KEY, snapshot);
    state.savedSession = snapshot;
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
    state.editingResponseId = session.editingResponseId || null;
    state.feedback = session.feedback && typeof session.feedback === "object" ? session.feedback : {};
    dom.consentSimilar.checked = state.consent.similar_taste_anonymous_use;

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
    showScreen("intro");
    renderResumeCard(state.savedSession);
  }

  function handleRetake() {
    const hasProgress = Object.keys(state.answers).length > 0 || state.result;
    if (hasProgress && !window.confirm("重新测试会清除当前草稿和上次结果，开始一份新的问卷。确定继续吗？")) return;
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
    dom.consentSimilar.checked = false;
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
    cleanupTimers();
    showScreen("intro");
    renderResumeCard(state.savedSession);
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
    dom.consentSimilar.checked = state.consent.similar_taste_anonymous_use;
    renderFavoriteEntries();
    showScreen("favorites");
    updateProgress();
    saveSession();
  }

  function refreshFavoritePublishLabel() {
    const local = !state.accountsAvailable;
    const archive = Boolean(state.editingResponseId && state.record && !state.record.publication);
    $("#favorite-publish-label").textContent = local ? "本机预览" : archive ? "更新旧测评档案" : "匿名发到树洞";
    $("#favorite-publish-note").textContent = local ? "当前环境只在此浏览器生成并保存结果。"
      : archive ? "这份旧测评会维持原有可见范围。"
      : "树洞显示这一步的作品和理由。完整问卷与推荐结果保存在账号档案。";
    dom.submitFavorites.textContent = archive || local ? "保存并查看推荐"
      : state.editingResponseId ? "更新发言并查看推荐" : "发布并查看推荐";
  }

  function renderFavoriteEntries() {
    refreshFavoritePublishLabel();
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
    const { year, ...external_ref } = ref;
    const anime = catalogAnimeForRef(ref);
    const type = anime ? externalRefForAnime(anime).media_type : ref.media_type;
    entry.title_raw = ref.title_display.slice(0, 120);
    entry.work_type = type || entry.work_type;
    entry.external_ref = external_ref;
    entry.confidence_title_match = "matched";
    titleInput.value = entry.title_raw;
    const typeSelect = document.getElementById(`favorite-type-${entry.draftId}`);
    if (typeSelect) typeSelect.value = entry.work_type;
    status.replaceChildren(workLink(ref, "查看已选条目 ↗"));
    status.className = "favorite-match-status is-matched";
    results.replaceChildren();
    results.hidden = true;
    saveSession();
  }

  async function searchFavoriteResults(entry, query, titleInput, status, results) {
    results.hidden = false;
    results.textContent = "搜索中…";
    const { items, exact } = await findWorks(query.trim());
    if (!results.isConnected || titleInput.value !== query || entry.external_ref) return;
    if (exact) {
      setFavoriteMatch(entry, exact, titleInput, status, results);
      return;
    }
    results.replaceChildren();
    if (!items.length) {
      results.textContent = "可直接使用原题名。";
      return;
    }
    for (const ref of items) {
      const button = searchResultButton(ref, true);
      button.addEventListener("click", () => setFavoriteMatch(entry, ref, titleInput, status, results));
      results.append(button);
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
    results.append(manual);
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

    const typeGroup = document.createElement("div");
    typeGroup.className = "field-group";
    const typeLabel = document.createElement("label");
    typeLabel.textContent = "作品类型";
    typeLabel.htmlFor = `favorite-type-${entry.draftId}`;
    const typeSelect = document.createElement("select");
    typeSelect.id = `favorite-type-${entry.draftId}`;
    WORK_TYPES.forEach((type) => {
      const option = document.createElement("option");
      option.value = type.code;
      option.textContent = type.label;
      typeSelect.append(option);
    });
    typeSelect.value = entry.work_type || "unknown";
    typeSelect.addEventListener("change", () => updateFavorite(entry, { work_type: typeSelect.value }));
    typeGroup.append(typeLabel, typeSelect);

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
    grid.append(typeGroup, strengthGroup);

    const reasonsGroup = document.createElement("div");
    reasonsGroup.className = "field-group";
    const reasonsLabel = document.createElement("p");
    reasonsLabel.className = "favorite-reasons-label";
    reasonsLabel.textContent = "喜欢的理由（至少 1 项，最多 4 项）";
    const reasonsGrid = document.createElement("div");
    reasonsGrid.className = "favorite-reasons-grid";
    FAVORITE_REASONS.forEach((reason) => {
      const label = document.createElement("label");
      label.className = "reason-checkbox";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = reason.code;
      input.checked = entry.reasons.includes(reason.code);
      input.addEventListener("change", () => {
        let selected = [...entry.reasons];
        if (input.checked) {
          if (selected.length >= 4) {
            input.checked = false;
            showToast("每部作品最多选择 4 个喜欢理由。");
            return;
          }
          selected.push(reason.code);
        } else {
          selected = selected.filter((code) => code !== reason.code);
        }
        updateFavorite(entry, { reasons: selected });
        if (reason.code === "reason_other") {
          const textArea = $(`#favorite-text-${entry.draftId}`);
          if (textArea) {
            textArea.required = selected.includes("reason_other");
            textArea.placeholder = selected.includes("reason_other")
              ? "选择“其他”时请至少补充 2 个字。"
              : "选填：它具体哪里打动了你？";
          }
        }
      });
      const text = document.createElement("span");
      text.textContent = reason.label;
      label.append(input, text);
      reasonsGrid.append(label);
    });
    reasonsGroup.append(reasonsLabel, reasonsGrid);

    const textGroup = document.createElement("div");
    textGroup.className = "field-group";
    const textLabel = document.createElement("label");
    textLabel.textContent = "具体打动你的地方（选填，最多 600 字）";
    textLabel.htmlFor = `favorite-text-${entry.draftId}`;
    const textArea = document.createElement("textarea");
    textArea.id = `favorite-text-${entry.draftId}`;
    textArea.rows = 3;
    textArea.maxLength = 600;
    textArea.value = entry.reason_text || "";
    textArea.placeholder = entry.reasons.includes("reason_other")
      ? "选择“其他”时请至少补充 2 个字。"
      : "选填：它具体哪里打动了你？";
    textArea.addEventListener("input", () => updateFavorite(entry, { reason_text: textArea.value }));
    textGroup.append(textLabel, textArea);

    card.append(head, titleGroup, grid, reasonsGroup, textGroup);
    return card;
  }

  function validateFavoriteEntries() {
    const entries = state.favorites.filter((entry) =>
      String(entry.title_raw || "").trim() ||
      String(entry.reason_text || "").trim() ||
      (Array.isArray(entry.reasons) && entry.reasons.length)
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
      const reasons = [...new Set(entry.reasons || [])];
      if (!reasons.length) return { ok: false, error: `作品 ${index + 1} 至少选择 1 个喜欢理由。` };
      if (reasons.length > 4) return { ok: false, error: `作品 ${index + 1} 的喜欢理由最多 4 个。` };
      if (reasons.some((code) => !FAVORITE_REASONS.some((reason) => reason.code === code))) {
        return { ok: false, error: `作品 ${index + 1} 的喜欢理由包含未知选项。` };
      }
      const reasonText = String(entry.reason_text || "").trim();
      if (reasonText.length > 600) return { ok: false, error: `作品 ${index + 1} 的补充文字过长。` };
      if (reasons.includes("reason_other") && reasonText.length < 2) {
        return { ok: false, error: `作品 ${index + 1} 选择了“其他”，请至少补充 2 个字。` };
      }
    }
    return { ok: true, entries };
  }

  async function normalizedFavorites(entries) {
    return Promise.all(entries.map(async (entry) => {
      const title = String(entry.title_raw || "").trim();
      let ref = entry.external_ref;
      if (!ref) {
        const { exact, items } = await findWorks(title);
        const selected = entry.external_ref;
        ref = selected || exact;
        if (!ref && items.length) throw new Error(`请为「${title}」选择条目，或点击「使用原题名」。`);
        ref ||= manualRef(title);
      }
      const { year, ...external_ref } = ref;
      const matched = external_ref.lookup_status === "matched";
      const anime = matched ? catalogAnimeForRef(external_ref) : null;
      return {
        title_raw: (matched ? external_ref.title_display : title).slice(0, 120),
        work_type: anime ? externalRefForAnime(anime).media_type : entry.work_type,
        external_ref,
        like_strength: entry.like_strength,
        reasons: [...new Set(entry.reasons)],
        reason_text: String(entry.reason_text || "").trim(),
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
    if (state.accountsAvailable && !state.account) {
      openAccount({ message: "登录后可发布本命番。已填写的内容会保留。" });
      return;
    }
    dom.favoritesError.hidden = true;
    dom.submitFavorites.disabled = true;
    $("#account-open").disabled = true;
    dom.submitFavorites.textContent = "正在生成推荐…";
    state.consent = { profile_storage: true, similar_taste_anonymous_use: dom.consentSimilar.checked };

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
      const result = buildRecommendations(profile, favorites);
      const responseId = state.editingResponseId || uid();
      const record = buildQuestionnaireRecord(responseId, profile, favorites, result);
      const previous = state.editingResponseId && state.record;
      if (previous) {
        record.submitted_at = previous.submitted_at;
        record.recommendation_snapshots = [...(previous.recommendation_snapshots || []),
          previous.recommendation_snapshot].filter(Boolean).slice(-5);
      }
      state.result = { ...result, profile };
      state.record = record;
      state.responseId = responseId;
      const pick = await selectCommunityPick(state.result, record);
      if (pick) record.recommendation_snapshot.community_pick = pick;

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
        state.saveMode = saveQuestionnaireRecord(record) ? "local" : "unsaved";
      }

      renderResult(state.result);
      showScreen("result");
      saveSession();
    } catch (error) {
      console.error(error);
      showScreen("favorites");
      showFavoritesError(error.message || "生成推荐时出了点问题，请稍后重试。");
    } finally {
      dom.submitFavorites.disabled = false;
      $("#account-open").disabled = false;
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
      completion: {
        answered_required: 40,
        total_required: 40,
        draft: false,
        submitted: true
      },
      profile_version: PROFILE_VERSION,
      derived_profile: profile,
      context: profile.context,
      self_description: profile.self_description,
      anchors: profile.anchors,
      actual_favorites: favorites,
      recommendation_snapshots: [],
      recommendation_snapshot: {
        algorithm_version: ALGORITHM_VERSION,
        config_version: `${ALGORITHM_VERSION}:initial`,
        computed_at: new Date().toISOString(),
        weights: CONFIG,
        top: result.top.map((entry) => ({
          rank: entry.rank,
          anime_id: entry.anime.id,
          title: entry.anime.title,
          external_ref: externalRefForAnime(entry.anime),
          score: Number(entry.score.toFixed(4)),
          source: entry.source,
          cluster_key: entry.clusterKey,
          evidence: entry.evidence.map((item) => item.text)
        })),
        candidates_considered: result.candidateCount,
        filtered: result.filtered
      },
      consent: {
        profile_storage: Boolean(state.consent.profile_storage),
        similar_taste_anonymous_use: Boolean(state.consent.similar_taste_anonymous_use)
      }
    };
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
  /* Recommendation engine: anchors > direct taste > context > quality  */
  /* ------------------------------------------------------------------ */

  const SETTING_HINTS = {
    set_everyday: { features: { healing: 0.9, comedy: 0.2 }, tags: ["日常", "生活", "家庭", "治愈"] },
    set_school_youth: { features: { romance: 0.45, healing: 0.4, comedy: 0.2 }, tags: ["校园", "青春", "成长"] },
    set_history: { features: { dark: 0.3, action: 0.2 }, tags: ["历史", "时代", "战争", "武士"] },
    set_fantasy: { features: { fantasy: 1 }, tags: ["奇幻", "魔法", "异世界", "神话"] },
    set_scifi: { features: { scifi: 0.9, mystery: 0.2 }, tags: ["科幻", "机甲", "太空", "未来"] },
    set_mystery_urban: { features: { mystery: 0.8, dark: 0.35 }, tags: ["悬疑", "推理", "都市", "犯罪"] },
    set_music_stage: { features: { sports: 0.25 }, tags: ["音乐", "乐队", "偶像", "舞台", "竞技"], craft: { music: 0.8 } },
    set_adventure_conflict: { features: { action: 0.8, fantasy: 0.25, scifi: 0.2 }, tags: ["冒险", "战争", "战斗", "史诗"] }
  };

  const DRIVER_HINTS = {
    drive_plot: { features: { mystery: 0.35, action: 0.35 }, tags: ["剧情", "冒险", "悬疑"] },
    drive_mystery: { features: { mystery: 1, dark: 0.3 }, tags: ["悬疑", "推理", "谜题", "反转"] },
    drive_character: { features: { healing: 0.25 }, tags: ["人物", "成长", "角色"] },
    drive_relationship: { features: { romance: 0.55, healing: 0.35 }, tags: ["关系", "群像", "羁绊"] },
    drive_world: { features: { fantasy: 0.7, scifi: 0.5 }, tags: ["世界观", "设定", "奇幻", "科幻"] },
    drive_performance: { features: { action: 0.7, sports: 0.5 }, tags: ["动作", "比赛", "舞台", "音乐"], craft: { visual: 0.4, music: 0.4 } },
    drive_mood: { features: { healing: 0.7 }, tags: ["氛围", "日常", "治愈"] }
  };

  const EMOTION_HINTS = {
    feel_warmth: { features: { healing: 0.9, romance: 0.3 }, tags: ["治愈", "温暖", "家庭"] },
    feel_exhilaration: { features: { action: 0.8, sports: 0.5 }, tags: ["热血", "战斗", "竞技"] },
    feel_tension: { features: { mystery: 0.6, dark: 0.6 }, tags: ["悬疑", "紧张", "心理"] },
    feel_sadness: { features: { dark: 0.6, romance: 0.3 }, tags: ["悲剧", "情感", "离别"] },
    feel_awe: { features: { fantasy: 0.6, scifi: 0.5 }, tags: ["史诗", "宏大", "奇观", "战争"] },
    feel_wonder: { features: { fantasy: 0.8, scifi: 0.5 }, tags: ["奇幻", "想象", "冒险"] },
    feel_reflection: { features: { mystery: 0.4, dark: 0.4 }, tags: ["思考", "哲学", "存在"] },
    feel_catharsis: { features: { action: 0.5, dark: 0.4 }, tags: ["释放", "热血", "情感"] }
  };

  const RELATION_HINTS = {
    rel_friendship: { features: { comedy: 0.3, healing: 0.3 }, tags: ["朋友", "伙伴", "群像"] },
    rel_family: { features: { healing: 0.6 }, tags: ["家庭", "亲情", "家人"] },
    rel_romance: { features: { romance: 0.9 }, tags: ["恋爱", "爱情", "青春"] },
    rel_rivals: { features: { sports: 0.4, action: 0.4 }, tags: ["对手", "竞争", "热血"] },
    rel_team: { features: { sports: 0.5, comedy: 0.3 }, tags: ["团队", "乐队", "社团", "群像"] },
    rel_mentor: { tags: ["师徒", "前辈", "成长"], features: { healing: 0.2 } },
    rel_companionship: { features: { healing: 0.5, romance: 0.2 }, tags: ["旅行", "陪伴", "公路"] },
    rel_conflict: { features: { dark: 0.5, mystery: 0.2 }, tags: ["对立", "冲突", "复杂"] }
  };

  const THEME_HINTS = {
    theme_identity: { features: { healing: 0.25 }, tags: ["成长", "自我", "身份"] },
    theme_connection: { features: { healing: 0.4, romance: 0.2 }, tags: ["关系", "陪伴", "家庭"] },
    theme_ideal: { features: { sports: 0.3, action: 0.2 }, tags: ["理想", "努力", "目标"] },
    theme_society: { features: { dark: 0.3, mystery: 0.2 }, tags: ["社会", "制度", "权力"] },
    theme_ethics: { features: { dark: 0.45 }, tags: ["道德", "选择", "代价"] },
    theme_life_death: { features: { dark: 0.55 }, tags: ["生命", "死亡", "存在"] },
    theme_civilization: { features: { dark: 0.4, action: 0.25 }, tags: ["历史", "战争", "文明", "人类"] },
    theme_creation: { tags: ["艺术", "创作", "音乐"], craft: { visual: 0.3, music: 0.3 } }
  };

  const FAVORITE_REASON_HINTS = {
    reason_plot: { features: { mystery: 0.25, action: 0.2 }, tags: ["剧情", "冒险"] },
    reason_world: { features: { fantasy: 0.35, scifi: 0.3 }, tags: ["世界观", "设定"] },
    reason_character: { tags: ["人物", "成长", "角色"] },
    reason_relationship: { features: { romance: 0.35, healing: 0.25 }, tags: ["关系", "群像", "羁绊"] },
    reason_emotion: { features: { romance: 0.2, dark: 0.25, healing: 0.2 }, tags: ["情感", "治愈"] },
    reason_theme: { features: { dark: 0.25, mystery: 0.2 }, tags: ["主题", "思考"] },
    reason_visual: { tags: ["美术", "视觉", "作画"], craft: { visual: 0.8 } },
    reason_direction: { tags: ["演出", "分镜"], craft: { visual: 0.9 } },
    reason_music: { tags: ["音乐", "配乐"], craft: { music: 1 } },
    reason_action_or_stage: { features: { action: 0.4, sports: 0.4 }, tags: ["动作", "舞台", "比赛"], craft: { visual: 0.3, music: 0.3 } },
    reason_pace_or_mood: { features: { healing: 0.3, mystery: 0.2 }, tags: ["氛围", "节奏"] }
  };

  const SCOPE_HINTS = {
    scope_intimate: { features: { healing: 0.6, romance: 0.35 }, tags: ["日常", "关系"] },
    scope_personal_growth: { tags: ["成长", "人物"], features: { healing: 0.25 } },
    scope_group: { features: { sports: 0.3, comedy: 0.25 }, tags: ["群像", "团队", "社团"] },
    scope_society: { features: { dark: 0.35, mystery: 0.2 }, tags: ["社会", "组织", "制度"] },
    scope_world: { features: { fantasy: 0.35, scifi: 0.3, dark: 0.2 }, tags: ["世界", "文明", "历史"] }
  };

  const ARC_HINTS = {
    arc_healing: { features: { healing: 0.55, romance: 0.2 }, tags: ["治愈", "和解"] },
    arc_growth: { features: { sports: 0.35, action: 0.25 }, tags: ["成长", "努力"] },
    arc_reveal: { features: { mystery: 0.5, dark: 0.25 }, tags: ["反转", "真相"] },
    arc_break: { features: { dark: 0.55 }, tags: ["悲剧", "崩塌"] },
    arc_bond: { features: { romance: 0.4, healing: 0.35 }, tags: ["关系", "羁绊"] },
    arc_static: { features: { healing: 0.2, comedy: 0.2 }, tags: ["日常", "群像"] }
  };

  const CRAFT_HINTS = {
    craft_animation: { visual: 1, tags: ["作画", "动作"] },
    craft_direction: { visual: 0.9, tags: ["演出", "分镜"] },
    craft_visual_style: { visual: 0.8, tags: ["美术", "色彩", "视觉"] },
    craft_music: { music: 1, tags: ["音乐", "配乐"] },
    craft_voice: { tags: ["声优", "声音"], visual: 0.1 },
    craft_writing: { tags: ["剧本", "结构", "文字"], quality: 0.1 }
  };

  const AVOID_RULES = {
    avoid_forced_romance: { tags: ["恋爱", "后宫", "少女向"], features: { romance: 0.55 }, amount: 0.2 },
    avoid_fanservice: { tags: ["福利", "后宫", "情色"], amount: 0.22 },
    avoid_cruelty: { tags: ["猎奇", "血腥", "虐待", "恐怖"], features: { dark: 0.6 }, amount: 0.25 },
    avoid_preachy: { tags: ["说教"], amount: 0.18 },
    avoid_formula: { tags: ["套路", "后宫"], amount: 0.12 },
    avoid_confusing: { tags: ["意识流", "非线性", "实验"], amount: 0.12 },
    avoid_low_stakes: { features: { healing: 0.45, comedy: 0.4 }, amount: 0.1 },
    avoid_high_stakes: { features: { action: 0.5, dark: 0.5 }, tags: ["战争", "战斗"], amount: 0.14 }
  };

  function emptyFeatureVector() {
    return Object.fromEntries(["fantasy", "scifi", "healing", "action", "mystery", "romance", "dark", "comedy", "sports"].map((key) => [key, 0]));
  }

  function addHint(weights, hint, factor = 1) {
    Object.entries(hint.features || {}).forEach(([key, value]) => {
      weights.features[key] = (weights.features[key] || 0) + value * factor;
    });
    (hint.tags || []).forEach((tag) => {
      weights.tags.set(tag, (weights.tags.get(tag) || 0) + factor);
    });
    if (hint.craft) {
      Object.entries(hint.craft).forEach(([key, value]) => {
        weights.craft[key] = (weights.craft[key] || 0) + value * factor;
      });
    }
  }

  function buildTasteWeights(profile) {
    const score = (value) => value && Number.isFinite(Number(value.value)) ? Number(value.value) : null;
    const weights = {
      features: emptyFeatureVector(),
      tags: new Map(),
      craft: { visual: 0, music: 0, writing: 0 },
      pace: null,
      currentNeed: [],
      avoidance: new Set(profile.taste.avoidance || []),
      paceAvoidance: new Set(profile.taste.pace_avoidance || [])
    };
    (profile.taste.setting_interest || []).forEach((code) => {
      if (code !== "set_no_pref" && SETTING_HINTS[code]) addHint(weights, SETTING_HINTS[code], 1);
    });
    (profile.taste.narrative_drivers_ranked || []).forEach((code, index) => {
      if (DRIVER_HINTS[code]) addHint(weights, DRIVER_HINTS[code], [1, 0.62, 0.34][index] || 0.2);
    });
    (profile.taste.desired_emotions_ranked || []).forEach((code, index) => {
      if (EMOTION_HINTS[code]) addHint(weights, EMOTION_HINTS[code], [1, 0.6, 0.32][index] || 0.2);
    });
    (profile.taste.relationship_interest || []).forEach((code) => {
      if (code !== "rel_no_pref" && RELATION_HINTS[code]) addHint(weights, RELATION_HINTS[code], 0.75);
    });
    (profile.taste.theme_interest || []).forEach((code) => {
      if (code !== "theme_none" && THEME_HINTS[code]) addHint(weights, THEME_HINTS[code], 0.7);
    });
    (profile.taste.craft_values_ranked || []).forEach((code, index) => {
      if (CRAFT_HINTS[code]) addHint(weights, CRAFT_HINTS[code], [1, 0.55, 0.28][index] || 0.1);
    });
    const music = getLikertValue("q29");
    if (music) weights.craft.music += (music - 3) * 0.25;
    if (profile.taste.setting_interest?.includes("set_everyday")) addHint(weights, SETTING_HINTS.set_everyday, 0.5);

    if (SCOPE_HINTS[profile.taste.preferred_story_scope]) addHint(weights, SCOPE_HINTS[profile.taste.preferred_story_scope], 0.65);
    if (ARC_HINTS[profile.taste.character_arc]) addHint(weights, ARC_HINTS[profile.taste.character_arc], 0.55);
    const characterHints = {
      char_growth: { features: { sports: 0.25, action: 0.2 }, tags: ["成长", "努力"] },
      char_consistency: { tags: ["严谨", "动机"], features: { mystery: 0.12 } },
      char_complexity: { features: { dark: 0.35 }, tags: ["复杂", "反英雄"] },
      char_charm: { features: { comedy: 0.25 }, tags: ["魅力", "角色"] },
      char_values: { features: { dark: 0.2 }, tags: ["信念", "选择"] },
      char_relation: { features: { romance: 0.25, healing: 0.2 }, tags: ["关系", "群像"] },
      char_identify: { features: { healing: 0.3, romance: 0.15 }, tags: ["成长", "人物"] }
    };
    (profile.taste.character_values_ranked || []).forEach((code, index) => {
      if (characterHints[code]) addHint(weights, characterHints[code], [0.7, 0.42, 0.22][index] || 0.1);
    });
    (profile.taste.worldbuilding_value || []).forEach((code) => {
      const hints = {
        world_rules: { features: { fantasy: 0.3, scifi: 0.25 }, tags: ["设定", "规则"] },
        world_discovery: { features: { fantasy: 0.35, scifi: 0.3 }, tags: ["冒险", "探索"] },
        world_metaphor: { features: { dark: 0.25, mystery: 0.2 }, tags: ["隐喻", "现实"] },
        world_spectacle: { features: { fantasy: 0.35, action: 0.2 }, tags: ["奇观", "史诗"] },
        world_stage: { features: { romance: 0.2, healing: 0.2 }, tags: ["关系", "人物"] }
      };
      if (hints[code]) addHint(weights, hints[code], 0.35);
    });
    const castScope = score(profile.taste.cast_scope);
    if (castScope >= 4) addHint(weights, { tags: ["群像", "多人物"], features: { comedy: 0.2, sports: 0.15 } }, 0.4);
    else if (castScope <= 2) addHint(weights, { tags: ["人物", "内心"], features: { healing: 0.2 } }, 0.25);
    const moral = score(profile.taste.protagonist_moral_complexity);
    if (moral >= 4) addHint(weights, { features: { dark: 0.3 }, tags: ["反英雄", "道德"] }, 0.35);
    if (score(profile.taste.reality_distance) === 5) addHint(weights, { features: { fantasy: 0.3, scifi: 0.25 } }, 0.5);
    if (score(profile.taste.reality_distance) === 1) addHint(weights, { features: { healing: 0.4 } }, 0.45);
    if (profile.taste.narrative_form === "form_non_linear") addHint(weights, { tags: ["非线性", "实验", "意识流"], features: { mystery: 0.25 } }, 0.55);
    if (profile.taste.narrative_form === "form_episode") addHint(weights, { tags: ["单元剧", "日常"], features: { healing: 0.3, comedy: 0.2 } }, 0.45);
    if (profile.taste.narrative_form === "form_multi") addHint(weights, { tags: ["群像", "多线"], features: { romance: 0.2 } }, 0.4);
    if (profile.taste.ambiguity_tolerance === "ambiguity_seek" || profile.taste.ambiguity_tolerance === "ambiguity_like") {
      addHint(weights, { tags: ["开放", "暧昧", "意识流"], features: { mystery: 0.3, dark: 0.2 } }, 0.55);
    }
    if (profile.taste.closure === "closure_bittersweet" || profile.taste.closure === "closure_open") {
      addHint(weights, { features: { dark: 0.25 }, tags: ["开放结局", "余韵"] }, 0.35);
    }
    if (profile.taste.romance_role === "romance_avoid") {
      weights.avoidance.add("avoid_forced_romance");
    } else if (profile.taste.romance_role === "romance_center" || profile.taste.romance_role === "romance_important") {
      addHint(weights, RELATION_HINTS.rel_romance, 0.6);
    }
    if (score(profile.taste.comic_relief) >= 4) addHint(weights, { features: { comedy: 0.5 }, tags: ["喜剧", "搞笑", "日常"] }, 0.55);
    if (score(profile.taste.emotional_intensity) >= 4) addHint(weights, { features: { dark: 0.3, action: 0.25 } }, 0.4);
    if (score(profile.taste.emotional_intensity) <= 2) addHint(weights, { features: { healing: 0.45 } }, 0.45);
    if (score(profile.taste.music_importance) >= 4) weights.craft.music += 0.25;
    if (score(profile.taste.performance_spectacle) >= 4) addHint(weights, { features: { action: 0.5, sports: 0.35 }, tags: ["动作", "舞台", "竞技"] }, 0.55);
    if (score(profile.taste.formal_experiment_interest) >= 4) addHint(weights, { tags: ["实验", "风格化", "意识流", "视觉"], craft: { visual: 0.45 } }, 0.5);
    if (score(profile.taste.pace_preference) >= 4) {
      addHint(weights, { features: { action: 0.4, mystery: 0.25, comedy: 0.2 } }, 0.55);
    } else if (score(profile.taste.pace_preference) <= 2) {
      addHint(weights, { features: { healing: 0.5 } }, 0.55);
    }
    if (score(profile.taste.mood_vs_progress) >= 4) addHint(weights, { features: { healing: 0.35, mystery: 0.2 } }, 0.4);
    if (score(profile.taste.mood_vs_progress) <= 2) addHint(weights, { features: { action: 0.3, mystery: 0.2 } }, 0.35);

    (profile.anchors.actual_favorites || []).forEach((favorite) => {
      const factor = favorite.like_strength === "love" ? 0.85 : favorite.like_strength === "recent_like" ? 0.45 : 0.6;
      (favorite.reasons || []).forEach((code) => {
        if (FAVORITE_REASON_HINTS[code]) addHint(weights, FAVORITE_REASON_HINTS[code], factor);
      });
    });

    const tradeoffs = profile.taste.tradeoffs || {};
    if (tradeoffs.surprise_vs_coherence === "tradeoff_surprise") {
      addHint(weights, { tags: ["反转", "实验", "非线性"], features: { mystery: 0.2 } }, 0.2);
    } else if (tradeoffs.surprise_vs_coherence === "tradeoff_coherence") {
      addHint(weights, { tags: ["严谨", "推理", "世界观"] }, 0.2);
    }
    if (tradeoffs.relation_vs_plot === "tradeoff_relation") {
      addHint(weights, { features: { romance: 0.2, healing: 0.2 }, tags: ["关系", "群像"] }, 0.22);
    } else if (tradeoffs.relation_vs_plot === "tradeoff_plot") {
      addHint(weights, { features: { mystery: 0.2, action: 0.15 }, tags: ["剧情"] }, 0.2);
    }
    if (tradeoffs.finish_vs_aftertaste === "tradeoff_finish") {
      addHint(weights, { tags: ["完整", "收束"] }, 0.12);
    } else if (tradeoffs.finish_vs_aftertaste === "tradeoff_aftertaste") {
      addHint(weights, { tags: ["余韵", "开放"], features: { dark: 0.1 } }, 0.18);
    }

    if (profile.taste.current_watch_need) weights.currentNeed = profile.taste.current_watch_need;
    weights.pace = profile.taste.pace_preference;
    weights.length = profile.taste.length_preference;
    return weights;
  }

  function currentNeedWeights(profile) {
    const map = {
      m_relax: { healing: 1, comedy: 0.3 },
      m_excite: { action: 1, sports: 0.4 },
      m_move: { romance: 0.5, dark: 0.4, healing: 0.3 },
      m_think: { mystery: 0.7, dark: 0.5 },
      m_escape: { fantasy: 0.7, scifi: 0.6, action: 0.3 },
      m_inspire: { fantasy: 0.3, visual: 0.2 }
    };
    const vector = emptyFeatureVector();
    (profile.context.current_watch_need || []).forEach((code) => {
      Object.entries(map[code] || {}).forEach(([feature, value]) => {
        if (vector[feature] !== undefined) vector[feature] += value;
      });
    });
    return vector;
  }

  function featureScore(features, vector) {
    let total = 0;
    let weight = 0;
    Object.entries(vector).forEach(([key, value]) => {
      if (!value) return;
      total += (features[key] || 0) * value;
      weight += value;
    });
    return weight ? total / weight : 0.5;
  }

  function tagMatchScore(anime, tagWeights) {
    let total = 0;
    let matched = 0;
    tagWeights.forEach((weight, tag) => {
      total += weight;
      if (anime.tags.some((candidate) => candidate.includes(tag) || tag.includes(candidate))) matched += weight;
    });
    return total ? matched / total : 0.5;
  }

  function animeFeatureVector(anime) {
    return anime.features || emptyFeatureVector();
  }

  function featureSimilarity(a, b) {
    const keys = Object.keys(emptyFeatureVector());
    const av = animeFeatureVector(a);
    const bv = animeFeatureVector(b);
    let dot = 0;
    let an = 0;
    let bn = 0;
    keys.forEach((key) => {
      const x = Number(av[key] || 0);
      const y = Number(bv[key] || 0);
      dot += x * y;
      an += x * x;
      bn += y * y;
    });
    return an && bn ? dot / Math.sqrt(an * bn) : 0;
  }

  function tagSimilarity(a, b) {
    const at = new Set(a.tags);
    const bt = new Set(b.tags);
    if (!at.size || !bt.size) return 0;
    const intersection = [...at].filter((tag) => bt.has(tag)).length;
    return intersection / new Set([...at, ...bt]).size;
  }

  function candidateToCandidateSimilarity(a, b) {
    return featureSimilarity(a, b) * 0.7 + tagSimilarity(a, b) * 0.3;
  }

  function favoriteWeight(favorite) {
    return favorite.like_strength === "love" ? 1 : favorite.like_strength === "recent_like" ? 0.65 : 0.8;
  }

  function anchorAnimeForEntry(entry) {
    const matched = catalogAnimeForRef(entry.external_ref);
    if (matched) return matched;
    const matches = searchCatalog(entry.title_raw);
    return matches[0]?.anime || null;
  }

  function buildAnchors(favorites) {
    const anchors = [];
    favorites.forEach((favorite) => {
      const anime = anchorAnimeForEntry(favorite);
      if (!anime) return;
      anchors.push({ anime, weight: favoriteWeight(favorite), source: "q40", title: favorite.title_raw, reasons: favorite.reasons });
    });
    state.legacyRecords.forEach((record) => {
      const title = record.actualFavorite?.title || record.actual_favorites?.[0]?.title_raw;
      if (!title) return;
      const matched = searchCatalog(title)[0]?.anime;
      if (matched && !anchors.some((anchor) => anchor.anime.id === matched.id)) {
        anchors.push({ anime: matched, weight: 0.4, source: "migration", title, reasons: [] });
      }
    });
    state.ratings.forEach((rating) => {
      if (!rating.external_ref || rating.external_ref.lookup_status !== "matched") return;
      if (rating.sentiment === "dislike" || rating.rating === 1) return;
      const anime = catalogAnimeForRef(rating.external_ref);
      if (!anime) return;
      if (anchors.some((anchor) => anchor.anime.id === anime.id)) return;
      const weight = rating.rating >= 4 || rating.sentiment === "like" ? 0.75 : 0.3;
      anchors.push({ anime, weight, source: "rating", title: anime.title, reasons: [] });
    });
    return anchors;
  }

  function anchorAffinity(anime, anchors) {
    if (!anchors.length) return 0.42;
    let total = 0;
    let weight = 0;
    anchors.forEach((anchor) => {
      total += candidateToCandidateSimilarity(anime, anchor.anime) * anchor.weight;
      weight += anchor.weight;
    });
    return weight ? clamp(total / weight, 0, 1) : 0.42;
  }

  function avoidancePenalty(anime, weights) {
    let penalty = 0;
    weights.avoidance.forEach((code) => {
      const rule = AVOID_RULES[code];
      if (!rule) return;
      const tagHit = (rule.tags || []).some((tag) => anime.tags.some((candidate) => candidate.includes(tag) || tag.includes(candidate)));
      const featureHit = Object.entries(rule.features || {}).some(([feature, threshold]) => (anime.features?.[feature] || 0) >= threshold);
      if (tagHit || featureHit) penalty += rule.amount || 0.1;
    });
    if (weights.paceAvoidance.size) {
      const pace = Number(anime.paceProxy || 3);
      if (weights.paceAvoidance.has("pace_static") && (anime.features?.healing || 0) > 0.62) penalty += 0.08;
      if (weights.paceAvoidance.has("pace_rushed") && (anime.features?.action || 0) > 0.8) penalty += 0.08;
    }
    return clamp(penalty, 0, 0.55);
  }

  function hardExcluded(anime) {
    const feedback = state.feedback[anime.id];
    if (feedback && ["unsuitable", "not_interested"].includes(feedback.status)) return true;
    const rating = state.ratings.find((item) => sameWork(item.external_ref, externalRefForAnime(anime)));
    if (rating && (rating.sentiment === "dislike" || rating.status === "dropped" || (rating.rating && Number(rating.rating) <= 2))) return true;
    return false;
  }

  function contextScore(anime, profile) {
    const need = currentNeedWeights(profile);
    const needScore = featureScore(anime.features, need);
    let entryFit = 0.5;
    const entry = profile.context.entry_threshold;
    const popularity = clamp(Number(anime.quality?.malScoredBy || 0) / 900000, 0, 1);
    if (entry === "entry_immediate") entryFit = popularity;
    else if (entry === "entry_gradual") entryFit = 0.5 + popularity * 0.25;
    else if (entry === "entry_patient") entryFit = 0.45;
    const experience = profile.context.watch_experience_band;
    const experienceFit = experience === "a_0_5" ? popularity * 0.8 + 0.1 : 0.5;
    const episodes = Number(anime.episodes || 0);
    const isFilm = String(anime.format || "").toUpperCase() === "MOVIE";
    const length = profile.taste.length_preference;
    let lengthFit = 0.5;
    if (length === "length_short") lengthFit = isFilm || (episodes > 0 && episodes <= 26) ? 1 : 0.2;
    else if (length === "length_medium") lengthFit = !isFilm && episodes > 12 && episodes <= 60 ? 1 : 0.4;
    else if (length === "length_long") lengthFit = !isFilm && episodes >= 40 ? 1 : 0.3;
    else if (length === "length_film") lengthFit = isFilm ? 1 : 0.25;
    return clamp(needScore * 0.48 + entryFit * 0.2 + experienceFit * 0.12 + lengthFit * 0.2, 0, 1);
  }

  function craftScore(anime, weights) {
    const visual = anime.signals?.visual ?? 0.5;
    const music = anime.signals?.music ?? 0.5;
    const craft = weights.craft;
    const total = (craft.visual || 0) + (craft.music || 0);
    if (!total) return 0.5;
    return clamp((visual * (craft.visual || 0) + music * (craft.music || 0)) / total, 0, 1);
  }

  function qualityTieBreak(anime) {
    return clamp((Number(anime.quality?.communityScore || 7.5) - 7.2) / 2.2, 0, 1);
  }

  function clusterKey(anime) {
    const features = Object.entries(anime.features || {}).sort((a, b) => b[1] - a[1]);
    const top = features.slice(0, 2).filter(([, value]) => value > 0.2).map(([key]) => key);
    return top.length ? top.join("+") : "balanced";
  }

  function buildEvidence(anime, profile, anchors, weights) {
    const evidence = [];
    const matchedAnchor = anchors.find((anchor) => candidateToCandidateSimilarity(anime, anchor.anime) > 0.34);
    if (matchedAnchor) {
      const sharedTags = anime.tags.filter((tag) => matchedAnchor.anime.tags.some((other) => other.includes(tag) || tag.includes(other))).slice(0, 3);
      evidence.push({
        text: `与你喜欢的《${matchedAnchor.title}》在${sharedTags.length ? `「${sharedTags.join("」「")}」` : "整体气质"}上有可追溯的相近，不是只按同题材判断。`,
        source: "anchor"
      });
    }

    const rankedDrivers = profile.taste.narrative_drivers_ranked || [];
    if (rankedDrivers[0]) {
      const label = codeLabel("q13", rankedDrivers[0]);
      const hint = DRIVER_HINTS[rankedDrivers[0]];
      const matchedTags = hint ? anime.tags.filter((tag) => hint.tags.some((target) => tag.includes(target) || target.includes(tag))) : [];
      if (matchedTags.length) {
        evidence.push({ text: `你在 q13 把「${label}」排在追看驱动第一位；本作标签中的「${matchedTags.slice(0, 2).join("、")}」与它对应。`, source: "q13" });
      }
    }

    const settings = profile.taste.setting_interest || [];
    for (const code of settings) {
      const hint = SETTING_HINTS[code];
      if (!hint) continue;
      const matchedTags = anime.tags.filter((tag) => hint.tags.some((target) => tag.includes(target) || target.includes(tag)));
      if (matchedTags.length) {
        evidence.push({ text: `你在 q09 选择了「${codeLabel("q09", code)}」；本作的「${matchedTags[0]}」标签属于这个方向。`, source: "q09" });
        break;
      }
    }

    const relations = profile.taste.relationship_interest || [];
    for (const code of relations) {
      const hint = RELATION_HINTS[code];
      if (!hint) continue;
      const matchedTags = anime.tags.filter((tag) => hint.tags.some((target) => tag.includes(target) || target.includes(tag)));
      if (matchedTags.length) {
        evidence.push({ text: `你在 q19 表示「${codeLabel("q19", code)}」容易打动你；本作包含「${matchedTags[0]}」的关系/群像线索。`, source: "q19" });
        break;
      }
    }

    const craft = profile.taste.craft_values_ranked || [];
    if (craft[0] && ["craft_music", "craft_animation", "craft_direction", "craft_visual_style"].includes(craft[0])) {
      const isMusic = craft[0] === "craft_music";
      const signal = Number(isMusic ? anime.signals?.music : anime.signals?.visual) || 0.5;
      if (signal >= 0.55) {
        evidence.push({ text: `你在 q28 把「${codeLabel("q28", craft[0])}」放在制作面向第一位；本作的${isMusic ? "音乐" : "视觉/演出"}信号相对突出。`, source: "q28" });
      }
    }

    if (evidence.length < 2) {
      const emotions = profile.taste.desired_emotions_ranked || [];
      if (emotions[0]) {
        const labels = codeLabel("q23", emotions[0]);
        evidence.push({ text: `你在 q23 把「${labels}」放在想带走的感受前列；本作的整体气质与这类体验有交集。`, source: "q23" });
      }
    }
    if (evidence.length < 2) {
      const topFeature = Object.entries(anime.features || {}).sort((a, b) => b[1] - a[1])[0];
      if (topFeature) {
        evidence.push({ text: `本作在候选描述里最突出的方向是「${topFeature[0]}」相关标签；证据强度低于明确作品锚点，仍作为一条可追溯的弱证据。`, source: "candidate" });
      }
    }
    if (evidence.length < 2) {
      evidence.push({ text: `本作通过了双平台口碑门槛，且在候选簇（${clusterKey(anime)}）中与本次回答的若干维度相交；这不是“同类题材必然喜欢”的断言。`, source: "quality_gate" });
    }
    return evidence.slice(0, 4);
  }

  function buildRecommendations(profile, favorites) {
    const anchors = buildAnchors(favorites);
    const weights = buildTasteWeights(profile);
    const favoriteIds = new Set(
      anchors.filter((anchor) => anchor.source === "q40").map((anchor) => anchor.anime.id)
    );
    const eligible = ANIME_CATALOG.filter((anime) => anime.quality?.eligible);
    const filtered = [];
    const scored = [];

    eligible.forEach((anime) => {
      if (favoriteIds.has(anime.id)) {
        filtered.push({ animeId: anime.id, reason: "already_in_favorites" });
        return;
      }
      if (hardExcluded(anime)) {
        filtered.push({ animeId: anime.id, reason: "hard_exclusion" });
        return;
      }
      const taste = featureScore(anime.features, weights.features) * 0.72 + tagMatchScore(anime, weights.tags) * 0.28;
      const anchor = anchorAffinity(anime, anchors);
      const context = contextScore(anime, profile);
      const craft = craftScore(anime, weights);
      const quality = qualityTieBreak(anime);
      const avoidance = avoidancePenalty(anime, weights);
      const seenFeedback = state.feedback[anime.id];
      const repeat = seenFeedback?.status === "seen" ? CONFIG.repeatPenalty : 0;
      const score = clamp(
        anchor * CONFIG.anchor +
        taste * CONFIG.taste +
        context * CONFIG.context +
        craft * CONFIG.craft +
        quality * CONFIG.quality -
        avoidance -
        repeat,
        0,
        1
      );
      scored.push({
        anime,
        score,
        anchor,
        taste,
        context,
        craft,
        quality,
        avoidance,
        repeat,
        clusterKey: clusterKey(anime),
        evidence: [],
        source: "核心匹配"
      });
    });

    scored.sort((a, b) => b.score - a.score || (b.anime.quality?.communityScore || 0) - (a.anime.quality?.communityScore || 0));
    const selected = [];
    while (selected.length < 3 && scored.length) {
      const pool = scored.filter((entry) => !selected.includes(entry)).slice(0, CONFIG.maxCandidatesForDiversity);
      if (!pool.length) break;
      let best = null;
      let bestAdjusted = -Infinity;
      pool.forEach((entry) => {
        const similarity = selected.length ? Math.max(...selected.map((picked) => candidateToCandidateSimilarity(entry.anime, picked.anime))) : 0;
        const sameCluster = selected.some((picked) => picked.clusterKey === entry.clusterKey) ? 0.04 : 0;
        const adjusted = entry.score - similarity * CONFIG.diversityPenalty - sameCluster;
        if (adjusted > bestAdjusted) {
          bestAdjusted = adjusted;
          best = entry;
        }
      });
      if (!best) break;
      best.scoreAdjusted = bestAdjusted;
      best.evidence = buildEvidence(best.anime, profile, anchors, weights);
      if (selected.length >= 2 && selected.every((picked) => picked.clusterKey !== best.clusterKey)) {
        best.source = "探索推荐";
      }
      selected.push(best);
    }

    const top = selected.map((entry, index) => ({
      ...entry,
      rank: index + 1,
      matchPercent: Math.round(clamp(54 + entry.score * 43, 54, 98))
    }));

    return {
      top,
      candidateCount: eligible.length,
      filtered,
      anchors: anchors.map((anchor) => ({ title: anchor.title, animeId: anchor.anime.id, source: anchor.source })),
      profile,
      config: CONFIG,
      generatedAt: new Date().toISOString()
    };
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
    if (!result.top.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "候选都被你的排除项过滤了。可以去树洞调整评价，或解除一个“不适合”的标记后再试。";
      dom.recommendations.append(empty);
    } else {
      result.top.forEach((entry, index) => dom.recommendations.append(renderRecommendationCard(entry, index)));
    }

    renderResultDetails(result, profile);
    renderResultSaveState();
    renderCommunityPick(state.record?.recommendation_snapshot?.community_pick);
  }

  function renderResultSaveState() {
    const messages = {
      server: "已保存问卷。登录后可导入本机档案。",
      account: state.record?.publication?.moderated ? "结果已保存。树洞发言已被管理员隐藏。"
        : state.record?.publication ? "本命番已匿名发布，推荐已保存到账号。" : "推荐已保存到账号。",
      "account-error": "云端保存失败。请重试，避免离开页面后丢失结果。",
      local: "已保存在本机。当前未连接收集服务。",
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
    body.append(top, tags, synopsis, evidenceList, sourceRow, feedback, details);
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
    if (state.consent.profile_storage) {
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
    if (state.consent.profile_storage) {
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
      ["匹配到的候选锚点", result.anchors?.length ? result.anchors.map((item) => `《${item.title}》`).join(" ") : "暂无"],
      ["候选数量", `${result.candidateCount} 部通过口碑门槛，${result.filtered.length} 部被硬排除`],
      ["算法配置", `${CONFIG.version} · 锚点 ${Math.round(CONFIG.anchor * 100)}% / 直接审美 ${Math.round(CONFIG.taste * 100)}% / 情境 ${Math.round(CONFIG.context * 100)}%`]
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
    const note = document.createElement("p");
    note.className = "rec-component-note";
    note.textContent = "权重是初始可配置值，未经过大样本验证；同一输入和同一配置版本可重现排序。";
    dom.resultDetails.append(note);
  }

  function workLink(ref, text) {
    const anchor = document.createElement("a");
    const title = ref?.title_display || ref?.title_canonical || "";
    anchor.textContent = text || title;
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
    const consentSimilar = record.consent?.similar_taste_anonymous_use === true;
    const favoriteRefs = (record.actual_favorites || []).map((entry) => entry.external_ref || manualRef(entry.title_raw));
    const weights = buildTasteWeights(profile);
    const alreadyKnown = [...result.top.map(({ anime }) => externalRefForAnime(anime)), ...favoriteRefs,
      ...state.ratings.filter((rating) => rating.status !== "want" || rating.sentiment === "dislike").map((rating) => rating.external_ref)];
    try {
      const data = await apiJson("/api/community", {
        response_id: record.response_id,
        consent_similar: consentSimilar,
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
        const anime = catalogAnimeForRef(ref);
        return !anime || (!hardExcluded(anime) && avoidancePenalty(anime, weights) === 0);
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
    rate.addEventListener("click", () => {
      openTree("library");
      openReviewEditor(pick.external_ref, dom.treeContent);
    });
    card.append(info, rate);
    dom.communityList.append(card);
  }

  /* ------------------------------------------------------------------ */
  /* Tree Hollow                                                        */
  /* ------------------------------------------------------------------ */

  function openTree(tab = "reviews") {
    if (state.screen === "loading") return;
    state.treeReturnScreen = state.screen === "tree" ? state.treeReturnScreen : state.screen;
    state.treeTab = tab;
    showScreen("tree");
    renderTree();
  }

  function closeTree() {
    const target = state.treeReturnScreen === "result" && state.result ? "result"
      : state.treeReturnScreen === "favorites" ? "favorites"
        : state.treeReturnScreen === "test" ? "test" : "intro";
    if (target === "test" && Object.keys(state.answers).length) renderQuestion({ announce: false });
    showScreen(target);
    if (target === "result" && state.result) renderResult(state.result);
  }

  function renderTree() {
    $$("[data-tree-tab]").forEach((button) => {
      const active = button.dataset.treeTab === state.treeTab;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    dom.treeContent.replaceChildren();
    if (state.treeTab === "reviews") renderPublicReviews(dom.treeContent);
    else if (state.treeTab === "profile") renderTreeProfile(dom.treeContent);
    else if (state.treeTab === "library") renderTreeLibrary(dom.treeContent);
    else if (state.treeTab === "history") renderTreeHistory(dom.treeContent);
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
      confidence_title_match: favorite.confidence_title_match || "unmatched"
    }));
    if (!state.favorites.length) state.favorites = [emptyFavorite()];
    state.record = record;
    state.responseId = record.response_id;
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
    const title = document.createElement("h2");
    title.textContent = "我的档案";
    const actions = document.createElement("div");
    actions.className = "tree-actions";
    if (current) {
      const exportButton = document.createElement("button");
      exportButton.type = "button";
      exportButton.className = "outline-button";
      exportButton.textContent = "导出我的数据包";
      exportButton.addEventListener("click", exportUserDataPackage);
      actions.append(exportButton);
    }
    heading.append(title, actions);
    container.append(heading);

    if (!current) {
      const empty = document.createElement("div");
      empty.className = "tree-empty";
      const text = document.createElement("p");
      text.textContent = "还没有可查看的 v4 问卷档案。先完成 40 道题，真实喜欢作品和推荐反馈会一起出现在这里。";
      const start = document.createElement("button");
      start.type = "button";
      start.className = "primary-button";
      start.textContent = "开始 40 题问卷";
      start.addEventListener("click", handleRetake);
      empty.append(text, start);
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
    intro.append(title2, summary, evidence);
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
    const visibility = current.record?.publication?.moderated ? "树洞发言已隐藏"
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

    if (state.result) {
      const resultActions = document.createElement("div");
      resultActions.className = "tree-actions";
      const view = document.createElement("button");
      view.type = "button";
      view.className = "primary-button";
      view.textContent = "继续看本次推荐";
      view.addEventListener("click", () => { showScreen("result"); renderResult(state.result); });
      resultActions.append(view);
      container.append(resultActions);
    }
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
    for (const [view, label] of [["results", "测评结果"], ["posts", "管理发言"]]) {
      const button = textButton(label, () => {
        state.adminView = view;
        renderTree();
      });
      button.setAttribute("aria-pressed", String(view === state.adminView));
      tabs.append(button);
    }
    container.append(head, tabs);
    renderPagedPosts(container, { admin: true, view: state.adminView });
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
    const profile = state.result?.profile || state.record?.derived_profile;
    if (!profile || !state.record) {
      showToast("还没有可重算的完整问卷。");
      return;
    }
    if (!Object.keys(state.answers).length && state.record.answers) {
      state.answers = {};
      QUESTIONS.slice(0, 39).forEach((question) => {
        if (state.record.answers[question.id] !== undefined) state.answers[question.id] = state.record.answers[question.id];
      });
    }
    const favorites = state.record.actual_favorites || [];
    const result = buildRecommendations(profile, favorites);
    state.result = { ...result, profile };
    if (state.record.recommendation_snapshot) {
      if (!Array.isArray(state.record.recommendation_snapshots)) state.record.recommendation_snapshots = [];
      state.record.recommendation_snapshots = [...state.record.recommendation_snapshots,
        state.record.recommendation_snapshot].slice(-5);
    }
    state.record.recommendation_snapshot = {
      algorithm_version: ALGORITHM_VERSION,
      config_version: `${ALGORITHM_VERSION}:initial`,
      computed_at: new Date().toISOString(),
      weights: CONFIG,
      top: result.top.map((entry) => ({
        rank: entry.rank,
        anime_id: entry.anime.id,
        title: entry.anime.title,
        external_ref: externalRefForAnime(entry.anime),
        score: Number(entry.score.toFixed(4)),
        source: entry.source,
        cluster_key: entry.clusterKey,
        evidence: entry.evidence.map((item) => item.text)
      })),
      candidates_considered: result.candidateCount,
      filtered: result.filtered
    };
    const index = state.localRecords.findIndex((item) => item.response_id === state.record.response_id);
    if (index >= 0) {
      state.localRecords[index] = state.record;
      saveLocalJson(RECORDS_KEY, state.localRecords);
    }
    const record = state.record;
    const pick = await selectCommunityPick(state.result, record);
    if (record !== state.record) return;
    if (pick) record.recommendation_snapshot.community_pick = pick;
    await persistProfileEdit(record);
    saveSession();
    renderResult(state.result);
    showScreen("result");
  }

  function renderTreeLibrary(container) {
    container.replaceChildren();
    const head = document.createElement("div");
    head.className = "tree-section-head";
    const title = document.createElement("div");
    title.innerHTML = "<h2>写评价</h2>";
    head.append(title);
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
      const manual = document.createElement("button");
      manual.type = "button";
      manual.className = "text-button";
      manual.textContent = "使用原题名";
      manual.addEventListener("click", () => openReviewEditor(manualRef(keyword), container));
      box.append(heading, list, manual);
      container.append(box);
      findWorks(keyword).then(({ items, fallback }) => {
        if (!list.isConnected) return;
        list.replaceChildren();
        if (!items.length) list.textContent = fallback ? "外部搜索暂不可用，可使用原题名。" : "未找到条目。";
        for (const ref of items) {
          const row = searchResultButton(ref);
          row.addEventListener("click", () => openReviewEditor(ref, container));
          list.append(row);
        }
      });
    }

    if (state.treeSelectedWork) {
      container.append(renderReviewEditor(container));
    }

    const saved = document.createElement("section");
    saved.className = "tree-card";
    saved.append(titleElement("我的评价"));
    if (!state.ratings.length) {
      const empty = document.createElement("p");
      empty.className = "tree-copy";
      empty.textContent = "还没有评价。搜索一部作品开始。";
      saved.append(empty);
    } else {
      const list = document.createElement("div");
      list.className = "tree-rating-list";
      [...state.ratings].sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || ""))).forEach((rating) => {
        const row = document.createElement("div");
        row.className = "tree-rating-item";
        const info = document.createElement("div");
        const name = workLink(rating.external_ref);
        const meta = document.createElement("span");
        const visibility = rating.publication?.moderated ? " · 已隐藏" : rating.public_review ? "" : " · 旧档案";
        meta.textContent = `${REVIEW_STATUSES.find((item) => item.code === rating.status)?.label || rating.status} · ${rating.rating ? `${rating.rating}/5` : "未评分"}${visibility}`;
        if (rating.comment) {
          const comment = document.createElement("small");
          comment.textContent = rating.comment;
          info.append(name, meta, comment);
        } else {
          info.append(name, meta);
        }
        const actions = document.createElement("div");
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "text-button";
        edit.textContent = "编辑";
        edit.addEventListener("click", () => openReviewEditor(rating.external_ref, container, rating));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "text-button";
        remove.textContent = "删除";
        remove.addEventListener("click", async () => {
          if (!window.confirm("删除这条评价？")) return;
          remove.disabled = true;
          try {
            if (state.account) await apiJson("/api/ratings", { action: "delete", id: rating.id, account: true, account_username: state.account.username });
          } catch (error) {
            showToast(error.message);
            remove.disabled = false;
            return;
          }
          state.ratings = state.ratings.filter((item) => item.id !== rating.id);
          saveRatings();
          renderTreeLibrary(container);
        });
        actions.append(edit, remove);
        row.append(info, actions);
        list.append(row);
      });
      saved.append(list);
    }
    container.append(saved);
  }

  function openReviewEditor(workRef, container, existing = null, draft = null) {
    const previous = existing || state.ratings.find((rating) => sameWork(workRef, rating.external_ref));
    state.treeSelectedWork = { ref: previous?.external_ref || workRef, existingId: previous?.id || null, draftId: uid(), draft };
    state.treeSearch = "";
    renderTreeLibrary(container);
    $(".review-editor select", container)?.focus();
  }

  function renderReviewEditor(container) {
    const selected = state.treeSelectedWork;
    const { year, ...workRef } = selected.ref;
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
    const ratingField = labeledSelect("评分", [
      { code: "0", label: "不评分" }, { code: "1", label: "1 / 5" }, { code: "2", label: "2 / 5" },
      { code: "3", label: "3 / 5" }, { code: "4", label: "4 / 5" }, { code: "5", label: "5 / 5" }
    ], values?.rating ? String(values.rating) : "0");
    const sentimentField = labeledSelect("偏好判断", [
      { code: "like", label: "喜欢" }, { code: "neutral", label: "一般" }, { code: "dislike", label: "不喜欢" }
    ], values?.sentiment || "neutral");
    form.append(statusField.wrap, ratingField.wrap, sentimentField.wrap);

    const reasonsLabel = document.createElement("p");
    reasonsLabel.className = "favorite-reasons-label";
    reasonsLabel.textContent = "理由标签（可选）";
    const reasonGrid = document.createElement("div");
    reasonGrid.className = "favorite-reasons-grid";
    const reasonInputs = [];
    FEEDBACK_REASON_TAGS.forEach((reason) => {
      const label = document.createElement("label");
      label.className = "reason-checkbox";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = reason.code;
      input.checked = values?.reason_tags?.includes(reason.code);
      const text = document.createElement("span");
      text.textContent = reason.label;
      label.append(input, text);
      reasonGrid.append(label);
      reasonInputs.push(input);
    });
    form.append(reasonsLabel, reasonGrid);

    const textLabel = document.createElement("label");
    textLabel.textContent = "简短文字（选填）";
    const text = document.createElement("textarea");
    text.id = "review-comment";
    textLabel.htmlFor = text.id;
    text.rows = 3;
    text.maxLength = 600;
    text.value = values?.comment || "";
    text.placeholder = "它具体哪里打动你，或为什么不适合？";
    form.append(textLabel, text);

    const note = document.createElement("p");
    note.className = "tree-copy";
    note.textContent = existing?.publication?.moderated ? "这条发言已被管理员隐藏。"
      : "评价会匿名公开。可在「我的评价」编辑或删除。";
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
      renderTreeLibrary(container);
    });
    actions.append(save, cancel);
    form.append(actions);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const rating = {
        id: existing?.id || selected.draftId,
        external_ref: workRef,
        status: statusField.select.value,
        rating: Number(ratingField.select.value) || null,
        sentiment: sentimentField.select.value,
        reason_tags: reasonInputs.filter((input) => input.checked).map((input) => input.value),
        comment: text.value.trim().slice(0, 600),
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
        saveRatings();
      } catch (error) {
        showToast(error.message || "无法保存评价");
        save.disabled = false;
        return;
      }
      state.treeSelectedWork = null;
      showToast(existing ? "评价已更新。" : "评价已匿名发布。");
      renderTreeLibrary(container);
    });

    card.append(form);
    return card;
  }

  function postCard(post) {
    const item = document.createElement("article");
    item.className = "tree-card public-review";
    const meta = document.createElement("p");
    meta.className = "post-meta";
    meta.textContent = `${post.type === "favorite" ? "测评本命番" : "番剧评价"} · ${formatDate(post.published_at)}`;
    item.append(meta);
    for (const work of post.works) {
      const block = document.createElement("div");
      block.className = "post-work";
      const title = document.createElement("h3");
      title.append(workLink(work.external_ref));
      block.append(title);
      const label = work.strength ? LIKE_STRENGTHS.find(({ code }) => code === work.strength)?.label
        : { like: "喜欢", dislike: "不喜欢", neutral: "一般" }[work.sentiment];
      const detail = document.createElement("p");
      detail.className = "tree-copy";
      detail.textContent = [
        work.rating && `${work.rating}/5`, label,
        ...(work.reasons || []).map((code) => getFavoriteReasonLabel(code))
      ].filter(Boolean).join(" · ");
      if (detail.textContent) block.append(detail);
      if (work.comment) {
        const comment = document.createElement("p");
        comment.textContent = work.comment;
        block.append(comment);
      }
      item.append(block);
    }
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

  function renderPagedPosts(container, { admin = false, view = "posts" } = {}) {
    const form = document.createElement("form");
    form.className = "tree-search feed-controls";
    const input = document.createElement("input");
    input.type = "search";
    input.maxLength = 120;
    input.placeholder = "按作品名搜索";
    input.setAttribute("aria-label", input.placeholder);
    const search = document.createElement("button");
    search.type = "submit";
    search.className = "outline-button";
    search.textContent = "搜索";
    const filter = labeledSelect("类型", [
      { code: "", label: "全部发言" }, { code: "favorite", label: "测评本命番" }, { code: "review", label: "番剧评价" }
    ], "");
    filter.select.setAttribute("aria-label", "发言类型");
    form.append(input, search);
    if (view === "posts") form.prepend(filter.select);
    if (!admin) form.append(textButton("写评价", () => openTree("library"), "primary-button"));

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
        if (append && next) params.set("before", next);
        const data = await apiJson(`/api/${admin ? "admin" : "reviews"}?${params}`);
        if (!list.isConnected || generation !== request) return;
        if (!append) list.replaceChildren();
        if (view === "results") {
          for (const row of data.results) list.append(adminResultCard(row));
          $("#admin-overview").textContent = `共 ${data.summary.total} 份测评`;
        } else {
          for (const post of data.posts) {
            const item = postCard(post);
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
              item.append(button);
              item.classList.toggle("is-moderated", post.moderated);
            }
            list.append(item);
          }
        }
        next = data.next;
        more.hidden = !next;
        status.textContent = list.children.length ? "" : view === "results" ? "暂无匹配的测评。" : "暂无匹配的发言。";
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
    renderPagedPosts(container);
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
    const head = document.createElement("div");
    head.className = "tree-section-head";
    const title = document.createElement("div");
    title.innerHTML = "<h2>历史档案</h2>";
    head.append(title);
    const actions = document.createElement("div");
    actions.className = "tree-actions";
    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "outline-button";
    exportButton.textContent = "导出完整数据包 JSON";
    exportButton.addEventListener("click", exportUserDataPackage);
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "text-button danger-text";
    clearButton.textContent = "删除本机数据";
    clearButton.addEventListener("click", clearLocalPersonalData);
    actions.append(exportButton);
    if (!state.account) actions.append(clearButton);
    head.append(actions);
    container.append(head);

    const records = [
      ...state.localRecords.map((record) => ({ record, legacy: false })),
      ...state.legacyRecords.map((record) => ({ record, legacy: true }))
    ].sort((a, b) => {
      const aTime = a.record.submitted_at || a.record.createdAt || "";
      const bTime = b.record.submitted_at || b.record.createdAt || "";
      return String(bTime).localeCompare(String(aTime));
    });

    if (!records.length) {
      const empty = document.createElement("div");
      empty.className = "tree-empty";
      empty.textContent = "暂无历史档案。";
      container.append(empty);
      return;
    }

    records.forEach(({ record, legacy }) => {
      const details = document.createElement("details");
      details.className = "history-item";
      const summary = document.createElement("summary");
      const left = document.createElement("div");
      const firstTitle = record.actual_favorites?.[0]?.title_raw || record.actualFavorite?.title || "未填写真实作品";
      const heading = document.createElement("strong");
      heading.textContent = `${formatDate(record.submitted_at || record.createdAt)} · 《${firstTitle}》`;
      const meta = document.createElement("span");
      meta.textContent = `${legacy ? "旧版档案" : `v${record.schemaVersion || 4} · ${record.questionnaire_version || record.testVersion || "未标记"}`} · ${record.actual_favorites?.length ? `${record.actual_favorites.length} 部真实喜欢` : record.actualFavorite?.title ? "旧版单部本命" : "无真实作品字段"}`;
      left.append(heading, meta);
      const rawButton = document.createElement("span");
      rawButton.className = "history-expand";
      rawButton.textContent = "查看档案";
      summary.append(left, rawButton);
      const pre = document.createElement("pre");
      pre.className = "history-json";
      pre.textContent = JSON.stringify(record, null, 2);
      details.append(summary);
      const links = savedRecommendationLinks(record);
      if (links) details.append(links);
      const raw = document.createElement("details");
      const rawTitle = document.createElement("summary");
      rawTitle.textContent = "原始数据";
      raw.append(rawTitle, pre);
      details.append(raw);
      if (!legacy) {
        const actions = document.createElement("div");
        actions.className = "tree-actions";
        const edit = textButton("编辑本命番", () => editFavoritesFromRecord(record));
        const remove = textButton("删除档案", async () => {
          if (!window.confirm(record.publication ? "删除这份测评及对应的树洞发言？" : "删除这份测评档案？")) return;
          remove.disabled = true;
          try {
            if (state.account) {
              await apiJson("/api/responses", { action: "delete", account: true,
                account_username: state.account.username, response_id: record.response_id });
            }
            state.localRecords = state.localRecords.filter((item) => item.response_id !== record.response_id);
            state.accountReactions = state.accountReactions.filter((item) => item.responseId !== record.response_id);
            saveLocalJson(RECORDS_KEY, state.localRecords);
            if (state.record?.response_id === record.response_id) {
              state.record = null;
              state.result = null;
              state.responseId = null;
              state.editingResponseId = null;
              state.feedback = {};
              clearSession();
            }
            renderTree();
            showToast("档案已删除。");
          } catch (error) {
            remove.disabled = false;
            showToast(error.message);
          }
        }, "text-button danger-text");
        actions.append(edit, remove);
        details.append(actions);
      }
      container.append(details);
    });

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
    container.append(titleElement("数据与推荐说明"));
    const sections = [
      ["测评", "40 道题用于描述番剧审美。第 40 题的本命番与前面的审美选择共同决定核心推荐。性格自述在相似口味匹配中占较低权重。"],
      ["社区加推", "开启相似口味推荐后，优先从相似用户共同选择的本命番中挑一部。样本不足时使用树洞好评。有合适的作品时才显示，推荐结果会保留作品链接。"],
      ["作品索引", "作品搜索来自 Bangumi。核心推荐使用 AniList 和 MyAnimeList 的精选候选快照，封面来自 AniList。搜索结果按需查询，保存档案或评价时只保留相关作品的引用。"],
      ["账号与树洞发言", "登录后发布的评价会匿名公开。一次测评会把第 40 题的本命番和喜欢理由发布为一条发言。前 39 题、画像和推荐结果保存在账号档案，可在历史中编辑本命番或删除整份测评。"],
      ["数据使用", "相似口味推荐需要单独开启。管理员可查看测评结果、处理公开发言并导出汇总。账号菜单可导入旧测评档案，旧记录保留原有可见范围。"]
    ];
    for (const [title, copy] of sections) {
      const card = document.createElement("section");
      card.className = "tree-card";
      card.append(titleElement(title, copy));
      container.append(card);
    }
  }

  function buildUserDataPackage() {
    return {
      schema_version: 4,
      questionnaire_version: QUESTIONNAIRE_VERSION,
      exported_at: new Date().toISOString(),
      field_notes: {
        raw_answers: "问卷原始答案，不因派生画像覆盖。",
        derived_profile: "可由原始答案重算的画像。",
        anchors: "真实喜欢作品、评价与推荐反馈。",
        legacy_records: "旧 v2/v3 档案，原样保存，不与 v4 字段混用。",
        ratings: "本机评价记录。",
        feedback: "本机推荐反馈。"
      },
      questionnaires: state.localRecords,
      legacy_questionnaires: state.legacyRecords,
      live_questionnaire: state.record,
      ratings: state.ratings,
      feedback: state.account ? state.accountReactions : state.feedback,
      current_profile: state.result?.profile || state.record?.derived_profile || null,
      current_recommendation_snapshot: state.record?.recommendation_snapshot || null,
      draft_session: state.savedSession,
      consents: state.consent
    };
  }

  function exportUserDataPackage() {
    const data = buildUserDataPackage();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(JSON.stringify(data, null, 2), `anime-soul-me-${stamp}.json`, "application/json;charset=utf-8");
    showToast("已导出个人数据包。");
  }

  function clearLocalPersonalData() {
    if (!window.confirm("删除本机保存的问卷、评价和草稿？这个操作不能撤销；服务器上的匿名样本不会被删除。")) return;
    try {
      window.localStorage.removeItem(RECORDS_KEY);
      window.localStorage.removeItem(RATINGS_KEY);
      window.localStorage.removeItem(SESSION_KEY);
      LEGACY_KEYS.forEach((key) => window.localStorage.removeItem(key));
      window.sessionStorage.removeItem(ACTIVE_TAB_KEY);
    } catch {
      // Ignore.
    }
    state.localRecords = [];
    state.legacyRecords = [];
    state.ratings = [];
    state.result = null;
    state.record = null;
    state.answers = {};
    state.favorites = [emptyFavorite()];
    state.feedback = {};
    state.responseId = null;
    state.saveMode = null;
    state.savedSession = null;
    state.consent = { profile_storage: true, similar_taste_anonymous_use: false };
    dom.consentSimilar.checked = false;
    renderTree();
    showToast("本机数据已删除。");
  }

  /* ------------------------------------------------------------------ */
  /* Admin data room                                                    */
  /* ------------------------------------------------------------------ */

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
      state.localRecords = data.questionnaires || [];
      state.ratings = data.ratings || [];
      state.accountReactions = data.reactions || [];
      state.legacyRecords = [];
    } else if (changed) {
      state.accountReactions = [];
      loadLocalData();
      state.savedSession = loadSavedSession();
      renderResumeCard(state.savedSession);
    }
    $("#account-open").textContent = state.account ? "我的账号" : "登录";
    $("#admin-tab").hidden = state.account?.role !== "admin";
    $("#account-admin").hidden = state.account?.role !== "admin";
    refreshAccountDialog();
    if (state.screen === "tree") renderTree();
  }

  function refreshAccountDialog() {
    $("#account-guest").hidden = Boolean(state.account);
    $("#account-member").hidden = !state.account;
    $("#account-name").textContent = state.account?.username || "";
    const local = loadLocalJson(RECORDS_KEY, []);
    $("#account-import").hidden = !Array.isArray(local) || !local.some((record) =>
      !state.localRecords.some((saved) => saved.response_id === record.response_id));
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

  function openAccount({ message = "", admin = false } = {}) {
    refreshAccountDialog();
    if (!dom.accountModal.open) {
      setAccountMode("login");
      const password = $("#account-password");
      password.type = "password";
      $("#account-show-password").textContent = "显示";
      $("#account-show-password").setAttribute("aria-pressed", "false");
      dom.accountModal.showModal();
    }
    if (admin) {
      $("#account-username").value = "admin";
      $("#account-password").focus();
    }
    $("#account-status").textContent = state.accountsAvailable ? message : "当前环境未连接账号服务。";
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
      const data = action === "logout" ? { user: null } : await apiJson("/api/account");
      const inProgress = data.user && ["test", "favorites"].includes(state.screen) ? buildSessionSnapshot() : null;
      const resumeReview = data.user && state.screen === "tree" ? state.treeSelectedWork : null;
      applyAccountData(data);
      $("#account-form").reset();
      dom.accountModal.close();
      if (inProgress) {
        restoreSession(inProgress);
      } else if (resumeReview) {
        openTree("library");
        openReviewEditor(resumeReview.ref, dom.treeContent, null, resumeReview.draft);
      } else if (data.user) openTree(data.user.role === "admin" ? "admin" : "profile");
      showToast(action === "logout" ? "已退出登录。" : "已登录。");
    } catch (error) {
      status.textContent = error.message;
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  async function importLocalData() {
    const button = $("#account-import");
    const status = $("#account-status");
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

  function openAdminHome() {
    if (state.account?.role === "admin") openTree("admin");
    else if (state.account) showToast("请退出当前账号，再使用 admin 登录。");
    else openAccount({ admin: true, message: "使用管理员密码登录管理主页。" });
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
    dom.startButton.addEventListener("click", startNewQuestionnaire);
    $$("[data-go-home]").forEach((button) => button.addEventListener("click", handleGoHome));
    $$(".js-retake").forEach((button) => button.addEventListener("click", handleRetake));
    $$(".js-open-tree").forEach((button) => button.addEventListener("click", () => openTree()));
    $("#help-open").addEventListener("click", () => openTree("data"));
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
    dom.consentSimilar.addEventListener("change", () => {
      state.consent.similar_taste_anonymous_use = dom.consentSimilar.checked;
      saveSession();
    });
    dom.treeBackButton.addEventListener("click", closeTree);
    $$("[data-tree-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        state.treeTab = button.dataset.treeTab;
        state.treeSelectedWork = null;
        renderTree();
      });
    });
    document.addEventListener("keydown", handleKeydown);
    dom.adminOpenButton.addEventListener("click", openAdminHome);
    $("#account-admin").addEventListener("click", () => {
      dom.accountModal.close();
      openAdminHome();
    });
    $$("[data-account-mode]").forEach((button) => button.addEventListener("click", () => setAccountMode(button.dataset.accountMode)));
    $("#account-show-password").addEventListener("click", (event) => {
      const password = $("#account-password");
      const visible = password.type === "password";
      password.type = visible ? "text" : "password";
      event.currentTarget.textContent = visible ? "隐藏" : "显示";
      event.currentTarget.setAttribute("aria-pressed", String(visible));
    });
    $("#account-open").addEventListener("click", openAccount);
    $("#account-close").addEventListener("click", () => dom.accountModal.close());
    $("#account-profile").addEventListener("click", () => {
      dom.accountModal.close();
      openTree("profile");
    });
    $("#account-import").addEventListener("click", importLocalData);
    $("#account-logout").addEventListener("click", () => handleAccountAction("logout"));
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
    loadLocalData();
    ensureFavoritesDraft();
    bindEvents();
    dom.startButton.disabled = true;
    $("#account-open").disabled = true;
    try {
      await detectServer();
      if (state.accountsAvailable) {
        const data = await apiJson("/api/account", undefined, 4500);
        if (data.user) {
          applyAccountData(data);
          state.sessionReady = true;
          if (data.user.role === "admin") openTree("admin");
          return;
        }
      }
    } catch {
      showToast("暂时无法读取账号档案。");
    } finally {
      dom.startButton.disabled = false;
      $("#account-open").disabled = false;
    }
    if (state.screen !== "intro") return;
    state.savedSession = loadSavedSession();
    let activeTab = false;
    try {
      activeTab = window.sessionStorage.getItem(ACTIVE_TAB_KEY) === "1";
    } catch {
      activeTab = false;
    }
    if (state.savedSession) {
      if (activeTab && state.savedSession.screen !== "intro") {
        restoreSession(state.savedSession, { auto: true });
        return;
      }
      state.sessionReady = true;
      renderResumeCard(state.savedSession);
      state.screen = "intro";
      return;
    }
    state.sessionReady = true;
    state.screen = "intro";
  }

  init();
})();
