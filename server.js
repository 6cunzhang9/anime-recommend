"use strict";

const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { createReadStream, existsSync } = require("node:fs");

let ASSESSMENT = null;
try {
  ASSESSMENT = require("./test-data.js");
} catch (error) {
  console.warn("Could not load test-data.js for server-side validation:", error.message);
}

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const RESPONSES_FILE = path.join(DATA_DIR, "responses.jsonl");
const REACTIONS_FILE = path.join(DATA_DIR, "reactions.jsonl");
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || "127.0.0.1";
const MAX_BODY_BYTES = 160 * 1024;
const POST_WINDOW_MS = 60 * 1000;
const POST_LIMIT = 30;

const STATIC_FILES = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/test-data.js", { file: "test-data.js", type: "text/javascript; charset=utf-8" }],
  ["/catalog.js", { file: "catalog.js", type: "text/javascript; charset=utf-8" }],
  ["/media-assets.js", { file: "media-assets.js", type: "text/javascript; charset=utf-8" }]
]);

const BIG_FIVE_KEYS = ["O", "C", "E", "A", "N"];
const FEATURE_KEYS = ["fantasy", "scifi", "healing", "action", "mystery", "romance", "dark", "comedy", "sports"];
const HABIT_KEYS = ["escape", "meaning", "social", "visual", "music", "pace"];
const SECTION_COUNTS = { personality: 20, preference: 9, habit: 6, scenario: 4, attention: 2 };
const QUALITY_FLAGS = new Set(["attention", "straight_lining", "too_fast"]);
const MATCH_STATUSES = new Set(["top1", "top3", "catalog", "none"]);
const REACTION_VALUES = new Set(["like", "neutral", "dislike", "unseen"]);

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://s4.anilist.co; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};

