import { createHash, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import v4 from "../../v4-validation.js";
import { localStore } from "./local-store.mjs";
import { unpackRecord } from "./records.mjs";

const STORE_NAME = process.env.BLOBS_STORE_NAME || "anime-soul-responses";
const STORE_REGION = process.env.BLOBS_REGION || "ap-southeast-1";
const KEY_PREFIX = "responses/";
const REACTION_PREFIX = "reactions/";
const RATING_PREFIX = "ratings/";
const FORUM_PREFIX = "forum/";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-store"
};

export function getResponsesStore() {
  if (process.env.ANIME_LOCAL_STORE) return localStore;
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

function scope(prefix, owner) {
  return owner ? `${prefix}${owner}/` : prefix;
}

export function responseKey(id, owner) {
  return `${scope(KEY_PREFIX, owner)}${id}.json`;
}

export async function getRecord(id, owner) {
  return unpackRecord(await getResponsesStore().get(responseKey(id, owner), { type: "json" }));
}

async function readEntries(prefix, owner, { publicOnly = false } = {}) {
  const store = getResponsesStore();
  const listing = await store.list({ prefix: scope(prefix, owner) });
  const blobs = publicOnly
    ? listing.blobs.filter(({ key }) => key.slice(prefix.length).includes("/"))
    : listing.blobs;
  const records = [];
  const batchSize = 50;
  for (let index = 0; index < blobs.length; index += batchSize) {
    const batch = blobs.slice(index, index + batchSize);
    const values = await Promise.all(batch.map(async ({ key }) => {
      const record = unpackRecord(await store.get(key, { type: "json" }));
      if (!record || typeof record !== "object") return null;
      const parts = key.slice(prefix.length).split("/");
      const depth = prefix === REACTION_PREFIX ? 3 : 2;
      if (parts.length === depth && /^[a-f0-9]{32}$/.test(parts[0])) {
        Object.defineProperty(record, "accountOwner", { value: parts[0] });
      }
      return record;
    }));
    records.push(...values.filter(Boolean));
  }
  return records;
}

export async function readAllRecords(owner, options) {
  const records = await readEntries(KEY_PREFIX, owner, options);
  return records.sort((a, b) => String(a.submitted_at || a.receivedAt || "").localeCompare(String(b.submitted_at || b.receivedAt || "")));
}

export async function deleteResponse(id, owner) {
  const store = getResponsesStore();
  await store.delete(responseKey(id, owner));
  const { blobs } = await store.list({ prefix: `${scope(REACTION_PREFIX, owner)}${id}/` });
  await Promise.all(blobs.map(({ key }) => store.delete(key)));
}

export function reactionKey(responseId, animeId, owner) {
  return `${scope(REACTION_PREFIX, owner)}${responseId}/${encodeURIComponent(animeId)}.json`;
}

export function ratingKey(id, owner) {
  return `${scope(RATING_PREFIX, owner)}${id}.json`;
}

export function readAllRatings(owner, options) {
  return readEntries(RATING_PREFIX, owner, options);
}

export function forumKey(id, owner) {
  return `${scope(FORUM_PREFIX, owner)}${id}.json`;
}

export function readForum(owner) {
  return readEntries(FORUM_PREFIX, owner);
}

export function readAllReactions(owner) {
  return readEntries(REACTION_PREFIX, owner);
}

export function recordsToCsv(records, reactions = []) {
  return v4.flattenForCsv(records, reactions);
}
