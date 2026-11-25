import { randomUUID } from "node:crypto";
import { checkAccountContext, getUser, readJson, RequestError } from "../shared/auth.mjs";
import { bookmarkKey, findPost, postIdPattern, publicThread, threadKey } from "../shared/discussions.mjs";
import { cleanAttachments } from "../shared/media.mjs";
import { checkCanPublish } from "../shared/members.mjs";
import { changeEntry } from "../shared/records.mjs";
import { errorResponse, getResponsesStore, jsonResponse } from "../shared/store.mjs";

export const config = { path: "/api/thread", method: ["GET", "POST"],
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 55 } };

const toggle = (ids, owner, active) => active ? [...new Set([...ids, owner])] : ids.filter((id) => id !== owner);

export default async function handler(req) {
  return errorResponse(410, "交流中心已下线");
  // eslint-disable-next-line no-unreachable
  try {
    const payload = req.method === "POST" ? await readJson(req, 5000) : {};
    const id = payload.post || new URL(req.url).searchParams.get("post") || "";
    if (typeof id !== "string" || !postIdPattern.test(id)) return errorResponse(400, "帖子编号不正确");
    const [post, user] = await Promise.all([findPost(id), getUser(req)]);
    if (!post) return errorResponse(404, "帖子已删除或不可见");
    const store = getResponsesStore();
    const bookmark = user ? bookmarkKey(user.id, id) : null;
    const threadData = async (savedThread) => {
      const [thread, saved] = await Promise.all([
        savedThread || store.get(threadKey(id), { type: "json" }),
        bookmark ? store.get(bookmark, { type: "json" }) : null
      ]);
      return jsonResponse({ ok: true, ...publicThread(post, thread, user, Boolean(saved)) });
    };
    if (req.method === "GET") return await threadData();
    if (!user) return errorResponse(401, "登录后可点赞、收藏和跟帖");
    checkAccountContext(payload, user);
    if (payload.action === "bookmark" && typeof payload.active === "boolean") {
      if (payload.active) await store.setJSON(bookmark, { post: id }, { onlyIfNew: true });
      else await store.delete(bookmark);
      return await threadData();
    }
    if (payload.action !== "delete") await checkCanPublish(user);
    const result = await changeEntry(store, threadKey(id), (previous) => {
      const thread = previous || { likes: [], replies: [] };
      if (payload.action === "like-post" && typeof payload.active === "boolean") {
        thread.likes = toggle(thread.likes, user.id, payload.active);
        return thread;
      }
      if (payload.action === "reply") {
        const text = typeof payload.text === "string" ? payload.text.trim().slice(0, 600) : "";
        const attachments = cleanAttachments(payload.attachments);
        if (!text && !attachments.length) throw new RequestError(400, "请输入回复或添加附件");
        if (thread.replies.length >= 200) throw new RequestError(409, "此帖已达到回复上限");
        const parent = payload.parent && thread.replies.find((item) => item.id === payload.parent && !item.deleted);
        if (payload.parent && !parent) throw new RequestError(404, "原回复不可用");
        const replyId = typeof payload.replyId === "string" && /^[a-f0-9-]{36}$/.test(payload.replyId) ? payload.replyId : randomUUID();
        if (thread.replies.some((item) => item.id === replyId)) return thread;
        thread.replies.push({ id: replyId, owner: user.id, parent: parent?.parent || parent?.id || null,
          text, attachments, created: new Date().toISOString(), likes: [] });
        return thread;
      }
      const reply = thread.replies.find((item) => item.id === payload.reply && !item.deleted);
      if (!reply) throw new RequestError(404, "回复不存在");
      if (payload.action === "like-reply" && typeof payload.active === "boolean") reply.likes = toggle(reply.likes, user.id, payload.active);
      else if (payload.action === "delete" && (user.id === reply.owner || user.role === "admin")) {
        reply.deleted = true;
        delete reply.text;
        delete reply.attachments;
        reply.likes = [];
      } else throw new RequestError(403, "无权执行这项操作");
      return thread;
    });
    if (result.conflict) return errorResponse(409, "帖子已变动，请重试");
    if (payload.action === "reply") {
      await store.setJSON(`thread-members/${user.id}/${id}.json`, { id }, { onlyIfNew: true })
        .catch((error) => console.warn("Thread membership:", error.message));
    }
    return await threadData(result.record);
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(error.status, error.message);
    console.error("Thread:", error);
    return errorResponse(500, "论坛暂时不可用");
  }
}
