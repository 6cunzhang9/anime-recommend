import { postFromRecord, readPostRecords } from "./posts.mjs";
import { getResponsesStore } from "./store.mjs";

export const postIdPattern = /^[a-f0-9]{64}$/;
export const threadKey = (post) => `threads/${post}.json`;
export const bookmarkKey = (owner, post = "") => `bookmarks/${owner}/${post ? `${post}.json` : ""}`;

export async function findPost(id) {
  const posts = await readPostRecords();
  return posts.map(postFromRecord).find((post) => post?.id === id && !post.moderated) || null;
}

export function summarizeThread(thread) {
  const replies = (thread?.replies || []).filter((reply) => !reply.deleted);
  const best = [...replies].sort((a, b) => b.likes.length - a.likes.length)[0];
  return { likes: thread?.likes?.length || 0, replies: replies.length, highlight: best?.likes.length ? best.text.slice(0, 80) : "" };
}

export async function threadSummary(id) {
  return summarizeThread(await getResponsesStore().get(threadKey(id), { type: "json" }));
}

export function publicThread(post, thread, user, bookmarked = false) {
  const { target, moderated, sortKey, ...visible } = post;
  const parent = new Set((thread?.replies || []).map((reply) => reply.id));
  return {
    post: visible,
    stats: summarizeThread(thread),
    liked: thread?.likes?.includes(user?.id) || false,
    bookmarked,
    replies: (thread?.replies || []).map((reply) => ({
      id: reply.id, parent: parent.has(reply.parent) ? reply.parent : null,
      text: reply.deleted ? "" : reply.text, deleted: reply.deleted || false, created: reply.created,
      likes: reply.deleted ? 0 : reply.likes.length,
      liked: !reply.deleted && reply.likes.includes(user?.id),
      canDelete: !reply.deleted && (reply.owner === user?.id || user?.role === "admin")
    }))
  };
}
