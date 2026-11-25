import { randomUUID } from "node:crypto";
import { getUser, readJson, RequestError } from "../shared/auth.mjs";
import { changeEntry } from "../shared/records.mjs";
import { errorResponse, getResponsesStore, jsonResponse } from "../shared/store.mjs";

export const config = {
  path: "/api/site-feedback", method: ["GET", "POST"],
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 16 }
};

export const feedbackKinds = { bug: "功能问题", data: "番剧资料", idea: "功能建议", other: "其他" };
const prefix = "site-feedback/";

export async function readSiteFeedback(store = getResponsesStore()) {
  const { blobs } = await store.list({ prefix });
  const items = [];
  for (let i = 0; i < blobs.length; i += 24) {
    const rows = await Promise.all(blobs.slice(i, i + 24).map(({ key }) => store.get(key, { type: "json" })));
    items.push(...rows.filter(Boolean));
  }
  return items.sort((a, b) => b.created.localeCompare(a.created));
}

export default async function handler(req) {
  try {
    const user = await getUser(req);
    const store = getResponsesStore();
    if (req.method === "GET") {
      if (user?.role !== "admin") return errorResponse(403, "需要管理员权限");
      const params = new URL(req.url).searchParams;
      const items = await readSiteFeedback(store);
      const chosen = items.filter((item) => (!params.get("state") || item.state === params.get("state")) &&
        (!params.get("kind") || item.kind === params.get("kind")));
      const page = Math.max(0, Math.floor(Number(params.get("page")) || 0));
      const summary = Object.fromEntries(Object.keys(feedbackKinds).map((kind) => [kind, items.filter((item) => item.kind === kind).length]));
      return jsonResponse({ ok: true, summary, items: chosen.slice(page * 30, (page + 1) * 30), more: (page + 1) * 30 < chosen.length });
    }
    const body = await readJson(req, 6800);
    if (body.action === "review") {
      if (user?.role !== "admin") return errorResponse(403, "需要管理员权限");
      if (typeof body.id !== "string" || !/^[\da-f-]{36}$/.test(body.id) || !["open", "handled"].includes(body.state)) {
        return errorResponse(400, "反馈处理状态不正确");
      }
      const result = await changeEntry(store, `${prefix}${body.id}.json`, (previous) =>
        previous && { ...previous, state: body.state });
      if (!result.record) return errorResponse(404, "找不到这条反馈");
      return jsonResponse({ ok: true });
    }
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 1600 || !Object.hasOwn(feedbackKinds, body.kind)) return errorResponse(400, "请选择类型并填写 1–1600 字反馈");
    const id = randomUUID();
    const item = { id, kind: body.kind, message, created: new Date().toISOString(), state: "open",
      author: user?.username || null };
    await store.setJSON(`${prefix}${id}.json`, item);
    return jsonResponse({ ok: true }, 201);
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(error.status, error.message);
    console.error("Feedback:", error);
    return errorResponse(500, "反馈服务暂时不可用");
  }
}
