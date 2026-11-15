import v4 from "../../v4-validation.js";
import { errorResponse, jsonResponse, readAllRecords } from "../shared/store.mjs";

export const config = {
  path: "/api/stats",
  method: "GET",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: "ip",
    windowSize: 60,
    windowLimit: 30
  }
};

export default async function handler() {
  try {
    const records = await readAllRecords();
    return jsonResponse({ ok: true, ...v4.summarize(records) });
  } catch (error) {
    console.error("stats function failed:", error);
    return errorResponse(500, "读取统计数据失败");
  }
}
