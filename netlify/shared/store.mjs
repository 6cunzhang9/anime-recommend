import { createHash, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import v4 from "../../v4-validation.js";

const STORE_NAME = process.env.BLOBS_STORE_NAME || "anime-soul-responses";
const STORE_REGION = process.env.BLOBS_REGION || "ap-southeast-1";
const KEY_PREFIX = "responses/";
const REACTION_PREFIX = "reactions/";
const RATING_PREFIX = "ratings/";

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

export function responseKey(id) {
  return `${KEY_PREFIX}${id}.json`;
}

export async function getRecord(id) {
  const store = getResponsesStore();
  return store.get(responseKey(id), { type: "json", consistency: "strong" });
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

export function reactionKey(responseId, animeId) {
  return `${REACTION_PREFIX}${responseId}/${animeId}.json`;
}

export function ratingKey(id) {
  return `${RATING_PREFIX}${id}.json`;
}

export async function readAllRatings() {
  const store = getResponsesStore();
  const { blobs } = await store.list({ prefix: RATING_PREFIX });
  const ratings = [];
  const batchSize = 25;
  for (let index = 0; index < blobs.length; index += batchSize) {
    const batch = blobs.slice(index, index + batchSize);
    const values = await Promise.all(
      batch.map((blob) => store.get(blob.key, { type: "json", consistency: "strong" }))
    );
    values.forEach((rating) => {
      if (rating && typeof rating === "object") ratings.push(rating);
    });
  }
  return ratings;
}

export async function readAllReactions() {
  const store = getResponsesStore();
  const { blobs } = await store.list({ prefix: REACTION_PREFIX });
  const reactions = [];
  const batchSize = 25;

  for (let index = 0; index < blobs.length; index += batchSize) {
    const batch = blobs.slice(index, index + batchSize);
    const values = await Promise.all(
      batch.map((blob) => store.get(blob.key, { type: "json", consistency: "strong" }))
    );
    values.forEach((reaction) => {
      if (reaction && typeof reaction === "object") reactions.push(reaction);
    });
  }

  return reactions;
}

export function recordsToCsv(records, reactions = []) {
  return v4.flattenForCsv(records, reactions);
}
