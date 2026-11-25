"use strict";

const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { createReadStream } = require("node:fs");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const routes = new Map();
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || "127.0.0.1";

// 本地服务器只暴露站点实际使用的静态文件；新增公共脚本时必须同步
// scripts/build-netlify.mjs，否则线上构建会漏文件。
const STATIC_FILES = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
  ["/taste-analysis.js", { file: "taste-analysis.js", type: "text/javascript; charset=utf-8" }],
  ["/features.js", { file: "features.js", type: "text/javascript; charset=utf-8" }],
  ["/series-data.js", { file: "series-data.js", type: "text/javascript; charset=utf-8" }],
  ["/watch-model.js", { file: "watch-model.js", type: "text/javascript; charset=utf-8" }],
  ["/photo-search.js", { file: "photo-search.js", type: "text/javascript; charset=utf-8" }],
  ["/experience.js", { file: "experience.js", type: "text/javascript; charset=utf-8" }],
  ["/select-menu.js", { file: "select-menu.js", type: "text/javascript; charset=utf-8" }],
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
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://s4.anilist.co https://lain.bgm.tv; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};

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

async function seedLocalTestAccount() {
  if (!process.env.ANIME_LOCAL_STORE || process.env.NETLIFY === "true" ||
      process.env.LOCAL_TEST_ACCOUNT_DISABLED === "1") return;
  const username = (process.env.LOCAL_TEST_ACCOUNT_USER || "localtester").trim().toLowerCase();
  const password = process.env.LOCAL_TEST_ACCOUNT_PASSWORD || "LocalOnly-2026!";
  if (!/^[a-z0-9_]{3,32}$/.test(username) || password.length < 10) {
    console.warn("Local test account skipped: username/password does not meet account rules.");
    return;
  }
  try {
    const { getResponsesStore } = await import("./netlify/shared/store.mjs");
    const store = getResponsesStore();
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = await new Promise((resolve, reject) => {
      crypto.scrypt(password, salt, 64, (error, derived) => error ? reject(error) : resolve(derived.toString("hex")));
    });
    const id = crypto.createHash("sha256").update(`anime-soul-local-test:${username}`).digest("hex").slice(0, 32);
    await store.setJSON(`accounts/${username}.json`, { id, username, salt, hash });
    console.log(`Local test account ready: ${username} / ${password}`);
  } catch (error) {
    console.warn("Local test account could not be created:", error.message);
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
  const route = routes.get(pathname);
  if (route) {
    if (route.methods && !route.methods.includes(req.method)) {
      sendJson(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, value);
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : req;
    const response = await route.handler(new Request(requestUrl, { method: req.method, headers, body, duplex: "half" }));
    setHeaders(res, Object.fromEntries(response.headers));
    res.statusCode = response.status;
    res.end(Buffer.from(await response.arrayBuffer()));
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
      : 500;
    const message = status < 500 ? error.message : "Internal server error";
    if (status >= 500) console.error(error);
    if (!res.headersSent) sendJson(res, status, { ok: false, error: message });
    else res.end();
  });
});

async function start() {
  if (!process.env.ANIME_LOCAL_STORE) {
    process.env.ANIME_LOCAL_STORE = path.join(DATA_DIR, "site-blobs.json");
    process.env.ANIME_LOCAL_LEGACY = "1";
  }
  await seedLocalTestAccount();
  const names = await fs.readdir(path.join(ROOT, "netlify", "functions"));
  for (const name of names.filter((name) => name.endsWith(".mjs"))) {
    const mod = await import(`./netlify/functions/${name}`);
    routes.set(mod.config.path, { handler: mod.default, methods: [mod.config.method || "GET"].flat() });
  }
  server.listen(PORT, HOST, () => {
    console.log(`本命番推荐所 running at http://${HOST}:${PORT}`);
    console.log(`Local data: ${process.env.ANIME_LOCAL_STORE}`);
  });
}

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
