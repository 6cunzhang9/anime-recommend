import { createHash } from "node:crypto";
import v4 from "../../v4-validation.js";
import { publicationFor } from "./records.mjs";
import { readAllRatings, readAllRecords } from "./store.mjs";

export const cursorPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\/[a-f0-9]{64}$/;

export function postFromRecord(record) {
  const publication = publicationFor(record);
  const type = record.response_id ? "favorite" : "review";
  if (!record.accountOwner || !publication?.published_at) return null;
  const id = type === "favorite" ? record.response_id : record.id;
  const publicId = createHash("sha256").update(`${type}:${record.accountOwner}:${id}`).digest("hex");
  const works = type === "favorite"
    ? (record.actual_favorites || []).flatMap((favorite) => {
      if (!favorite?.title_raw) return [];
      return [{
        external_ref: v4.validateExternalRef(favorite.external_ref || { provider: "manual", title_display: favorite.title_raw }, true),
        strength: favorite.like_strength,
        reasons: favorite.reasons || [],
        comment: favorite.reason_text || ""
      }];
    })
    : [{
      external_ref: v4.validateExternalRef(record.external_ref || record.work_ref, true),
      rating: record.rating,
      sentiment: record.sentiment,
      status: record.status,
      comment: record.comment
    }];
  return {
    type, works, published_at: publication.published_at, moderated: publication.moderated === true,
    target: { owner: record.accountOwner, id, type }, sortKey: `${publication.published_at}/${publicId}`
  };
}

export function pagePosts(records, { query = "", cursor = "", type = "", admin = false } = {}) {
  const posts = records.map(postFromRecord).filter(Boolean).filter((post) =>
    (admin || !post.moderated) && (!type || post.type === type) && (!cursor || post.sortKey < cursor) &&
    (!query || post.works.some(({ external_ref: ref }) => [ref.title_display, ref.title_canonical]
      .some((title) => v4.normalizeWorkTitle(title).includes(query))))
  ).sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  return {
    posts: posts.slice(0, 20).map(({ target, moderated, sortKey, ...post }) =>
      admin ? { ...post, target, moderated } : post),
    next: posts.length > 20 ? posts[19].sortKey : null
  };
}

export async function readPostRecords(type) {
  const [questionnaires, ratings] = await Promise.all([
    type === "review" ? [] : readAllRecords(undefined, { publicOnly: true }),
    type === "favorite" ? [] : readAllRatings(undefined, { publicOnly: true })
  ]);
  return [...questionnaires, ...ratings];
}