const rateBuckets = new Map();
let knownIds = new Set();
let writeQueue = Promise.resolve();

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function setHeaders(res, headers = {}) {
  for (const [name, value] of Object.entries({ ...securityHeaders, ...headers })) {
    res.setHeader(name, value);
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  setHeaders(res, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.writeHead(status);
  res.end(body);
}

function sendText(res, status, body) {
  setHeaders(res, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.writeHead(status);
  res.end(body);
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

function asNumberInRange(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let settled = false;
    const chunks = [];

    const fail = (status, message) => {
      if (settled) return;
      settled = true;
      reject(new ApiError(status, message));
    };

    req.on("data", (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        fail(413, "请求内容过长");
        req.resume();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new ApiError(400, "请求内容不是合法的 JSON"));
      }
    });

    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function allowPost(ip) {
  const now = Date.now();
  const recent = (rateBuckets.get(ip) || []).filter((timestamp) => now - timestamp < POST_WINDOW_MS);
  if (recent.length >= POST_LIMIT) {
    rateBuckets.set(ip, recent);
    return false;
  }
  recent.push(now);
  rateBuckets.set(ip, recent);
  return true;
}

function isExportAuthorized(req) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return true;

  const authorization = String(req.headers.authorization || "");
  const supplied = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : String(req.headers["x-admin-token"] || "").trim();
  if (!supplied) return false;

  const expectedDigest = crypto.createHash("sha256").update(expected).digest();
  const suppliedDigest = crypto.createHash("sha256").update(supplied).digest();
  return crypto.timingSafeEqual(expectedDigest, suppliedDigest);
}

function requireIntegerInRange(value, min, max, message) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new ApiError(400, message);
  return number;
}

const QUESTION_BY_ID = new Map(
  (ASSESSMENT && Array.isArray(ASSESSMENT.QUESTIONS) ? ASSESSMENT.QUESTIONS : []).map((question) => [question.id, question])
);
const EXPECTED_QUESTION_COUNT = QUESTION_BY_ID.size || 41;

function validateAnswers(answers) {
  if (!Array.isArray(answers) || answers.length !== EXPECTED_QUESTION_COUNT) {
    throw new ApiError(400, `答案必须包含 ${EXPECTED_QUESTION_COUNT} 道题`);
  }

  const allowedTraits = new Set(BIG_FIVE_KEYS);
  const allowedFeatures = new Set(FEATURE_KEYS);
  const allowedHabits = new Set(HABIT_KEYS);
  const seenIds = new Set();
  const sectionCounts = { personality: 0, preference: 0, habit: 0, scenario: 0, attention: 0 };

  const cleaned = answers.map((answer) => {
    if (!answer || typeof answer !== "object") throw new ApiError(400, "答案格式不正确");
    const id = cleanText(answer.id, 20);
    if (!id) throw new ApiError(400, "题目标识不完整");
    if (seenIds.has(id)) throw new ApiError(400, "题目编号重复");
    seenIds.add(id);

    const definition = QUESTION_BY_ID.get(id);
    let itemKey;
    let section;
    let responseType;
    let trait;
    let feature;
    let habit;
    let expected;
    let attention;
    let reverse;
    let options;

    if (definition) {
      itemKey = definition.itemKey;
      section = definition.section;
      responseType = definition.responseType;
      trait = definition.trait || null;
      feature = definition.feature || null;
      habit = definition.habit || null;
      expected = definition.attention ? definition.expected : null;
      attention = Boolean(definition.attention);
      reverse = Boolean(definition.reverse);
      options = Array.isArray(definition.options) ? definition.options : null;
    } else {
      // Fallback for an installation that starts the API without test-data.js.
      itemKey = cleanText(answer.itemKey, 40);
      section = cleanText(answer.section, 20);
      responseType = cleanText(answer.responseType, 20) || "agree";
      trait = cleanOptionalString(answer.trait, 1);
      feature = cleanOptionalString(answer.feature, 20);
      habit = cleanOptionalString(answer.habit, 20);
      expected = answer.expected == null ? null : requireIntegerInRange(answer.expected, 1, 5, "注意力校验答案不正确");
      attention = Boolean(answer.attention);
      reverse = Boolean(answer.reverse);
      options = null;
    }

    if (!Object.prototype.hasOwnProperty.call(SECTION_COUNTS, section)) {
      throw new ApiError(400, "题目分区不正确");
    }
    sectionCounts[section] += 1;
    if (trait !== null && !allowedTraits.has(trait)) throw new ApiError(400, "人格维度值不正确");
    if (feature !== null && !allowedFeatures.has(feature)) throw new ApiError(400, "内容偏好维度不正确");
    if (habit !== null && !allowedHabits.has(habit)) throw new ApiError(400, "观看习惯维度不正确");

    let value;
    if (section === "scenario") {
      const allowedOptionKeys = options ? new Set(options.map((option) => option.key)) : null;
      if (responseType === "multi") {
        if (!Array.isArray(answer.value)) throw new ApiError(400, "多选题答案格式不正确");
        const selectionCount = definition?.selectionCount || answer.value.length;
        if (answer.value.length !== selectionCount) throw new ApiError(400, "多选题选择数量不正确");
        value = [...new Set(answer.value.map((key) => cleanText(key, 40)))];
        if (value.length !== selectionCount) throw new ApiError(400, "多选题选项重复");
        if (allowedOptionKeys && value.some((key) => !allowedOptionKeys.has(key))) {
          throw new ApiError(400, "多选题选项不在题目定义中");
        }
        if (!value.length) throw new ApiError(400, "多选题没有选择");
      } else {
        value = cleanText(answer.value, 40);
        if (!value) throw new ApiError(400, "情境题选项不能为空");
        if (allowedOptionKeys && !allowedOptionKeys.has(value)) throw new ApiError(400, "情境题选项不在题目定义中");
      }
    } else {
      value = requireIntegerInRange(answer.value, 1, 5, "选项值必须为 1–5");
    }

    return {
      id,
      itemKey,
      section,
      responseType,
      trait,
      feature,
      habit,
      value,
      reverse,
      attention,
      expected,
      passed: attention ? value === expected : null
    };
  });

  if (QUESTION_BY_ID.size && seenIds.size !== QUESTION_BY_ID.size) {
    throw new ApiError(400, "答案必须覆盖全部题目");
  }
  for (const [section, expectedCount] of Object.entries(SECTION_COUNTS)) {
    if (sectionCounts[section] !== expectedCount) {
      throw new ApiError(400, `题目分区 ${section} 的数量不正确`);
    }
  }
  return cleaned;
}

function validateDimensionValues(value, keys, min, max, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, `缺少${label}`);
  }
  const cleaned = {};
  keys.forEach((key) => {
    cleaned[key] = requireIntegerInRange(value[key], min, max, `${label} ${key} 的值不正确`);
  });
  return cleaned;
}

