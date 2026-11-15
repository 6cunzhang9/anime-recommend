"use strict";

const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { createReadStream, existsSync } = require("node:fs");
const V4 = require("./v4-validation.js");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const RESPONSES_FILE = path.join(DATA_DIR, "responses.jsonl");
const REACTIONS_FILE = path.join(DATA_DIR, "reactions.jsonl");
const RATINGS_FILE = path.join(DATA_DIR, "ratings.jsonl");
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

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(RESPONSES_FILE)) {
    await fs.writeFile(RESPONSES_FILE, "", "utf8");
  }
  if (!existsSync(REACTIONS_FILE)) {
    await fs.writeFile(REACTIONS_FILE, "", "utf8");
  }
  if (!existsSync(RATINGS_FILE)) {
    await fs.writeFile(RATINGS_FILE, "", "utf8");
  }
  const raw = await fs.readFile(RESPONSES_FILE, "utf8");
  knownIds = new Set();
  raw.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return;
    try {
      const record = JSON.parse(line);
      const id = record?.response_id || record?.id;
      if (typeof id === "string") knownIds.add(id);
    } catch (error) {
      // Ignore malformed historical lines; exports will skip them too.
    }
  });
}

function appendRecord(record) {
  writeQueue = writeQueue.then(async () => {
    await fs.appendFile(RESPONSES_FILE, `${JSON.stringify(record)}\n`, "utf8");
    knownIds.add(record.response_id || record.id);
  });
  return writeQueue;
}

function appendReaction(reaction) {
  writeQueue = writeQueue.then(async () => {
    await fs.appendFile(REACTIONS_FILE, `${JSON.stringify(reaction)}\n`, "utf8");
  });
  return writeQueue;
}

function appendRating(rating) {
  writeQueue = writeQueue.then(async () => {
    await fs.appendFile(RATINGS_FILE, `${JSON.stringify(rating)}\n`, "utf8");
  });
  return writeQueue;
}

async function readRatings() {
  await ensureDataFile();
  const raw = await fs.readFile(RATINGS_FILE, "utf8");
  const byId = new Map();
  raw.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return;
    try {
      const rating = JSON.parse(line);
      if (rating && typeof rating === "object") {
        byId.set(rating.id || `${rating.received_at}:${byId.size}`, rating);
      }
    } catch {
      // Skip malformed lines.
    }
  });
  return [...byId.values()];
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
  if (!existsSync(RATINGS_FILE)) {
    await fs.writeFile(RATINGS_FILE, "", "utf8");
  }
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
      questionnaireVersion: "4.0.0",
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
    const record = V4.validateQuestionnaire(payload);
    if (knownIds.has(record.response_id)) {
      sendJson(res, 200, { ok: true, id: record.response_id, duplicate: true, receivedAt: record.received_at });
      return;
    }
    await appendRecord(record);
    sendJson(res, 201, { ok: true, id: record.response_id, receivedAt: record.received_at });
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
    const reaction = V4.validateFeedback(payload);
    if (!knownIds.has(reaction.responseId)) {
      sendJson(res, 404, { ok: false, error: "找不到对应的匿名问卷" });
      return;
    }
    await appendReaction(reaction);
    sendJson(res, 201, { ok: true, receivedAt: reaction.receivedAt });
    return;
  }

  if (pathname === "/api/ratings") {
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
    const rating = V4.validateRating(payload);
    await appendRating(rating);
    sendJson(res, 201, { ok: true, id: rating.id, receivedAt: rating.received_at });
    return;
  }

  if (pathname === "/api/community") {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }
    const payload = await readJsonBody(req);
    const records = await readRecords();
    const ratings = await readRatings();
    const community = V4.buildCommunity(records, ratings, payload);
    sendJson(res, 200, { ok: true, ...community });
    return;
  }

  if (pathname === "/api/stats") {
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }
    const records = await readRecords();
    sendJson(res, 200, { ok: true, ...V4.summarize(records) });
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
    const ratings = await readRatings();
    const v4Records = records.filter((record) => Number(record.schemaVersion) === 4);
    const legacyRecords = records.filter((record) => Number(record.schemaVersion) !== 4);
    const stamp = new Date().toISOString().slice(0, 10);
    let body;
    let contentType;
    let extension = format;

    if (format === "csv") {
      body = V4.flattenForCsv(records, reactions);
      contentType = "text/csv; charset=utf-8";
    } else if (format === "json") {
      body = JSON.stringify({
        exported_at: new Date().toISOString(),
        schema_version: 4,
        questionnaires: v4Records,
        legacy_questionnaires: legacyRecords,
        reactions,
        ratings
      }, null, 2);
      contentType = "application/json; charset=utf-8";
    } else {
      body = records.map((record) => JSON.stringify(record)).join("\n");
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
    const status = Number(error?.status) >= 400 && Number(error?.status) < 500
      ? Number(error.status)
      : (error instanceof ApiError ? error.status : 500);
    const message = status < 500 ? error.message : "Internal server error";
    if (status >= 500) console.error(error);
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
