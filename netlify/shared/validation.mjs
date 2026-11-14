import assessment from "../../test-data.js";

const {
  QUESTIONS,
  TRAITS,
  FEATURES,
  HABITS,
  ARCHETYPES,
  DATA_QUALITY,
  buildArchetypeKey
} = assessment;

const QUESTION_BY_ID = new Map(QUESTIONS.map((question) => [question.id, question]));
const TRAIT_BY_KEY = new Map(TRAITS.map((trait) => [trait.key, trait]));
const FEATURE_KEYS = FEATURES.map((feature) => feature.key);
const HABIT_KEYS = HABITS.map((habit) => habit.key);
const SECTION_COUNTS = QUESTIONS.reduce((counts, question) => {
  counts[question.section] = (counts[question.section] || 0) + 1;
  return counts;
}, {});
const MATCH_STATUSES = new Set(["top1", "top3", "catalog", "none"]);

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
  }
}

function fail(message) {
  throw new ValidationError(message);
}

function cleanText(value, maxLength) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function cleanOptionalString(value, maxLength) {
  if (value === null || value === undefined || value === "") return null;
  return cleanText(value, maxLength);
}

function integerInRange(value, min, max, message) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) fail(message);
  return number;
}

function validateAnswers(inputAnswers) {
  if (!Array.isArray(inputAnswers) || inputAnswers.length !== QUESTIONS.length) {
    fail(`答案必须包含 ${QUESTIONS.length} 道题`);
  }

  const byId = new Map();
  for (const answer of inputAnswers) {
    if (!answer || typeof answer !== "object") fail("答案格式不正确");
    const id = cleanText(answer.id, 20);
    if (!QUESTION_BY_ID.has(id)) fail("题目编号不正确");
    if (byId.has(id)) fail("题目编号重复");
    const value = integerInRange(answer.value, 1, 5, "选项值必须为 1–5");
    byId.set(id, value);
  }
  if (byId.size !== QUESTIONS.length) fail("答案必须覆盖全部题目");

  return QUESTIONS.map((question) => {
    const value = byId.get(question.id);
    return {
      id: question.id,
      itemKey: question.itemKey,
      section: question.section,
      trait: question.trait || null,
      feature: question.feature || null,
      habit: question.habit || null,
      value,
      reverse: Boolean(question.reverse),
      attention: Boolean(question.attention),
      expected: question.attention ? question.expected : null,
      passed: question.attention ? value === question.expected : null
    };
  });
}

function deriveScores(answers) {
  const bigFive = {};
  TRAITS.forEach((trait) => {
    const values = answers
      .filter((answer) => answer.section === "personality" && answer.trait === trait.key)
      .map((answer) => (answer.reverse ? 6 - answer.value : answer.value));
    const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 3;
    bigFive[trait.key] = Math.round(((average - 1) / 4) * 100);
  });

  const preferences = {};
  FEATURE_KEYS.forEach((key) => {
    const answer = answers.find((item) => item.section === "preference" && item.feature === key);
    preferences[key] = answer ? answer.value : 3;
  });

  const habits = {};
  HABIT_KEYS.forEach((key) => {
    const answer = answers.find((item) => item.section === "habit" && item.habit === key);
    habits[key] = answer ? answer.value : 3;
  });

  return { bigFive, preferences, habits };
}

function deriveArchetype(bigFive) {
  const ordered = TRAITS
    .map((trait) => ({ ...trait, score: bigFive[trait.key] ?? 50 }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return TRAITS.findIndex((trait) => trait.key === a.key) - TRAITS.findIndex((trait) => trait.key === b.key);
    });
  const key = buildArchetypeKey(ordered[0].key, ordered[1].key);
  const archetype = ARCHETYPES[key] || { name: "自由漫游者" };
  return { key, name: archetype.name };
}

function deriveQuality(answers, durationSeconds) {
  const attentionChecks = answers
    .filter((answer) => answer.section === "attention")
    .map((answer) => ({
      id: answer.id,
      itemKey: answer.itemKey,
      expected: answer.expected,
      response: answer.value,
      passed: answer.value === answer.expected
    }));
  const attentionPassed = attentionChecks.length > 0 && attentionChecks.every((check) => check.passed);
  const personalityValues = answers
    .filter((answer) => answer.section === "personality")
    .map((answer) => answer.value);
  const mean = personalityValues.length
    ? personalityValues.reduce((sum, value) => sum + value, 0) / personalityValues.length
    : 0;
  const variance = personalityValues.length
    ? personalityValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / personalityValues.length
    : 0;
  const stdDev = Math.sqrt(variance);
  const straightLining = stdDev < DATA_QUALITY.straightLineStdDev;
  const flags = [];
  if (!attentionPassed) flags.push("attention");
  if (straightLining) flags.push("straight_lining");
  if (durationSeconds < DATA_QUALITY.minimumSeconds) flags.push("too_fast");

  return {
    valid: flags.length === 0,
    attentionPassed,
    straightLining,
    durationSeconds,
    flags,
    attentionChecks
  };
}

