import { createHash, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const STORE_NAME = process.env.BLOBS_STORE_NAME || "anime-soul-responses";
const STORE_REGION = process.env.BLOBS_REGION || "ap-southeast-1";
const KEY_PREFIX = "responses/";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-store"
};

export function getResponsesStore() {
  return getStore({
    name: STORE_NAME,
    consistency: "strong",
    region: STORE_REGION
  });
}

export function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}

export function errorResponse(status, message) {
  return jsonResponse({ ok: false, error: message }, status);
}

export function responseKey(id) {
  return `${KEY_PREFIX}${id}.json`;
}

export async function readAllRecords() {
  const store = getResponsesStore();
  const { blobs } = await store.list({ prefix: KEY_PREFIX });
  const records = [];
  const batchSize = 20;

  for (let index = 0; index < blobs.length; index += batchSize) {
    const batch = blobs.slice(index, index + batchSize);
    const values = await Promise.all(
      batch.map((blob) => store.get(blob.key, { type: "json", consistency: "strong" }))
    );
    values.forEach((record) => {
      if (record && typeof record === "object") records.push(record);
    });
  }

  return records.sort((a, b) => String(a.receivedAt || "").localeCompare(String(b.receivedAt || "")));
}

export function summarize(records) {
  const validRecords = records.filter((record) => record.quality?.valid === true);
  const total = validRecords.length;
  const rawTotal = records.length;
  const withReason = validRecords.filter((record) => String(record.actualFavorite?.reason || "").trim()).length;
  const top1Hits = validRecords.filter((record) => record.actualFavorite?.matchStatus === "top1").length;
  const top3Hits = validRecords.filter((record) => {
    const status = record.actualFavorite?.matchStatus;
    return status === "top1" || status === "top3";
  }).length;
  const lastReceivedAt = records.length
    ? records[records.length - 1].receivedAt || records[records.length - 1].createdAt || null
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

export function checkAdmin(req) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return { ok: false, status: 503, message: "服务端尚未配置 ADMIN_TOKEN，已停止导出原始数据" };
  }
  const authorization = req.headers.get("authorization") || "";
  const headerToken = req.headers.get("x-admin-token") || "";
  const supplied = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : headerToken.trim();

  if (!supplied) {
    return { ok: false, status: 401, message: "需要管理员密钥才能导出原始样本" };
  }

  const expectedDigest = createHash("sha256").update(expected).digest();
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  if (!timingSafeEqual(expectedDigest, suppliedDigest)) {
    return { ok: false, status: 403, message: "管理员密钥不正确" };
  }
  return { ok: true };
}

function csvEscape(value) {
  let text = String(value === undefined || value === null ? "" : value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function recordsToCsv(records) {
  const headers = [
    "receivedAt",
    "createdAt",
    "id",
    "valid",
    "archetype",
    "bigFive",
    "favoriteTitle",
    "favoriteReason",
    "matchStatus",
    "predictedRank",
    "matchedAnime",
    "recommendations",
    "preferences",
    "habits",
    "durationSeconds",
    "qualityFlags",
    "answersJson",
    "scoresJson",
    "testVersion",
    "algorithmVersion",
    "catalogVersion"
  ];

  const rows = records.map((record) => {
    const favorite = record.actualFavorite || {};
    return [
      record.receivedAt,
      record.createdAt,
      record.id,
      record.quality?.valid,
      record.archetype?.name,
      ["O", "C", "E", "A", "N"].map((key) => `${key}:${record.scores?.bigFive?.[key] ?? ""}`).join("/"),
      favorite.title,
      favorite.reason,
      favorite.matchStatus,
      favorite.predictedRank,
      favorite.matchedAnimeTitle,
      (record.recommendations || []).map((item) => `${item.rank}:${item.title}`).join(" | "),
      JSON.stringify(record.scores?.preferences || {}),
      JSON.stringify(record.scores?.habits || {}),
      record.quality?.durationSeconds,
      (record.quality?.flags || []).join("|"),
      JSON.stringify(record.answers || []),
      JSON.stringify(record.scores || {}),
      record.testVersion,
      record.algorithmVersion,
      record.catalogVersion
    ].map(csvEscape).join(",");
  });

  return `\uFEFF${headers.map(csvEscape).join(",")}\r\n${rows.join("\r\n")}`;
}
