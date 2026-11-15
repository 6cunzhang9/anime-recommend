import { createHash } from "node:crypto";
import v4 from "../../v4-validation.js";
import { getUser, keyPart, readJson, RequestError } from "../shared/auth.mjs";
import { cursorPattern, pagePosts, readPostRecords } from "../shared/posts.mjs";
import { changeEntry, packQuestionnaire, packRating, publicationFor } from "../shared/records.mjs";
import { errorResponse, getRecord, getResponsesStore, jsonResponse, ratingKey, readAllRecords, responseKey } from "../shared/store.mjs";

export const config = {
  path: "/api/admin",
  method: ["GET", "POST"],
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 30 }
};

const isOwner = (owner) => typeof owner === "string" && /^[a-f0-9]{32}$/.test(owner);

function resultRows(records, cursor, query) {
  const rows = records.filter((record) => keyPart.test(record.response_id || "")).map((record) => {
    const date = record.submitted_at || record.received_at;
    const owner = record.accountOwner || "";
    const hash = createHash("sha256").update(`${owner}:${record.response_id}`).digest("hex");
    const titles = (record.actual_favorites || []).map((favorite) => favorite.external_ref?.title_display || favorite.title_raw);
    return {
      id: record.response_id, owner, date, titles, recommendationCount: record.recommendation_snapshot?.top?.length || 0,
      sortKey: `${date}/${hash}`
    };
  }).filter((row) => (!cursor || row.sortKey < cursor) &&
    (!query || row.titles.some((title) => v4.normalizeWorkTitle(title).includes(query))))
    .sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  return {
    results: rows.slice(0, 20).map(({ sortKey, ...row }) => row),
    next: rows.length > 20 ? rows[19].sortKey : null
  };
}

export default async function handler(req) {
  try {
    const user = await getUser(req);
    if (!user) return errorResponse(401, "请使用管理员账号登录");
    if (user.role !== "admin") return errorResponse(403, "需要管理员权限");

    if (req.method === "POST") {
      const { owner, id, type, moderated } = await readJson(req, 2048);
      if (!isOwner(owner) || typeof id !== "string" || !keyPart.test(id) ||
        !["favorite", "review"].includes(type) || typeof moderated !== "boolean") {
        return errorResponse(400, "发言操作无效");
      }
      const favorite = type === "favorite";
      const key = favorite ? responseKey(id, owner) : ratingKey(id, owner);
      const pack = favorite ? packQuestionnaire : packRating;
      const result = await changeEntry(getResponsesStore(), key, (record) => {
        const publication = record && publicationFor(record);
        if (!publication) return null;
        return pack({ ...record, publication: { ...publication, moderated, moderated_at: new Date().toISOString() } });
      });
      if (result.conflict) return errorResponse(409, "发言已变更，请重试");
      if (!result.modified) return errorResponse(404, "未找到对应发言");
      return jsonResponse({ ok: true, moderated });
    }

    const params = new URL(req.url).searchParams;
    const id = params.get("id");
    if (id) {
      const owner = params.get("owner") || "";
      if (!keyPart.test(id) || (owner && !isOwner(owner))) return errorResponse(400, "测评编号无效");
      const record = await getRecord(id, owner);
      if (!record) return errorResponse(404, "未找到测评");
      return jsonResponse({ ok: true, record });
    }
    const cursor = params.get("before") || "";
    if (cursor && !cursorPattern.test(cursor)) return errorResponse(400, "分页标记无效");
    const query = v4.normalizeWorkTitle(params.get("q")?.slice(0, 120));
    if (params.get("view") === "posts") {
      const type = ["review", "favorite"].includes(params.get("type")) ? params.get("type") : "";
      return jsonResponse({ ok: true, ...pagePosts(await readPostRecords(type), { query, cursor, type, admin: true }) });
    }
    const records = await readAllRecords();
    return jsonResponse({ ok: true, summary: v4.summarize(records), ...resultRows(records, cursor, query) });
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(error.status, error.message);
    console.error("admin function failed:", error);
    return errorResponse(500, "管理员数据读取失败");
  }
}
