import { checkAdmin } from "../shared/store.mjs";
import { errorResponse, getResponsesStore, jsonResponse } from "../shared/store.mjs";
import { readJson } from "../shared/auth.mjs";

const RATING_KEY = /^ratings\/[a-f0-9]{32}\/[a-f0-9]{64}\.json$/;
const OBSERVATION_KEY = /^observations\/[a-f0-9-]{36}\.json$/;
const MAX_RECORDS = 100;

export const config = {
  path: "/api/ghost-import",
  method: "POST",
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 30 }
};

/**
 * Admin-only one-time importer for ghost seed records.
 * Runs inside Netlify, so it uses the site's normal Blobs environment instead
 * of asking a local script for siteID/token. Only ghost rating/observation
 * keys are accepted; user records can never be overwritten through this route.
 */
export default async function handler(req) {
  const auth = checkAdmin(req);
  if (!auth.ok) return errorResponse(auth.status, auth.message);
  try {
    const payload = await readJson(req, 2_500_000);
    if (!Array.isArray(payload.records) || !payload.records.length || payload.records.length > MAX_RECORDS) {
      return errorResponse(400, `每次导入 1–${MAX_RECORDS} 条记录`);
    }
    const store = getResponsesStore();
    for (const row of payload.records) {
      const key = String(row?.key || "");
      const value = row?.value;
      if (!value || typeof value !== "object" || !RATING_KEY.test(key) && !OBSERVATION_KEY.test(key)) {
        return errorResponse(400, "只接受幽灵评分或幽灵作品观察记录");
      }
      if (value.ghost !== true) return errorResponse(400, "拒绝导入非幽灵记录");
    }
    let added = 0;
    let skipped = 0;
    for (let index = 0; index < payload.records.length; index += 10) {
      const results = await Promise.all(payload.records.slice(index, index + 10).map((row) =>
        store.setJSON(String(row.key), row.value, { onlyIfNew: true })));
      for (const result of results) {
        if (result.modified) added += 1;
        else skipped += 1;
      }
    }
    return jsonResponse({ ok: true, added, skipped, received: payload.records.length });
  } catch (error) {
    console.error("Ghost import failed:", error);
    return errorResponse(500, error.message || "幽灵数据导入失败");
  }
}