function validateScores(scores) {
  if (!scores || typeof scores !== "object" || Array.isArray(scores)) {
    throw new ApiError(400, "缺少得分");
  }
  if (!scores.bigFive || typeof scores.bigFive !== "object") {
    throw new ApiError(400, "缺少 Big Five 得分");
  }
  const bigFive = {};
  BIG_FIVE_KEYS.forEach((key) => {
    bigFive[key] = requireIntegerInRange(scores.bigFive[key], 0, 100, `Big Five 分数 ${key} 不正确`);
  });
  return {
    bigFive,
    preferences: validateDimensionValues(scores.preferences, FEATURE_KEYS, 1, 5, "内容偏好"),
    habits: validateDimensionValues(scores.habits, HABIT_KEYS, 1, 5, "观看习惯")
  };
}

function deriveScores(answers) {
  if (!ASSESSMENT || !Array.isArray(ASSESSMENT.TRAITS) || !Array.isArray(ASSESSMENT.FEATURES) || !Array.isArray(ASSESSMENT.HABITS)) {
    return null;
  }
  const bigFive = {};
  ASSESSMENT.TRAITS.forEach((trait) => {
    const values = answers
      .filter((answer) => answer.section === "personality" && answer.trait === trait.key)
      .map((answer) => (answer.reverse ? 6 - answer.value : answer.value));
    const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 3;
    bigFive[trait.key] = Math.round(((average - 1) / 4) * 100);
  });
  const preferences = {};
  ASSESSMENT.FEATURES.forEach((feature) => {
    const answer = answers.find((item) => item.section === "preference" && item.feature === feature.key);
    preferences[feature.key] = answer ? answer.value : 3;
  });
  const habits = {};
  ASSESSMENT.HABITS.forEach((habit) => {
    const answer = answers.find((item) => item.section === "habit" && item.habit === habit.key);
    habits[habit.key] = answer ? answer.value : 3;
  });
  const scenarioSignals = {};
  ASSESSMENT.FEATURES.forEach((feature) => { scenarioSignals[feature.key] = 0; });
  answers.filter((answer) => answer.section === "scenario").forEach((answer) => {
    const definition = QUESTION_BY_ID.get(answer.id);
    const selectedKeys = Array.isArray(answer.value) ? answer.value : [answer.value];
    (definition?.options || []).forEach((option) => {
      if (!selectedKeys.includes(option.key)) return;
      Object.entries(option.weights || {}).forEach(([feature, weight]) => {
        if (scenarioSignals[feature] === undefined) return;
        scenarioSignals[feature] += Number(weight) || 0;
      });
    });
  });
  Object.keys(scenarioSignals).forEach((key) => {
    scenarioSignals[key] = Number(scenarioSignals[key].toFixed(3));
  });
  return { bigFive, preferences, habits, scenarioSignals };
}

function deriveScenarioAnswers(answers) {
  return answers
    .filter((answer) => answer.section === "scenario")
    .map((answer) => {
      const definition = QUESTION_BY_ID.get(answer.id);
      const selectedKeys = Array.isArray(answer.value) ? answer.value : [answer.value];
      const selectedOptions = (definition?.options || []).filter((option) => selectedKeys.includes(option.key));
      return {
        id: answer.id,
        itemKey: answer.itemKey,
        type: answer.responseType,
        selected: selectedKeys,
        selectedTitles: selectedOptions.map((option) => option.title)
      };
    });
}

