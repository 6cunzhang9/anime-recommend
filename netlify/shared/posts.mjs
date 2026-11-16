import { createHash } from "node:crypto";
import v4 from "../../v4-validation.js";
import { changeEntry, packQuestionnaire, publicationFor } from "./records.mjs";
import { readAllRatings, readAllRecords, readForum, responseKey } from "./store.mjs";
import { knownGroup } from "./work-search.mjs";

export const cursorPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\/[a-f0-9]{64}$/;

export function withdrawFavorite(store, owner, id) {
  return changeEntry(store, responseKey(id, owner), (record) => {
    if (!record?.publication || record.publication.deleted_at) return null;
    return packQuestionnaire({ ...record, publication: { ...record.publication, deleted_at: new Date().toISOString() } });
  });
}

export function postFromRecord(record) {
  const publication = publicationFor(record);
  const type = record.response_id ? "favorite" : record.thread_topic ? "general" : "review";
  if (!record.accountOwner || !publication?.published_at || publication.deleted_at) return null;
  const id = type === "favorite" ? record.response_id : record.id;
  const publicId = createHash("sha256").update(`${type}:${record.accountOwner}:${id}`).digest("hex");
  const works = type === "general" ? [] : type === "favorite"
    ? (record.actual_favorites || []).flatMap((favorite) => {
      if (!favorite?.title_raw) return [];
      return [{
        external_ref: v4.validateExternalRef(favorite.external_ref || { provider: "manual", title_display: favorite.title_raw }, true),
        review: favorite.review || null,
        strength: favorite.like_strength,
        reasons: favorite.reasons || [],
        comment: favorite.reason_text || ""
      }];
    })
    : [{
      external_ref: v4.validateExternalRef(record.external_ref || record.work_ref, true),
      review: record.review || null,
      rating: record.rating,
      sentiment: record.sentiment,
      status: record.status,
      comment: record.comment,
      watched: record.watched === true
    }];
  return {
    id: publicId, type, works, published_at: publication.published_at, moderated: publication.moderated === true,
    ...(type === "general" && { title: record.title, body: record.body }),
    target: { owner: record.accountOwner, id, type }, sortKey: `${publication.published_at}/${publicId}`
  };
}

export function pagePosts(records, { query = "", cursor = "", type = "", board, related = [], admin = false } = {}) {
  const members = new Set([board, ...related]);
  const posts = records.map(postFromRecord).filter(Boolean).filter((post) =>
    (admin || !post.moderated) && (!type || post.type === type) && (!cursor || post.sortKey < cursor) &&
    (!board || post.works.some(({ external_ref: ref }) =>
      ["bangumi", "bangumi-series"].includes(ref.provider) &&
      (members.has(ref.provider_id) || ref.series_id === board || knownGroup(ref.provider_id)?.id === board))) &&
    (!query || (post.type === "general" && [post.title, post.body].some((value) => v4.normalizeWorkTitle(value).includes(query)))
      || post.works.some(({ external_ref: ref }) => [ref.title_display, ref.title_canonical, ref.series_title]
      .some((title) => v4.normalizeWorkTitle(title).includes(query))))
  ).sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  return {
    posts: posts.slice(0, 20).map(({ target, moderated, sortKey, ...post }) =>
      admin ? { ...post, target, moderated } : post),
    next: posts.length > 20 ? posts[19].sortKey : null
  };
}

export async function readPostRecords(type) {
  const [questionnaires, ratings, topics] = await Promise.all([
    type && type !== "favorite" ? [] : readAllRecords(undefined, { publicOnly: true }),
    type && type !== "review" ? [] : readAllRatings(undefined, { publicOnly: true }),
    type && type !== "general" ? [] : readForum()
  ]);
  return [...questionnaires, ...ratings, ...topics];
}
