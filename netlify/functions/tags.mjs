import watch from "../../watch-model.js";
import { checkAccountContext, getUser, readJson, RequestError } from "../shared/auth.mjs";
import { checkCanPublish } from "../shared/members.mjs";
import { changeEntry } from "../shared/records.mjs";
import { approvedTags, defaultTags, proposalKey, proposals } from "../shared/review-tags.mjs";
import { errorResponse, getResponsesStore, jsonResponse } from "../shared/store.mjs";

export const config = { path: "/api/tags", method: ["GET", "POST"],
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 30 } };

export default async function handler(req) {
  try {
    if (req.method === "GET") {
      const review = new URL(req.url).searchParams.get("view") === "review";
      if (review && (await getUser(req))?.role !== "admin") return errorResponse(403, "需要管理员账号");
      const items = await proposals();
      return jsonResponse({ ok: true, tags: approvedTags(items),
        ...(review && { pending: items.filter(({ status }) => status === "pending")
          .map(({ label, submitted }) => ({ label, submitted })).sort((a, b) => a.submitted.localeCompare(b.submitted)) }) });
    }
    const [user, payload] = await Promise.all([getUser(req), readJson(req, 1200)]);
    if (!user) return errorResponse(401, "登录后可提议新标签");
    checkAccountContext(payload, user);
    const label = watch.tags([payload.label], 1)[0];
    if (!label || !/[\p{L}\p{N}]/u.test(label) || payload.label.trim().length > 28) return errorResponse(400, "请输入 1–28 字的标签");
    if (defaultTags.some((item) => watch.normalize(item) === watch.normalize(label))) return errorResponse(409, "这个标签已经可选");
    const store = getResponsesStore();
    const key = proposalKey(label);
    if (payload.action === "propose") {
      await checkCanPublish(user);
      const result = await store.setJSON(key, { label, status: "pending", submitted: new Date().toISOString() }, { onlyIfNew: true });
      if (!result.modified) {
        const current = await store.get(key, { type: "json" });
        return errorResponse(409, current?.status === "approved" ? "这个标签已经可选"
          : current?.status === "rejected" ? "这个标签未通过审核" : "这个标签已经在等候审核");
      }
      return jsonResponse({ ok: true }, 201);
    }
    if (payload.action !== "decide" || !["approved", "rejected"].includes(payload.status)) return errorResponse(400, "标签操作无效");
    if (user.role !== "admin") return errorResponse(403, "需要管理员账号");
    const result = await changeEntry(store, key, (previous) => previous?.status === "pending"
      ? { ...previous, status: payload.status, decided: new Date().toISOString() } : null);
    if (!result.modified) return errorResponse(409, "这条提议已处理或不存在");
    return jsonResponse({ ok: true });
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(error.status, error.message);
    console.error("Review tags:", error);
    return errorResponse(500, "标签服务暂时不可用");
  }
}