function validateRecommendations(recommendations) {
  if (!Array.isArray(recommendations) || recommendations.length !== 3) {
    throw new ApiError(400, "推荐结果必须包含 3 部作品");
  }
  return recommendations.map((item, index) => {
    if (!item || typeof item !== "object") throw new ApiError(400, "推荐结果格式不正确");
    const title = cleanText(item.title, 100);
    const animeId = cleanText(item.animeId, 100);
    if (!title || !animeId) throw new ApiError(400, "推荐作品缺少标识");
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(animeId)) throw new ApiError(400, "推荐作品标识格式不正确");
    const components = item.components && typeof item.components === "object" ? item.components : {};
    return {
      rank: index + 1,
      animeId,
      title,
      matchPercent: requireIntegerInRange(item.matchPercent, 70, 98, "推荐匹配分不正确"),
      rawScore: Number.isFinite(Number(item.rawScore)) ? Number(Number(item.rawScore).toFixed(4)) : null,
      qualityScore: Number.isFinite(Number(item.qualityScore)) ? Number(Number(item.qualityScore).toFixed(1)) : null,
      components: {
        taste: asNumberInRange(components.taste, 0, 100),
        personality: asNumberInRange(components.personality, 0, 100),
        habit: asNumberInRange(components.habit, 0, 100),
        quality: asNumberInRange(components.quality, 0, 100),
        craft: asNumberInRange(components.craft, 0, 100)
      }
    };
  });
}

function validateQuality(quality) {
  if (!quality || typeof quality !== "object" || Array.isArray(quality)) {
    throw new ApiError(400, "缺少作答质量信息");
  }
  const flags = Array.isArray(quality.flags)
    ? [...new Set(quality.flags.map((flag) => cleanText(flag, 30)).filter((flag) => QUALITY_FLAGS.has(flag)))]
    : [];
  const valid = quality.valid === true;
  if (valid !== (flags.length === 0)) throw new ApiError(400, "作答质量标记与有效状态不一致");
  const durationSeconds = Number(quality.durationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0 || durationSeconds > 86400) {
    throw new ApiError(400, "作答时长不正确");
  }
  const attentionChecks = Array.isArray(quality.attentionChecks)
    ? quality.attentionChecks.slice(0, 4).map((check) => {
        if (!check || typeof check !== "object") throw new ApiError(400, "注意力校验格式不正确");
        return {
          id: cleanText(check.id, 20),
          itemKey: cleanText(check.itemKey, 40),
          expected: requireIntegerInRange(check.expected, 1, 5, "注意力校验期望值不正确"),
          response: requireIntegerInRange(check.response, 1, 5, "注意力校验作答值不正确"),
          passed: Boolean(check.passed)
        };
      })
    : [];

  return {
    valid,
    attentionPassed: Boolean(quality.attentionPassed),
    straightLining: Boolean(quality.straightLining),
    durationSeconds: Math.round(durationSeconds),
    flags,
    attentionChecks
  };
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
  const straightLineThreshold = Number(ASSESSMENT?.DATA_QUALITY?.straightLineStdDev || 0.38);
  const minimumSeconds = Number(ASSESSMENT?.DATA_QUALITY?.minimumSeconds || 75);
  const straightLining = personalityValues.length > 0 && stdDev < straightLineThreshold;
  const flags = [];
  if (!attentionPassed) flags.push("attention");
  if (straightLining) flags.push("straight_lining");
  if (durationSeconds < minimumSeconds) flags.push("too_fast");
  return {
    valid: flags.length === 0,
    attentionPassed,
    straightLining,
    durationSeconds,
    flags,
    attentionChecks
  };
}

