"use strict";

const watchModel = require("./watch-model.js");
const standardTaste = require("./taste-analysis.js");
const seriesCatalog = require("./series-data.js");
const assessment = require("./test-data.js");

const {
  QUESTIONS,
  QUESTION_MAP,
  WORK_TYPES,
  LIKE_STRENGTHS,
  FAVORITE_REASONS
} = assessment;

const RESPONSE_ID_PATTERN = /^[A-Za-z0-9_-]{6,100}$/;
const FEATURE_KEYS = ["fantasy", "scifi", "healing", "action", "mystery", "romance", "dark", "comedy", "sports"];
const HABIT_KEYS = ["escape", "meaning", "social", "visual", "music", "pace"];
const FEEDBACK_VALUES = new Set(["want", "like", "neutral", "not_interested", "unsuitable", "seen"]);
const FEEDBACK_TAGS = new Set(["setting", "pace", "character", "emotion", "visual_music", "theme", "other"]);
const REVIEW_STATUSES = new Set(["want", "watching", "seen", "on_hold", "dropped"]);
const SENTIMENTS = new Set(["like", "neutral", "dislike"]);

class V4ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "V4ValidationError";
    this.status = 400;
  }
}

function fail(message) {
  throw new V4ValidationError(message);
}

function cleanText(value, max) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

function cleanOptional(value, max) {
  const text = cleanText(value, max);
  return text || null;
}

function ensureDate(value, fallback = new Date().toISOString()) {
  const text = cleanText(value, 50);
  return Number.isNaN(Date.parse(text)) ? fallback : new Date(text).toISOString();
}

function normalizeWorkTitle(value) {
  return cleanText(value, 160).normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, "");
}

function workIdentity(ref) {
  const provider = ref?.provider === "anilist-candidate-snapshot" ? "anilist" : ref?.provider;
  return provider && provider !== "manual" && ref.provider_id
    ? `${provider}:${ref.provider_id}`
    : `title:${normalizeWorkTitle(ref?.title_display || ref?.title_canonical)}`;
}

function validateExternalRef(input, required = false) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    if (required) fail("缺少作品外部引用");
    return null;
  }
  const provider = cleanText(input.provider, 60);
  const providerId = cleanText(input.provider_id, 120);
  const title = cleanText(input.title_display || input.title_canonical, 160);
  if (required && (!provider || !title)) fail("作品引用不完整");
  let canonicalUrl = "";
  if (provider === "series" && seriesCatalog.byId.has(providerId)) {
    return seriesCatalog.reference(seriesCatalog.byId.get(providerId));
  }
  const numericId = /^\d{1,12}$/.test(providerId);
  if (["bangumi", "bangumi-series"].includes(provider) && numericId) canonicalUrl = `https://bgm.tv/subject/${providerId}`;
  if (["anilist-candidate-snapshot", "anilist"].includes(provider) && numericId) {
    canonicalUrl = `https://anilist.co/anime/${providerId}`;
  }
  if (provider === "mal" && numericId) canonicalUrl = `https://myanimelist.net/anime/${providerId}`;
  const status = ["matched", "ambiguous", "unmatched", "stale"].includes(input.lookup_status)
    ? input.lookup_status : "unmatched";
  return {
    provider: canonicalUrl ? provider : "manual",
    provider_id: canonicalUrl ? providerId : "",
    canonical_url: canonicalUrl || (title ? `https://bgm.tv/subject_search/${encodeURIComponent(title)}?cat=2` : ""),
    title_canonical: cleanText(input.title_canonical, 160) || title,
    title_display: title,
    media_type: ["tv", "movie", "ova", "ona", "unknown"].includes(input.media_type) ? input.media_type : "unknown",
    lookup_status: canonicalUrl ? status : "unmatched",
    resolved_at: input.resolved_at ? ensureDate(input.resolved_at) : null,
    ...(["bangumi", "bangumi-series"].includes(provider) && /^\d{1,12}$/.test(String(input.series_id || "")) && {
      series_id: String(input.series_id), series_title: cleanText(input.series_title, 160)
    }),
    year: /^\d{4}$/.test(String(input.year || "")) ? Number(input.year) : null,
    features: watchModel.tags(input.features, 16)
  };
}

