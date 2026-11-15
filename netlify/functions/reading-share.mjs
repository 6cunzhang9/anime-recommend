import { randomBytes } from "node:crypto";
import watch from "../../watch-model.js";
import { getUser, readJson, RequestError } from "../shared/auth.mjs";
import { readPostRecords, postFromRecord } from "../shared/posts.mjs";
import { getResponsesStore, errorResponse, jsonResponse, readAllRatings, readAllRecords } from "../shared/store.mjs";
import { memberSettings } from "../shared/members.mjs";
import { threadKey } from "../shared/discussions.mjs";
import { listWatchlist } from "../shared/watchlist.mjs";

export const config = { path: "/api/reading-share", method: ["GET", "POST"],
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 25 } };

const sections = new Set(["identity", "count", "rewatches", "favorites", "dimensions", "highlights"]);
const tokenPattern = /^[a-f0-9]{32}$/;
const shareKey = (token) => `reading-shares/${token}.json`;

export default async function handler(req) {
  const store = getResponsesStore();
  try {
    if (req.method === "GET") {
      const token = new URL(req.url).searchParams.get("share") || "";
      if (!tokenPattern.test(token)) return errorResponse(400, "分享链接不正确");
      const data = await store.get(shareKey(token), { type: "json" });
      const current = data?.owner && await store.get(`reading-share-owner/${data.owner}.json`, { type: "json" });
      if (!data || current?.token !== token) return errorResponse(404, "这份阅番总结已撤回或不存在");
      const poster = data.poster;
      if (poster.highlights?.length) {
        const active = new Set((await readPostRecords()).map(postFromRecord).filter((post) => post && !post.moderated).map((post) => post.id));
        const visible = await Promise.all(poster.highlights.map(async (item) => {
          if (!active.has(item.post)) return null;
          const { reply, ...publicItem } = item;
          if (reply) {
            const thread = await store.get(threadKey(item.post), { type: "json" });
            if (!thread?.replies?.some((row) => row.id === reply && !row.deleted)) return null;
          }
          return publicItem;
        }));
        poster.highlights = visible.filter(Boolean);
      }
      return jsonResponse({ ok: true, poster });
    }
    const user = await getUser(req);
    if (!user) return errorResponse(401, "登录后可生成阅番总结");
    const payload = await readJson(req, 2600);
    const index = `reading-share-owner/${user.id}.json`;
    if (payload.action === "revoke") {
      const current = await store.get(index, { type: "json" });
      await store.delete(index);
      if (current?.token) await store.delete(shareKey(current.token));
      return jsonResponse({ ok: true });
    }
    const allowed = new Set((Array.isArray(payload.sections) ? payload.sections : []).filter((key) => sections.has(key)));
    if (!allowed.size) return errorResponse(400, "请至少选择一项展示内容");
    const [settings, watched, questionnaires, ratings] = await Promise.all([
      memberSettings(user), listWatchlist(user.id), readAllRecords(user.id),
      allowed.has("highlights") ? readAllRatings(user.id) : []
    ]);
    const stats = watch.tastes(watched);
    const poster = { date: new Date().toISOString() };
    if (allowed.has("identity")) poster.identity = { name: settings.nickname || user.username, avatar: settings.avatar, code: settings.code };
    if (allowed.has("count")) poster.count = stats.watched;
    if (allowed.has("rewatches")) poster.rewatches = {
      total: stats.rewatches, titles: watched.filter((item) => item.status === "watched" && item.plays > 1)
        .sort((a, b) => b.plays - a.plays).slice(0, 6).map(({ work, plays }) => ({ title: work.title_display, plays }))
    };
    if (allowed.has("favorites")) poster.favorites = [...new Set([
      ...watched.filter((item) => item.status === "watched" && item.love === "favorite").map(({ work }) => work.title_display),
      ...(questionnaires.at(-1)?.actual_favorites || []).map(({ title_raw }) => title_raw)
    ])].slice(0, 8);
    if (allowed.has("dimensions")) poster.dimensions = stats.dimensions
      ? Object.fromEntries(Object.entries(stats.dimensions).map(([key, value]) => [watch.criteria[key], value * 10]))
      : Object.fromEntries(Object.entries(questionnaires.at(-1)?.analysis?.dimensions || {})
        .map(([key, value]) => [({ intensity: "情绪强度", subtlety: "情感留白", humor: "轻松幽默", romance: "恋爱比重",
          music: "音乐表现", experiment: "形式探索", spectacle: "动作与表演", atmosphere: "氛围体验", pace: "推进节奏", length: "观看篇幅" })[key] || key, value]));
    if (allowed.has("highlights")) {
      const posts = [...questionnaires, ...ratings].map(postFromRecord).filter((post) => post && !post.moderated);
      const memberships = (await store.list({ prefix: `thread-members/${user.id}/` })).blobs.slice(-30);
      const replyPosts = await Promise.all(memberships.map(async ({ key }) => (await store.get(key, { type: "json" }))?.id));
      const additional = new Set(replyPosts.filter((id) => id && !posts.some((post) => post.id === id)));
      const extraPosts = additional.size ? (await readPostRecords()).map(postFromRecord)
        .filter((post) => post && !post.moderated && additional.has(post.id)) : [];
      const threads = [...posts.slice(-40), ...extraPosts];
      const ownPosts = new Set(posts.map((post) => post.id));
      const positive = (await Promise.all(threads.map(async (post) => {
        const thread = await store.get(threadKey(post.id), { type: "json" });
        const likes = thread?.likes?.length || 0;
        const text = post.works.map((work) => work.review?.comment || work.comment).filter(Boolean).join(" · ").slice(0, 100);
        const title = post.works[0]?.external_ref.title_display;
        const highlights = ownPosts.has(post.id) ? [{ title, likes, text, post: post.id }] : [];
        for (const reply of thread?.replies || []) {
          if (!reply.deleted && reply.owner === user.id) {
            highlights.push({ title, likes: reply.likes.length, text: reply.text.slice(0, 100), post: post.id, reply: reply.id });
          }
        }
        return highlights;
      }))).flat();
      poster.highlights = positive.filter((post) => post.likes && post.text).sort((a, b) => b.likes - a.likes).slice(0, 4);
    }
    let token = (await store.get(index, { type: "json" }))?.token;
    if (!token) {
      const proposed = randomBytes(16).toString("hex");
      if ((await store.setJSON(index, { token: proposed }, { onlyIfNew: true })).modified) token = proposed;
      else token = (await store.get(index, { type: "json" }))?.token;
    }
    if (!token) return errorResponse(409, "分享发生变动，请重试");
    await store.setJSON(shareKey(token), { poster, owner: user.id });
    return jsonResponse({ ok: true, token, poster });
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(error.status, error.message);
    console.error("Share:", error);
    return errorResponse(500, "阅番总结暂时不可用");
  }
}