function validateRecord(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(400, "样本格式不正确");
  }
  if (payload.schemaVersion !== 3) throw new ApiError(400, "不支持的样本版本");
  if (payload.consent !== true) throw new ApiError(400, "未获得匿名保存授权");

  const id = cleanText(payload.id, 100);
  if (!/^[A-Za-z0-9_-]{6,100}$/.test(id)) throw new ApiError(400, "样本 ID 不正确");

  const favorite = payload.actualFavorite;
  if (!favorite || typeof favorite !== "object") throw new ApiError(400, "缺少最喜欢的番");
  const favoriteTitle = cleanText(favorite.title, 80);
  if (!favoriteTitle) throw new ApiError(400, "最喜欢的番不能为空");
  const favoriteReason = cleanText(favorite.reason, 1000);
  const matchStatus = cleanText(favorite.matchStatus, 16);
  if (!MATCH_STATUSES.has(matchStatus)) throw new ApiError(400, "本命匹配状态不正确");

  const archetype = payload.archetype && typeof payload.archetype === "object"
    ? {
        key: cleanText(payload.archetype.key, 20),
        name: cleanText(payload.archetype.name, 80)
      }
    : { key: "", name: "" };
  if (!archetype.name) throw new ApiError(400, "缺少观看画像名称");

  const answers = validateAnswers(payload.answers);
  const submittedQuality = validateQuality(payload.quality);
  const quality = deriveQuality(answers, submittedQuality.durationSeconds);

  const createdAtCandidate = cleanText(payload.createdAt, 40);
  const createdAt = Number.isNaN(Date.parse(createdAtCandidate))
    ? new Date().toISOString()
    : new Date(createdAtCandidate).toISOString();
  const predictedRankRaw = favorite.predictedRank;
  const predictedRank = predictedRankRaw == null ? null : asNumberInRange(predictedRankRaw, 1, 200);
  const responseTimesMs = Array.isArray(payload.responseTimesMs)
    ? payload.responseTimesMs.slice(0, EXPECTED_QUESTION_COUNT).map((value) => {
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
      })
    : [];

  const submittedScores = validateScores(payload.scores);
  const derivedScores = deriveScores(answers);
  return {
    schemaVersion: 3,
    testVersion: cleanText(payload.testVersion, 20) || "unknown",
    algorithmVersion: cleanText(payload.algorithmVersion, 40) || "unknown",
    catalogVersion: cleanText(payload.catalogVersion, 40) || "unknown",
    id,
    createdAt,
    locale: cleanText(payload.locale, 20) || null,
    answers,
    scores: derivedScores || submittedScores,
    scenarioAnswers: deriveScenarioAnswers(answers),
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
    receivedAt: new Date().toISOString(),
    source: "web"
  };
}

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(RESPONSES_FILE)) {
    await fs.writeFile(RESPONSES_FILE, "", "utf8");
  }
  if (!existsSync(REACTIONS_FILE)) {
    await fs.writeFile(REACTIONS_FILE, "", "utf8");
  }
  const raw = await fs.readFile(RESPONSES_FILE, "utf8");
  knownIds = new Set();
  raw.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return;
    try {
      const record = JSON.parse(line);
      if (record && typeof record.id === "string") knownIds.add(record.id);
    } catch (error) {
      // Ignore malformed historical lines; exports will skip them too.
    }
  });
}

function appendRecord(record) {
  writeQueue = writeQueue.then(async () => {
    await fs.appendFile(RESPONSES_FILE, `${JSON.stringify(record)}\n`, "utf8");
    knownIds.add(record.id);
  });
  return writeQueue;
}

function appendReaction(reaction) {
  writeQueue = writeQueue.then(async () => {
    await fs.appendFile(REACTIONS_FILE, `${JSON.stringify(reaction)}\n`, "utf8");
  });
  return writeQueue;
}

async function readReactions(records) {
  await ensureDataFile();
  const raw = await fs.readFile(REACTIONS_FILE, "utf8");
  const reactions = [];
  raw.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return;
    try {
      const reaction = JSON.parse(line);
      if (reaction && typeof reaction === "object") reactions.push(reaction);
    } catch {
      // Skip malformed partial lines.
    }
  });
  return reactions;
}

