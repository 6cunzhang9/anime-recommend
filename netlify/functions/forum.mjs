import { randomUUID } from "node:crypto";
import { checkAccountContext, getUser, keyPart, readJson, RequestError } from "../shared/auth.mjs";
import { checkCanPublish } from "../shared/members.mjs";
import { cleanAttachments } from "../shared/media.mjs";
import { postFromRecord } from "../shared/posts.mjs";
import { changeEntry } from "../shared/records.mjs";
import { errorResponse, forumKey, getResponsesStore, jsonResponse } from "../shared/store.mjs";

export const config = { path: "/api/forum", method: "POST",
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 16 } };

export default async function handler(req) {
  return errorResponse(410, "交流中心已下线");
  // eslint-disable-next-line no-unreachable
  try {
    const user = await getUser(req);
    if (!user) return errorResponse(401, "登录后可发布散贴");
    const payload = await readJson(req, 8000);
    checkAccountContext(payload, user);
    await checkCanPublish(user);
    const title = typeof payload.title === "string" ? payload.title.trim() : "";
    const body = typeof payload.body === "string" ? payload.body.trim() : "";
    if (!title || title.length > 80 || !body || body.length > 1600) return errorResponse(400, "请填写标题与正文");
    const editing = payload.action === "edit";
    const hasId = typeof payload.id === "string" && keyPart.test(payload.id);
    if ((editing || payload.id !== undefined) && !hasId) return errorResponse(400, "帖子编号无效");
    const requestedAttachments = payload.attachments === undefined ? null : cleanAttachments(payload.attachments);
    const id = hasId ? payload.id : randomUUID();
    const store = getResponsesStore();
    const result = await changeEntry(store, forumKey(id, user.id), (previous) => {
      if (editing && !previous) return null;
      const now = new Date().toISOString();
      return {
        id, thread_topic: true, title, body,
        attachments: requestedAttachments === null ? previous?.attachments || [] : requestedAttachments,
        updated: now, publication: previous?.publication || { published_at: now }
      };
    }, { createOnly: !editing });
    if (result.conflict) return errorResponse(409, "帖子发生变更，请重试");
    if (!result.record) return errorResponse(404, "散贴不存在");
    const post = postFromRecord({ ...result.record, accountOwner: user.id });
    return jsonResponse({ ok: true, post: post?.id }, editing || !result.modified ? 200 : 201);
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(error.status, error.message);
    console.error("Forum:", error);
    return errorResponse(500, "暂时无法保存散贴");
  }
}