function validateRecommendations(recommendations) {
  if (!Array.isArray(recommendations) || recommendations.length !== 3) {
    fail("推荐结果必须包含 3 部作品");
  }
  return recommendations.map((item, index) => {
    if (!item || typeof item !== "object") fail("推荐结果格式不正确");
    const title = cleanText(item.title, 100);
    const animeId = cleanText(item.animeId, 100);
    if (!title || !animeId) fail("推荐作品缺少标识");
    const components = item.components && typeof item.components === "object" ? item.components : {};
    return {
      rank: index + 1,
      animeId,
      title,
      matchPercent: integerInRange(item.matchPercent, 70, 98, "推荐匹配分不正确"),
      rawScore: Number.isFinite(Number(item.rawScore)) ? Number(Number(item.rawScore).toFixed(4)) : null,
      qualityScore: Number.isFinite(Number(item.qualityScore)) ? Number(Number(item.qualityScore).toFixed(1)) : null,
      components: {
        taste: Number.isFinite(Number(components.taste)) ? Math.round(Number(components.taste)) : null,
        personality: Number.isFinite(Number(components.personality)) ? Math.round(Number(components.personality)) : null,
        habit: Number.isFinite(Number(components.habit)) ? Math.round(Number(components.habit)) : null,
        quality: Number.isFinite(Number(components.quality)) ? Math.round(Number(components.quality)) : null,
        craft: Number.isFinite(Number(components.craft)) ? Math.round(Number(components.craft)) : null
      }
    };
  });
}

export function validateRecord(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("样本格式不正确");
  if (payload.schemaVersion !== 2) fail("不支持的样本版本");
  if (payload.consent !== true) fail("未获得匿名保存授权");

  const id = cleanText(payload.id, 100);
  if (!/^[A-Za-z0-9_-]{6,100}$/.test(id)) fail("样本 ID 不正确");

  const answers = validateAnswers(payload.answers);
  const scores = deriveScores(answers);
  const archetype = deriveArchetype(scores.bigFive);

  const submittedDuration = Number(payload.quality?.durationSeconds);
  if (!Number.isFinite(submittedDuration) || submittedDuration < 0 || submittedDuration > 86400) {
    fail("作答时长不正确");
  }
  const quality = deriveQuality(answers, Math.round(submittedDuration));

  const favorite = payload.actualFavorite;
  if (!favorite || typeof favorite !== "object") fail("缺少最喜欢的番");
  const favoriteTitle = cleanText(favorite.title, 80);
  if (!favoriteTitle) fail("最喜欢的番不能为空");
  const favoriteReason = cleanText(favorite.reason, 1000);
  const matchStatus = cleanText(favorite.matchStatus, 16);
  if (!MATCH_STATUSES.has(matchStatus)) fail("本命匹配状态不正确");
  const predictedRank = favorite.predictedRank == null
    ? null
    : integerInRange(favorite.predictedRank, 1, 200, "本命预测排名不正确");

  const createdAtCandidate = cleanText(payload.createdAt, 40);
  const createdAt = Number.isNaN(Date.parse(createdAtCandidate))
    ? new Date().toISOString()
    : new Date(createdAtCandidate).toISOString();

  const responseTimesMs = Array.isArray(payload.responseTimesMs)
    ? payload.responseTimesMs.slice(0, QUESTIONS.length).map((value) => {
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
      })
    : [];

  return {
    schemaVersion: 2,
    testVersion: cleanText(payload.testVersion, 20) || "unknown",
    algorithmVersion: cleanText(payload.algorithmVersion, 40) || "unknown",
    catalogVersion: cleanText(payload.catalogVersion, 40) || "unknown",
    id,
    createdAt,
    receivedAt: new Date().toISOString(),
    locale: cleanText(payload.locale, 20) || null,
    answers,
    scores,
    archetype,
    quality,
    recommendations: validateRecommendations(payload.recommendations),
    actualFavorite: {
      title: favoriteTitle,
      reason: favoriteReason,
      normalizedTitle: cleanOptionalString(favorite.normalizedTitle, 160),
      matchedAnimeId: cleanOptionalString(favorite.matchedAnimeId, 100),
      matchedAnimeTitle: cleanOptionalString(favorite.matchedAnimeTitle, 100),
      predictedRank,
      matchStatus
    },
    responseTimesMs,
    consent: true,
    source: "netlify"
  };
}

export { QUESTION_BY_ID, SECTION_COUNTS };
