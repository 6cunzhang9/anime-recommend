import v4 from "../../v4-validation.js";
import { errorResponse, jsonResponse, readAllRatings, readAllRecords } from "../shared/store.mjs";

const MAX_BODY_BYTES = 8 * 1024;

export const config = {
  path: "/api/community",
  method: "POST",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: "ip",
    windowSize: 60,
    windowLimit: 20
  }
};

export default async function handler(req) {
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return errorResponse(413, "请求内容过长");
    }
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      return errorResponse(400, "请求内容不是合法的 JSON");
    }
    const records = await readAllRecords();
    const ratings = await readAllRatings();
    const community = v4.buildCommunity(records, ratings, payload);
    return jsonResponse({ ok: true, ...community });
  } catch (error) {
    console.error("community function failed:", error);
    return errorResponse(500, "读取社区聚合失败");
  }
}
