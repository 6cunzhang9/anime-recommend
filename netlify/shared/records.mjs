const FORMAT = "compact-v1";

export function packQuestionnaire(record) {
  const { answers: { q40, ...answers }, derived_profile, anchors, context, self_description, ...data } = record;
  let profile = null;
  if (derived_profile) {
    const { anchors: profileAnchors, context: profileContext, self_description: description, ...rest } = derived_profile;
    profile = rest;
  }
  const recommendation_snapshots = (data.recommendation_snapshots || []).slice(-5);
  return {
    ...data, answers, derived_profile: profile,
    context: context || derived_profile?.context || null,
    self_description: self_description || derived_profile?.self_description || null,
    recommendation_snapshots, record_format: FORMAT
  };
}

export function packRating(record) {
  const { work_ref, ...data } = record;
  return { ...data, record_format: FORMAT };
}

export function unpackRecord(record) {
  if (record?.record_format !== FORMAT) return record;
  const { record_format, ...data } = record;
  if (!data.response_id) return { ...data, work_ref: data.external_ref };
  const favorites = data.actual_favorites || [];
  const matched = favorites.filter(({ external_ref }) => external_ref?.lookup_status === "matched").length;
  const anchors = {
    actual_favorites: favorites, matched_favorites: matched, unmatched_favorites: favorites.length - matched
  };
  return {
    ...data, answers: { ...data.answers, q40: { favorites } }, anchors,
    derived_profile: data.derived_profile && {
      ...data.derived_profile, context: data.context || {}, self_description: data.self_description || {}, anchors
    }
  };
}

export function publicationFor(record) {
  if (record.publication) return record.publication;
  if (record.public_review === true) {
    return { published_at: record.received_at || record.created_at, moderated: false };
  }
  return null;
}

// A post and its source share a blob. Updating it keeps moderation and content in sync.
export async function changeEntry(store, key, change, { createOnly = false } = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await store.getWithMetadata(key, { type: "json" });
    const previous = unpackRecord(current?.data);
    if (previous && createOnly) return { record: previous, modified: false };
    const next = change(previous);
    if (!next) return { record: previous, modified: false };
    const result = await store.setJSON(key, next, current?.etag ? { onlyIfMatch: current.etag } : { onlyIfNew: true });
    if (result.modified) return { record: unpackRecord(next), modified: true };
  }
  return { conflict: true };
}
