import { randomUUID } from "node:crypto";
import v4 from "../../v4-validation.js";
import features from "../../features.js";
import watch from "../../watch-model.js";
import { getResponsesStore, readAllRecords } from "./store.mjs";
import { publicationFor } from "./records.mjs";

// 作品观察是后台私有数据，只暴露给管理员；公开推荐只读取聚合后的标签信号。
const OBSERVATION_PREFIX = "observations/";
export const observationKey = (id) => `${OBSERVATION_PREFIX}${id}.json`;

export function cleanObservation(payload) {
  const work = v4.validateExternalRef(payload.work, true);
  const axes = features.normalizeAxes(payload.axes) || {};
  const tags = features.normalizeTags(payload.tags);
  const review = watch.review(payload.review);
  return {
    work,
    axes,
    tags,
    review,
    comment: typeof payload.comment === "string" ? payload.comment.trim().slice(0, 600) : ""
  };
}

export async function saveObservation(user, payload) {
  const clean = cleanObservation(payload);
  const now = new Date().toISOString();
  const existing = payload.id && /^[a-f0-9-]{36}$/.test(payload.id)
    ? await getResponsesStore().get(observationKey(payload.id), { type: "json" }) : null;
  if (existing && existing.owner !== user.id) throw new Error("无权编辑这条观察");
  const id = existing?.id || randomUUID();
  const record = {
    ...clean,
    id,
    owner: user.id,
    owner_username: user.username,
    created: existing?.created || now,
    updated: now
  };
  await getResponsesStore().setJSON(observationKey(id), record);
  return record;
}

export function favoritePostsFromRecords(records = []) {
  return records.flatMap((record) => {
    const publication = publicationFor(record);
    if (!publication?.published_at || publication.deleted_at) return [];
    const owner = record.accountOwner || "";
    if (!owner) return [];
    const updated = record.submitted_at || record.received_at || publication.published_at;
    return (record.actual_favorites || []).flatMap((favorite, index) => {
      if (!favorite?.title_raw) return [];
      let ref;
      try {
        ref = v4.validateExternalRef(favorite.external_ref || {
          provider: "manual", title_display: favorite.title_raw
        }, true);
      } catch { return []; }
      return [{
        id: `${record.response_id}:favorite:${index}`,
        kind: "favorite",
        owner,
        owner_username: record.account_username || owner,
        work: ref,
        axes: {},
        tags: [],
        review: favorite.review || null,
        comment: favorite.reason_text || "",
        created: updated,
        updated
      }];
    });
  });
}

export async function readFavoritePosts(owner) {
  const records = await readAllRecords();
  return favoritePostsFromRecords(owner ? records.filter((record) => record.accountOwner === owner) : records);
}

export async function readObservations() {
  const store = getResponsesStore();
  const { blobs } = await store.list({ prefix: OBSERVATION_PREFIX });
  const rows = [];
  for (let index = 0; index < blobs.length; index += 25) {
    const batch = await Promise.all(blobs.slice(index, index + 25)
      .map(({ key }) => store.get(key, { type: "json" }).catch(() => null)));
    rows.push(...batch.filter(Boolean));
  }
  return rows.sort((left, right) => String(right.updated).localeCompare(String(left.updated)));
}

export function publicObservation(record) {
  return {
    id: record.id,
    ...(record.kind && { kind: record.kind }),
    owner: record.owner_username,
    work: record.work,
    axes: record.axes,
    tags: record.tags,
    review: record.review,
    comment: record.comment || "",
    created: record.created,
    updated: record.updated
  };
}
