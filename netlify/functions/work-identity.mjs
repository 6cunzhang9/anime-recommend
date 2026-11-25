import v4 from "../../v4-validation.js";
import { getResponsesStore, errorResponse, jsonResponse } from "../shared/store.mjs";
import { readJson } from "../shared/auth.mjs";

const MAX_BODY_BYTES = 12_000;

export const config = {
  path: "/api/work-identity",
  method: "POST",
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 60 }
};

/**
 * 用户在搜索中明确选择、加入清单、设为本命或发布观察时，
 * 只保存作品身份与外部召回标签。外部标签不进入详情、不进匹配分。
 */
export default async function handler(req) {
  try {
    const payload = await readJson(req, MAX_BODY_BYTES);
    const ref = v4.validateExternalRef(payload.work, true);
    if (ref.provider === "manual" || !ref.provider_id) return errorResponse(400, "需要可识别的作品来源");
    const recallTags = Array.isArray(payload.recall_tags)
      ? [...new Set(payload.recall_tags.filter((tag) => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean))].slice(0, 24)
      : [];
    const key = `work-index/${v4.workIdentity(ref)}.json`;
    const store = getResponsesStore();
    const previous = await store.get(key, { type: "json" });
    const record = {
      work: { ...previous?.work, ...ref, aliases: [...new Set([...(previous?.work?.aliases || []), ...(ref.aliases || [])])] },
      recall_tags: [...new Set([...(previous?.recall_tags || []), ...recallTags])].slice(0, 32),
      created: previous?.created || new Date().toISOString(),
      updated: new Date().toISOString()
    };
    await store.setJSON(key, record);
    return jsonResponse({ ok: true, stored: true });
  } catch (error) {
    console.error("Work identity:", error);
    return errorResponse(400, error.message || "作品身份保存失败");
  }
}
