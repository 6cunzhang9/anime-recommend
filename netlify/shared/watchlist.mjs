import v4 from "../../v4-validation.js";
import watch from "../../watch-model.js";
import { digest, RequestError } from "./auth.mjs";
import { changeEntry } from "./records.mjs";
import { getResponsesStore } from "./store.mjs";

const scope = (owner) => `watchlist/${owner}/`;
const keyOf = (owner, work) => scope(owner) + digest(v4.workIdentity(work)) + ".json";

export async function listWatchlist(owner) {
  const store = getResponsesStore();
  const list = (await store.list({ prefix: scope(owner) })).blobs;
  const all = [];
  for (let i = 0; i < list.length; i += 25) {
    const rows = await Promise.all(list.slice(i, i + 25).map(({ key }) => store.get(key, { type: "json" })));
    all.push(...rows.filter(Boolean));
  }
  return all.sort((a, b) => b.updated.localeCompare(a.updated));
}

export async function changeWatchlist(owner, params) {
  const work = v4.validateExternalRef(params.work, true);
  const key = keyOf(owner, work);
  const store = getResponsesStore();
  if (params.action === "remove") {
    await store.delete(key);
    return null;
  }
  if (!["save", "add", "rewatch"].includes(params.action)) throw new RequestError(400, "未知清单操作");
  const review = watch.review(params.review);
  if (params.review && !review) throw new RequestError(400, "评价每项均需选择 1–10 分");
  const result = await changeEntry(store, key, (previous) => {
    if (params.action === "add" && previous) return null;
    const status = params.action === "rewatch" ? "watched" : ["wanted", "watched"].includes(params.status)
      ? params.status : previous?.status || "wanted";
    const count = params.action === "rewatch" ? (previous?.plays || 0) + 1
      : Number.isInteger(params.plays) ? params.plays : previous?.plays || 1;
    return {
      work,
      status,
      plays: status === "watched" ? Math.min(999, Math.max(1, count)) : 0,
      love: ["favorite", "like", "neutral", "dislike"].includes(params.love) ? params.love : previous?.love || "neutral",
      review: review || previous?.review || null,
      features: watch.tags([...(previous?.features || []), ...(work.features || []), ...watch.tags(params.features)], 16),
      updated: new Date().toISOString()
    };
  });
  if (result.conflict) throw new RequestError(409, "清单已经变化，请重试");
  return result.record;
}