function validateFavorites(input) {
  let favorites = input;
  if (input && !Array.isArray(input) && Array.isArray(input.favorites)) favorites = input.favorites;
  if (!Array.isArray(favorites)) fail("q40 必须是作品数组");
  if (favorites.length < 1) fail("q40 至少填写 1 部真正喜欢的作品");
  if (favorites.length > 5) fail("q40 最多填写 5 部作品");
  return favorites.map((entry, index) => {
    if (!entry || typeof entry !== "object") fail(`第 ${index + 1} 部作品格式不正确`);
    const title = cleanText(entry.title_raw, 120);
    if (!title) fail(`第 ${index + 1} 部作品缺少题名`);
    const workType = WORK_TYPES.some((type) => type.code === entry.work_type) ? entry.work_type : null;
    if (!workType) fail(`第 ${index + 1} 部作品类型不正确`);
    const strength = LIKE_STRENGTHS.some((item) => item.code === entry.like_strength) ? entry.like_strength : null;
    if (!strength) fail(`第 ${index + 1} 部喜欢强度不正确`);
    const reasons = Array.isArray(entry.reasons) ? [...new Set(entry.reasons.map((code) => cleanText(code, 40)))] : [];
    if (!entry.review && !reasons.length) fail(`第 ${index + 1} 部至少选择 1 个理由`);
    if (reasons.length > 4) fail(`第 ${index + 1} 部理由最多 4 个`);
    if (reasons.some((code) => !FAVORITE_REASONS.some((reason) => reason.code === code))) {
      fail(`第 ${index + 1} 部包含未知理由`);
    }
    const reasonText = cleanText(entry.reason_text, 600);
    if (reasons.includes("reason_other") && reasonText.length < 2) {
      fail(`第 ${index + 1} 部选择了“其他”，请补充至少 2 个字`);
    }
    const review = watchModel.review(entry.review);
    if (entry.review && !review) fail("评价每项维度均需选择 1–10 分");
    return {
      ...(review && { review }),
      title_raw: title,
      work_type: workType,
      external_ref: validateExternalRef(entry.external_ref, false),
      like_strength: strength,
      reasons,
      reason_text: reasonText,
      confidence_title_match: ["matched", "ambiguous", "unmatched"].includes(entry.confidence_title_match)
        ? entry.confidence_title_match : "unmatched"
    };
  });
}

