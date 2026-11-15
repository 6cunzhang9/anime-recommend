import { checkAccountContext, getUser, keyPart, readJson, RequestError } from "../shared/auth.mjs";
import { bookmarkKey, summarizeThread, threadKey } from "../shared/discussions.mjs";
import { cursorPattern, postFromRecord, readPostRecords, withdrawFavorite } from "../shared/posts.mjs";
import { errorResponse, getResponsesStore, jsonResponse, ratingKey, readAllRatings, readAllRecords } from "../shared/store.mjs";

export const config = { path: "/api/footprints", method: ["GET", "POST"],
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 40 } };

async function withdraw(req, store, user) {
  const payload = await readJson(req, 14000);
  checkAccountContext(payload, user);
  if (!Array.isArray(payload.posts) || !payload.posts.length || payload.posts.length > 50 ||
      payload.posts.some((post) => !["favorite", "review"].includes(post?.type) || typeof post.id !== "string" || !keyPart.test(post.id))) {
    return errorResponse(400, "每次请选择 1–50 条自己的发言");
  }
  const unique = new Map(payload.posts.map(({ type, id }) => [`${type}:${id}`, { type, id }]));
  const results = [];
  for (const post of unique.values()) {
    try {
      if (post.type === "review") {
        await store.delete(ratingKey(post.id, user.id));
        results.push({ ...post, removed: true });
      } else {
        const result = await withdrawFavorite(store, user.id, post.id);
        results.push({ ...post, removed: !result.conflict, publication: result.record?.publication });
      }
    } catch (error) {
      console.warn("Footprint withdrawal:", error.message);
      results.push({ ...post, removed: false });
    }
  }
  return jsonResponse({ ok: true, results });
}

async function listPosts(store, user, view, before) {
  const records = view === "own"
    ? (await Promise.all([readAllRecords(user.id), readAllRatings(user.id)])).flat()
    : await readPostRecords();
  const posts = records.map(postFromRecord).filter((post) => post && (view === "own" || !post.moderated) &&
    (!before || post.sortKey < before)).sort((a, b) => b.sortKey.localeCompare(a.sortKey));

  if (view === "own") {
    return { posts: posts.map(({ id, target, moderated, type, works, published_at }) =>
      ({ id: moderated ? null : id, recordId: target.id, moderated, type, works, published_at })), next: null };
  }

  const prefix = view === "saved" ? bookmarkKey(user.id) : "threads/";
  const { blobs } = await store.list({ prefix });
  const keys = new Set(blobs.map(({ key }) => key.slice(prefix.length, -5)));
  const candidates = posts.filter(({ id }) => keys.has(id));
  const selected = [];
  for (let start = 0; start < candidates.length && selected.length <= 20; start += 20) {
    const rows = await Promise.all(candidates.slice(start, start + 20).map(async (post) => {
      const thread = await store.get(threadKey(post.id), { type: "json" });
      if (view === "liked" && !thread?.likes?.includes(user.id)) return null;
      const { id, type, works, published_at, sortKey } = post;
      return { sortKey, post: { id, type, works, published_at, ...summarizeThread(thread) } };
    }));
    selected.push(...rows.filter(Boolean));
  }
  return { posts: selected.slice(0, 20).map(({ post }) => post), next: selected.length > 20 ? selected[19].sortKey : null };
}

export default async function handler(req) {
  try {
    const user = await getUser(req);
    if (!user) return errorResponse(401, "登录后可以查看足迹");
    const store = getResponsesStore();
    if (req.method === "POST") return await withdraw(req, store, user);
    const params = new URL(req.url).searchParams;
    const view = params.get("view") || "own";
    const before = params.get("before");
    if (!["own", "liked", "saved"].includes(view) || (before && !cursorPattern.test(before))) {
      return errorResponse(400, "足迹查询无效");
    }
    return jsonResponse({ ok: true, ...await listPosts(store, user, view, before) });
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(error.status, error.message);
    console.error("Footprints:", error);
    return errorResponse(500, "足迹暂时不可用");
  }
}