async function readRecords() {
  await ensureDataFile();
  const raw = await fs.readFile(RESPONSES_FILE, "utf8");
  const records = [];
  raw.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return;
    try {
      const record = JSON.parse(line);
      if (record && typeof record === "object") records.push(record);
    } catch (error) {
      // A partial line can happen after an abrupt shutdown; skip it rather than fail all exports.
    }
  });
  return records;
}

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(RESPONSES_FILE)) {
    await fs.writeFile(RESPONSES_FILE, "", "utf8");
  }
  if (!existsSync(REACTIONS_FILE)) {
    await fs.writeFile(REACTIONS_FILE, "", "utf8");
  }
}

function csvEscape(value) {
  let text = String(value === undefined || value === null ? "" : value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function latestFeedbackByResponse(reactions) {
  const map = new Map();
  reactions.forEach((reaction) => {
    const key = `${reaction.responseId}:${reaction.animeId}`;
    const existing = map.get(key);
    if (!existing || String(reaction.receivedAt || "") >= String(existing.receivedAt || "")) {
      map.set(key, reaction);
    }
  });
  return map;
}

function joinFeedback(records, reactions) {
  const latest = latestFeedbackByResponse(reactions);
  return records.map((record) => {
    const feedback = (record.recommendations || [])
      .map((recommendation) => {
        const reaction = latest.get(`${record.id}:${recommendation.animeId}`);
        if (!reaction) return null;
        return {
          animeId: recommendation.animeId,
          reaction: reaction.reaction,
          at: reaction.createdAt,
          receivedAt: reaction.receivedAt
        };
      })
      .filter(Boolean);
    return { ...record, feedback };
  });
}

function feedbackValue(record, animeId) {
  const feedback = Array.isArray(record.feedback) ? record.feedback : [];
  const item = feedback.filter((entry) => entry.animeId === animeId).at(-1);
  return item ? item.reaction : "";
}

function recordsToCsv(records) {
  const headers = [
    "id",
    "created_at",
    "received_at",
    "valid",
    "quality_flags",
    "duration_seconds",
    "attention_passed",
    "archetype",
    "archetype_key",
    ...BIG_FIVE_KEYS.map((key) => `bigfive_${key}`),
    ...FEATURE_KEYS.map((key) => `pref_${key}`),
    ...HABIT_KEYS.map((key) => `habit_${key}`),
    "favorite_title",
    "favorite_reason",
    "favorite_match_status",
    "favorite_predicted_rank",
    "favorite_matched_anime",
    "rec1_anime_id",
    "rec1_title",
    "rec1_match",
    "rec1_reaction",
    "rec2_anime_id",
    "rec2_title",
    "rec2_match",
    "rec2_reaction",
    "rec3_anime_id",
    "rec3_title",
    "rec3_match",
    "rec3_reaction",
    "scenario_signals_json",
    "scenario_answers_json",
    "test_version",
    "algorithm_version",
    "catalog_version",
    "answers_json"
  ];

  const rows = records.map((record) => {
    const favorite = record.actualFavorite || {};
    const recommendations = [...(record.recommendations || [])].sort((a, b) => (a.rank || 0) - (b.rank || 0));
    const recFields = [];
    for (let index = 0; index < 3; index += 1) {
      const recommendation = recommendations[index] || {};
      recFields.push(
        recommendation.animeId || "",
        recommendation.title || "",
        recommendation.matchPercent ?? "",
        recommendation.animeId ? feedbackValue(record, recommendation.animeId) : ""
      );
    }
    return [
      record.id,
      record.createdAt,
      record.receivedAt,
      record.quality?.valid,
      (record.quality?.flags || []).join("|"),
      record.quality?.durationSeconds,
      record.quality?.attentionPassed,
      record.archetype?.name,
      record.archetype?.key,
      ...BIG_FIVE_KEYS.map((key) => record.scores?.bigFive?.[key] ?? ""),
      ...FEATURE_KEYS.map((key) => record.scores?.preferences?.[key] ?? ""),
      ...HABIT_KEYS.map((key) => record.scores?.habits?.[key] ?? ""),
      favorite.title,
      favorite.reason,
      favorite.matchStatus,
      favorite.predictedRank,
      favorite.matchedAnimeTitle,
      ...recFields,
      JSON.stringify(record.scores?.scenarioSignals || {}),
      JSON.stringify(record.scenarioAnswers || []),
      record.testVersion,
      record.algorithmVersion,
      record.catalogVersion,
      JSON.stringify(record.answers || [])
    ].map(csvEscape).join(",");
  });

  return `\uFEFF${headers.map(csvEscape).join(",")}\r\n${rows.join("\r\n")}`;
}

function validateReaction(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(400, "反馈格式不正确");
  }
  if (payload.schemaVersion !== 3) throw new ApiError(400, "不支持的反馈版本");
  const responseId = cleanText(payload.responseId, 100);
  if (!/^[A-Za-z0-9_-]{6,100}$/.test(responseId)) throw new ApiError(400, "反馈对应的样本 ID 不正确");
  if (!knownIds.has(responseId)) throw new ApiError(404, "找不到对应的匿名样本");
  const animeId = cleanText(payload.animeId, 100);
  if (!animeId) throw new ApiError(400, "缺少番剧标识");
  const reaction = cleanText(payload.reaction, 20);
  if (!REACTION_VALUES.has(reaction)) throw new ApiError(400, "反馈选项不正确");
  const createdAtCandidate = cleanText(payload.createdAt, 40);
  const createdAt = Number.isNaN(Date.parse(createdAtCandidate))
    ? new Date().toISOString()
    : new Date(createdAtCandidate).toISOString();
  return {
    schemaVersion: 3,
    responseId,
    animeId,
    reaction,
    createdAt,
    receivedAt: new Date().toISOString()
  };
}
function summarize(records) {
  const validRecords = records.filter((record) => record.quality?.valid === true);
  const total = validRecords.length;
  const rawTotal = records.length;
  const withReason = validRecords.filter((record) => {
    return record.actualFavorite && String(record.actualFavorite.reason || "").trim();
  }).length;
  const top1Hits = validRecords.filter((record) => {
    return record.actualFavorite && record.actualFavorite.matchStatus === "top1";
  }).length;
  const top3Hits = validRecords.filter((record) => {
    const status = record.actualFavorite && record.actualFavorite.matchStatus;
    return status === "top1" || status === "top3";
  }).length;
  const lastReceivedAt = rawTotal
    ? records.reduce((latest, record) => {
        const candidate = record.receivedAt || record.createdAt || "";
        return candidate > latest ? candidate : latest;
      }, "")
    : null;

  return {
    total,
    valid: total,
    flagged: rawTotal - total,
    rawTotal,
    withReason,
    top1Hits,
    top3Hits,
    hitRate: total ? Math.round((top3Hits / total) * 100) : null,
    lastReceivedAt
  };
}

async function serveStatic(req, res, pathname) {
  const coverMatch = pathname.match(/^\/assets\/covers\/([A-Za-z0-9_-]+)\.(jpg|jpeg|png|webp)$/);
  if (coverMatch) {
    const filePath = path.join(ROOT, "assets", "covers", `${coverMatch[1]}.${coverMatch[2]}`);
    const contentType = coverMatch[2] === "png"
      ? "image/png"
      : coverMatch[2] === "webp"
        ? "image/webp"
        : "image/jpeg";
    try {
      const stat = await fs.stat(filePath);
      setHeaders(res, {
        "Content-Type": contentType,
        "Content-Length": stat.size,
        "Cache-Control": "public, max-age=604800"
      });
      res.writeHead(200);
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(filePath).pipe(res);
    } catch {
      sendText(res, 404, "Not found");
    }
    return;
  }

  const entry = STATIC_FILES.get(pathname);
  if (!entry) {
    sendText(res, 404, "Not found");
    return;
  }
  const filePath = path.join(ROOT, entry.file);
  try {
    const stat = await fs.stat(filePath);
    setHeaders(res, {
      "Content-Type": entry.type,
      "Content-Length": stat.size,
      "Cache-Control": "no-cache"
    });
    res.writeHead(200);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  } catch (error) {
    sendText(res, 404, "Not found");
  }
}

async function handleRequest(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname === "/api/health") {
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      service: "anime-soul-lab",
      storage: "local-file",
      adminAuth: Boolean(process.env.ADMIN_TOKEN),
      time: new Date().toISOString()
    });
    return;
  }

  if (pathname === "/api/responses") {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }
    const contentType = String(req.headers["content-type"] || "");
    if (!contentType.includes("application/json")) {
      sendJson(res, 415, { ok: false, error: "Content-Type must be application/json" });
      return;
    }
    const ip = req.socket.remoteAddress || "local";
    if (!allowPost(ip)) {
      sendJson(res, 429, { ok: false, error: "请求过于频繁，请稍后再试" });
      return;
    }

    const payload = await readJsonBody(req);
    const record = validateRecord(payload);
    if (knownIds.has(record.id)) {
      sendJson(res, 200, { ok: true, id: record.id, duplicate: true, receivedAt: record.receivedAt });
      return;
    }
    await appendRecord(record);
    sendJson(res, 201, { ok: true, id: record.id, receivedAt: record.receivedAt });
    return;
  }

  if (pathname === "/api/reactions") {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }
    const contentType = String(req.headers["content-type"] || "");
    if (!contentType.includes("application/json")) {
      sendJson(res, 415, { ok: false, error: "Content-Type must be application/json" });
      return;
    }
    const ip = req.socket.remoteAddress || "local";
    if (!allowPost(ip)) {
      sendJson(res, 429, { ok: false, error: "请求过于频繁，请稍后再试" });
      return;
    }
    const payload = await readJsonBody(req);
    const reaction = validateReaction(payload);
    await appendReaction(reaction);
    sendJson(res, 201, { ok: true, receivedAt: reaction.receivedAt });
    return;
  }

  if (pathname === "/api/stats") {
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }
    const records = await readRecords();
    sendJson(res, 200, { ok: true, ...summarize(records) });
    return;
  }

  if (pathname === "/api/export") {
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }
    if (!isExportAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: "需要管理员密钥才能导出原始样本" });
      return;
    }
    const format = requestUrl.searchParams.get("format") || "jsonl";
    if (!["json", "jsonl", "csv"].includes(format)) {
      sendJson(res, 400, { ok: false, error: "Unsupported export format" });
      return;
    }
    const records = await readRecords();
    const reactions = await readReactions(records);
    const joined = joinFeedback(records, reactions);
    const stamp = new Date().toISOString().slice(0, 10);
    let body;
    let contentType;
    let extension = format;

    if (format === "csv") {
      body = recordsToCsv(joined);
      contentType = "text/csv; charset=utf-8";
    } else if (format === "json") {
      body = JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          schemaVersion: 3,
          count: joined.length,
          responses: joined,
          reactions
        },
        null,
        2
      );
      contentType = "application/json; charset=utf-8";
    } else {
      body = joined.map((record) => JSON.stringify(record)).join("\n");
      if (body) body += "\n";
      contentType = "application/x-ndjson; charset=utf-8";
      extension = "jsonl";
    }

    setHeaders(res, {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="anime-soul-samples-${stamp}.${extension}"`,
      "Cache-Control": "no-store"
    });
    res.writeHead(200);
    res.end(body);
    return;
  }

  if (pathname.startsWith("/api/")) {
    sendJson(res, 404, { ok: false, error: "API not found" });
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method not allowed");
    return;
  }

  await serveStatic(req, res, pathname);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof ApiError ? error.message : "Internal server error";
    if (!(error instanceof ApiError)) console.error(error);
    if (!res.headersSent) sendJson(res, status, { ok: false, error: message });
    else res.end();
  });
});

async function start() {
  await ensureStore();
  server.listen(PORT, HOST, () => {
    console.log(`本命番推荐所 running at http://${HOST}:${PORT}`);
    console.log(`Anonymous samples: ${RESPONSES_FILE}`);
  });
}

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