function validateAnswer(question, value) {
  if (question.type === "likert") {
    if (!value || typeof value !== "object") fail(`${question.id} 缺少 Likert 答案`);
    const numeric = Number(value.value);
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 5) fail(`${question.id} 分数不正确`);
    const expected = question.options[numeric - 1];
    const code = cleanText(value.code, 40) || expected.code;
    if (code !== expected.code) fail(`${question.id} 分值与选项代码不一致`);
    return { value: numeric, code };
  }
  if (question.type === "single") {
    const code = cleanText(value, 60);
    if (!question.options.some((option) => option.code === code)) fail(`${question.id} 选项不正确`);
    return code;
  }
  if (question.type === "multi") {
    if (!Array.isArray(value)) fail(`${question.id} 多选格式不正确`);
    const codes = value.map((code) => cleanText(code, 60));
    if (new Set(codes).size !== codes.length) fail(`${question.id} 选项重复`);
    if (codes.length > question.maxSelections) fail(`${question.id} 超过选择上限`);
    if (!codes.length) fail(`${question.id} 至少选择一项`);
    if (codes.some((code) => !question.options.some((option) => option.code === code))) fail(`${question.id} 包含未知选项`);
    if (question.noneCode && codes.includes(question.noneCode) && codes.length !== 1) fail(`${question.id}“无特别偏好”不能与其他项同选`);
    return codes;
  }
  if (question.type === "rank") {
    if (!Array.isArray(value) || value.length !== question.rankCount) fail(`${question.id} 必须恰好排 ${question.rankCount} 项`);
    const codes = value.map((code) => cleanText(code, 60));
    if (new Set(codes).size !== codes.length) fail(`${question.id} 排序不能重复`);
    if (codes.some((code) => !question.options.some((option) => option.code === code))) fail(`${question.id} 排序包含未知选项`);
    return codes;
  }
  if (question.type === "matrix") {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${question.id} 矩阵格式不正确`);
    const result = {};
    question.rows.forEach((row) => {
      const code = cleanText(value[row.key], 60);
      if (!row.options.some((option) => option.code === code)) fail(`${question.id} 的「${row.label}」未选择`);
      result[row.key] = code;
    });
    return result;
  }
  fail(`${question.id} 类型未知`);
}

function validateQuestionnaire(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("问卷格式不正确");
  if (Number(payload.schemaVersion) !== 4) fail("不支持的问卷版本");
  if (payload.questionnaire_version && payload.questionnaire_version !== "4.0.0") fail("问卷版本不是 4.0.0");
  const responseId = cleanText(payload.response_id || payload.id, 100);
  if (!RESPONSE_ID_PATTERN.test(responseId)) fail("response_id 格式不正确");
  if (!payload.answers || typeof payload.answers !== "object") fail("缺少答案对象");
  const answers = {};
  QUESTIONS.slice(0, 39).forEach((question) => {
    if (!(question.id in payload.answers)) fail(`缺少 ${question.id}`);
    answers[question.id] = validateAnswer(question, payload.answers[question.id]);
  });
  const favorites = validateFavorites(payload.actual_favorites || payload.answers.q40);
  if (payload.evaluation_version === "shared-1" && favorites.some((favorite) => !favorite.review)) {
    fail("每部本命番的每项维度均需选择 1–10 分");
  }
  answers.q40 = { favorites };
  const consentInput = payload.consent && typeof payload.consent === "object" ? payload.consent : {};
  const consent = {
    profile_storage: consentInput.profile_storage === true,
    similar_taste_anonymous_use: consentInput.similar_taste_anonymous_use === true && consentInput.profile_storage === true
  };
  const completionInput = payload.completion && typeof payload.completion === "object" ? payload.completion : {};
  const source = ["questionnaire", "migration", "manual"].includes(payload.source) ? payload.source : "questionnaire";
  return {
    schemaVersion: 4,
    questionnaire_version: "4.0.0",
    response_id: responseId,
    submitted_at: ensureDate(payload.submitted_at),
    received_at: new Date().toISOString(),
    locale: cleanText(payload.locale, 30) || "zh-CN",
    source,
    answers,
    preferences: watchModel.choices(payload.preferences),
    ...(payload.evaluation_version === "shared-1" && { evaluation_version: "shared-1" }),
    completion: {
      answered_required: 40,
      total_required: 40,
      draft: completionInput.draft === true,
      submitted: true
    },
    profile_version: cleanText(payload.profile_version, 40) || "profile-v4.0.0",
    derived_profile: payload.derived_profile && typeof payload.derived_profile === "object" ? payload.derived_profile : null,
    context: payload.context && typeof payload.context === "object" ? payload.context : null,
    self_description: payload.self_description && typeof payload.self_description === "object" ? payload.self_description : null,
    anchors: payload.anchors && typeof payload.anchors === "object" ? payload.anchors : { actual_favorites: favorites },
    actual_favorites: favorites,
    recommendation_snapshot: payload.recommendation_snapshot && typeof payload.recommendation_snapshot === "object"
      ? payload.recommendation_snapshot : null,
    recommendation_snapshots: Array.isArray(payload.recommendation_snapshots)
      ? payload.recommendation_snapshots.filter((item) => item && typeof item === "object").slice(-20)
      : [],
    consent
  };
}

function validateFeedback(payload) {
  if (!payload || typeof payload !== "object") fail("反馈格式不正确");
  if (Number(payload.schemaVersion) !== 4) fail("不支持的反馈版本");
  const responseId = cleanText(payload.responseId, 100);
  if (!RESPONSE_ID_PATTERN.test(responseId)) fail("反馈的 response_id 不正确");
  const animeId = cleanText(payload.animeId, 100);
  if (!animeId) fail("缺少番剧标识");
  const reaction = cleanText(payload.reaction, 30);
  if (!FEEDBACK_VALUES.has(reaction)) fail("反馈选项不正确");
  const reasonTags = Array.isArray(payload.reason_tags)
    ? [...new Set(payload.reason_tags.map((tag) => cleanText(tag, 30)).filter((tag) => FEEDBACK_TAGS.has(tag)))]
    : [];
  const comment = cleanText(payload.comment, 600);
  return {
    schemaVersion: 4,
    responseId,
    animeId,
    reaction,
    reason_tags: reasonTags,
    comment,
    createdAt: ensureDate(payload.createdAt),
    receivedAt: new Date().toISOString(),
    source: cleanText(payload.source, 40) || "recommendation_feedback"
  };
}

function validateRating(payload) {
  if (!payload || typeof payload !== "object") fail("评价格式不正确");
  if (Number(payload.schemaVersion) !== 4) fail("不支持的评价版本");
  const id = cleanText(payload.id, 100);
  if (!id) fail("评价 ID 不能为空");
  const workRef = validateExternalRef(payload.external_ref || payload.work_ref, true);
  const review = watchModel.review(payload.review);
  if ((payload.review || payload.evaluation_version === "shared-1") && !review) fail("评价每项维度均需选择 1–10 分");
  const status = REVIEW_STATUSES.has(payload.status) ? payload.status : null;
  if (!status) fail("评价状态不正确");
  const rating = payload.rating === null || payload.rating === undefined || payload.rating === ""
    ? null : Number(payload.rating);
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) fail("评分必须为 1–5 或空");
  const sentiment = SENTIMENTS.has(payload.sentiment) ? payload.sentiment : "neutral";
  const reasonTags = Array.isArray(payload.reason_tags)
    ? [...new Set(payload.reason_tags.map((tag) => cleanText(tag, 30)).filter((tag) => FEEDBACK_TAGS.has(tag)))]
    : [];
  return {
    schemaVersion: 4,
    id,
    ...(review && { review }),
    external_ref: workRef,
    work_ref: workRef,
    status,
    rating,
    sentiment,
    reason_tags: reasonTags,
    comment: cleanText(payload.comment, 600),
    anonymous_use: payload.anonymous_use === true,
    created_at: ensureDate(payload.created_at),
    updated_at: ensureDate(payload.updated_at),
    received_at: new Date().toISOString()
  };
}

function recordTasteCodes(record) {
  const answers = record.answers || {};
  const codes = [];
  [answers.q09, answers.q19, answers.q33].forEach((value) => {
    if (Array.isArray(value)) codes.push(...value);
  });
  if (Array.isArray(answers.q13) && answers.q13[0]) codes.push(answers.q13[0]);
  return new Set(codes);
}

function jaccardSets(a, b) {
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((code) => b.has(code)).length;
  return intersection / new Set([...a, ...b]).size;
}

function newestPerAccount(records) {
  const byOwner = new Map();
  const anonymous = [];
  const boundIds = new Set(records.filter((record) => record.accountOwner).map((record) => record.response_id));
  for (const record of records) {
    if (!record.accountOwner && boundIds.has(record.response_id)) continue;
    if (!record.accountOwner) {
      anonymous.push(record);
      continue;
    }
    const previous = byOwner.get(record.accountOwner);
    if (!previous || record.submitted_at > previous.submitted_at) byOwner.set(record.accountOwner, record);
  }
  return [...anonymous, ...byOwner.values()];
}

function personalityMatch(a, b) {
  const pairs = ["q05", "q06", "q07", "q08"].map((key) => [a?.[key]?.value, b?.[key]?.value])
    .filter((pair) => pair.every((value) => Number.isInteger(value) && value >= 1 && value <= 5));
  if (!pairs.length) return 0;
  return pairs.reduce((total, [left, right]) => total + 1 - Math.abs(left - right) / 4, 0) / pairs.length;
}

function groupWork(groups, ref) {
  const key = ["bangumi", "bangumi-series"].includes(ref.provider) && ref.provider_id
    ? workIdentity(ref) : normalizeWorkTitle(ref.title_display) || workIdentity(ref);
  let group = groups.get(key);
  if (!group) {
    group = { ref, votes: new Map() };
    groups.set(key, group);
  } else if (group.ref.provider === "manual" && ref.provider !== "manual") {
    group.ref = ref;
  }
  return group;
}

function communityItem(ref, count, source) {
  return { title: ref.title_display, display_title: ref.title_display, external_ref: ref,
    canonical_url: ref.canonical_url, signal_count: count, source };
}

function buildCommunity(records, ratings, request) {
  const signals = request?.signals;
  const requestCodes = new Set(["settings", "relationships", "themes", "drivers"].flatMap((key) =>
    Array.isArray(signals?.[key]) ? signals[key].filter((code) => typeof code === "string") : []));
  const actor = request?.accountOwner;
  const axes = request?.dimensions;
  const hasAxes = axes && Object.keys(standardTaste.AXES).every((key) =>
    Number.isFinite(axes[key]) && axes[key] >= 0 && axes[key] <= 100);
  const neighbors = request?.consent_similar === true ? newestPerAccount(records)
    .filter((record) => Number(record.schemaVersion) === 4 && record.consent?.similar_taste_anonymous_use === true && !record.publication?.moderated && !record.publication?.deleted_at)
    .filter((record) => record.response_id !== request.response_id && (!actor || record.accountOwner !== actor))
    .map((record) => {
      const taste = jaccardSets(requestCodes, recordTasteCodes(record));
      const personality = personalityMatch(request.personality, record.answers);
      const dimensions = hasAxes ? standardTaste.affinity(axes, record.analysis?.dimensions ||
        standardTaste.userDimensions(record.answers || {})) : 0;
      const similarity = hasAxes && (taste > 0 || dimensions >= 0.87)
        ? taste * 0.60 + personality * 0.12 + dimensions * 0.28 : taste * 0.8 + personality * 0.2;
      return { record, similarity };
    })
    .filter(({ similarity }) => similarity >= 0.15)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 25) : [];

  const similarWorks = new Map();
  for (const { record, similarity } of neighbors) {
    for (const favorite of record.actual_favorites || []) {
      if (!["love", "like", "recent_like"].includes(favorite.like_strength)) continue;
      const ref = validateExternalRef(favorite.external_ref || { provider: "manual", title_display: favorite.title_raw });
      if (!ref?.title_display) continue;
      const { votes } = groupWork(similarWorks, ref);
      votes.set(record.accountOwner || record.response_id, similarity);
    }
  }
  const similar = [...similarWorks.values()]
    .filter(({ votes }) => votes.size >= 2)
    .map(({ ref, votes }) => ({
      ...communityItem(ref, votes.size, "similar"),
      score: [...votes.values()].reduce((total, vote) => total + vote, 0)
    }))
    .sort((a, b) => b.score - a.score || b.signal_count - a.signal_count)
    .slice(0, 12);

  const ratedWorks = new Map();
  for (const rating of ratings) {
    if (rating.publication?.moderated || rating.publication?.deleted_at) continue;
    const isPublic = Boolean(rating.accountOwner) && rating.public_review === true;
    if (!isPublic && rating.anonymous_use !== true) continue;
    if (actor && rating.accountOwner === actor) continue;
    const ref = validateExternalRef(rating.external_ref || rating.work_ref);
    if (!ref?.title_display) continue;
    const explicitScore = Number(rating.rating);
    const negative = rating.sentiment === "dislike" || rating.status === "dropped";
    const score = negative ? Math.min(explicitScore || 2, 2) : explicitScore || (rating.sentiment === "like" ? 4 : 0);
    if (!score || score < 1 || score > 5) continue;
    const { votes } = groupWork(ratedWorks, ref);
    const voter = rating.accountOwner || rating.id;
    const date = rating.received_at || rating.updated_at || "";
    if (!votes.has(voter) || votes.get(voter).date < date) votes.set(voter, { score, date, isPublic });
  }
  const community = [...ratedWorks.values()].flatMap(({ ref, votes }) => {
    const values = [...votes.values()];
    const sum = values.reduce((total, vote) => total + vote.score, 0);
    if (sum / votes.size < 4 || (votes.size < 2 && !values.some((vote) => vote.isPublic))) return [];
    return [{
      ...communityItem(ref, votes.size, "reviews"),
      smoothed_score: Number(((sum + 3 * 3.5) / (votes.size + 3)).toFixed(2))
    }];
  }).sort((a, b) => b.smoothed_score - a.smoothed_score || b.signal_count - a.signal_count).slice(0, 12);
  return { available_similar: Boolean(similar.length), similar,
    available_community: Boolean(community.length), community };
}

function isLegacy(record) {
  return Number(record?.schemaVersion) < 4 || !record?.schemaVersion;
}

function summarize(records) {
  const v4 = records.filter((record) => Number(record.schemaVersion) === 4);
  const legacy = records.filter(isLegacy);
  const withReason = v4.filter((record) => (record.actual_favorites || []).length > 0).length;
  const legacyHits = legacy.filter((record) => ["top1", "top3"].includes(record.actualFavorite?.matchStatus)).length;
  return {
    total: v4.length,
    valid: v4.length,
    flagged: 0,
    rawTotal: records.length,
    legacyCount: legacy.length,
    withReason,
    top3Hits: legacyHits,
    hitRate: null,
    lastReceivedAt: records.map((record) => record.received_at || record.receivedAt || record.submitted_at || record.createdAt || "").sort().at(-1) || null
  };
}

function feedbackFor(record, animeId, reactions) {
  const items = reactions.filter((reaction) => reaction.responseId === record.response_id && reaction.animeId === animeId);
  return items.sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt))).at(-1) || null;
}

function flattenForCsv(records, reactions) {
  const headers = [
    "response_id", "submitted_at", "schema_version", "questionnaire_version", "source",
    "experience_band", "entry_threshold", "short_term_need",
    "favorite_count", "favorite_titles", "favorite_strengths", "favorite_reasons", "favorite_text",
    "top1_title", "top1_source", "top1_match", "top1_feedback",
    "top2_title", "top2_source", "top2_match", "top2_feedback",
    "top3_title", "top3_source", "top3_match", "top3_feedback",
    "consent_profile_storage", "consent_similar"
  ];
  const rows = records.map((record) => {
    if (isLegacy(record)) {
      return [
        record.id || "", record.createdAt || "", record.schemaVersion || 2, record.testVersion || "", "legacy",
        "", "", "",
        record.actualFavorite?.title ? 1 : 0,
        record.actualFavorite?.title || "", record.actualFavorite?.matchStatus || "",
        record.actualFavorite?.reason || "", "",
        "", "", "", "", "", "", "", "", "", "", "", "",
        "", ""
      ].map(csvEscape).join(",");
    }
    const favorites = record.actual_favorites || [];
    const top = record.recommendation_snapshot?.top || [];
    const fields = [];
    for (let i = 0; i < 3; i += 1) {
      const item = top[i] || {};
      fields.push(item.title || "", item.source || "", item.score ?? "", item.anime_id ? (feedbackFor(record, item.anime_id, reactions)?.reaction || "") : "");
    }
    return [
      record.response_id,
      record.submitted_at,
      record.schemaVersion,
      record.questionnaire_version,
      record.source,
      record.context?.watch_experience_band || "",
      record.context?.entry_threshold || "",
      JSON.stringify(record.context?.current_watch_need || []),
      favorites.length,
      favorites.map((favorite) => favorite.title_raw).join(" | "),
      favorites.map((favorite) => favorite.like_strength).join(" | "),
      favorites.map((favorite) => favorite.reasons.join("/")).join(" | "),
      favorites.map((favorite) => favorite.reason_text).filter(Boolean).join(" | "),
      ...fields,
      record.consent?.profile_storage === true,
      record.consent?.similar_taste_anonymous_use === true
    ].map(csvEscape).join(",");
  });
  return `\uFEFF${headers.map(csvEscape).join(",")}\r\n${rows.join("\r\n")}`;
}

function csvEscape(value) {
  let text = String(value === undefined || value === null ? "" : value);
  if (/^[\s\u0000-\u001f]*[=+\-@]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

module.exports = {
  V4ValidationError,
  validateQuestionnaire,
  validateFeedback,
  validateRating,
  summarize,
  flattenForCsv,
  buildCommunity,
  validateExternalRef,
  normalizeWorkTitle,
  workIdentity,
  isLegacy,
  FEEDBACK_VALUES,
  REVIEW_STATUSES
};
