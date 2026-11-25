import taste from "../../taste-analysis.js";
import watch from "../../watch-model.js";
import { getUser } from "../shared/auth.mjs";
import { publicationFor } from "../shared/records.mjs";
import { getResponsesStore, readAllRatings, readAllRecords, jsonResponse, errorResponse } from "../shared/store.mjs";
import { feedbackKinds, readSiteFeedback } from "./site-feedback.mjs";

export const config = { path: "/api/admin-metrics", method: "GET" };
const CACHE_MS = 60_000;
let cached = null;
let cachedAt = 0;

function means(rows, fields) {
  return Object.entries(fields).flatMap(([key, label]) => {
    const points = rows.map((row) => row?.[key]).filter(Number.isFinite);
    return points.length ? [{ label, value: Math.round(points.reduce((a, b) => a + b, 0) / points.length * 10) / 10 }] : [];
  });
}

function lastDays(rows, getTime) {
  const counts = new Map();
  for (let i = 13; i >= 0; i--) {
    counts.set(new Date(Date.now() + 8 * 3600000 - i * 86400000).toISOString().slice(0, 10), 0);
  }
  for (const row of rows) {
    const time = Date.parse(getTime(row));
    if (!Number.isFinite(time)) continue;
    const key = new Date(time + 8 * 3600000).toISOString().slice(0, 10);
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  }
  return [...counts].map(([label, value]) => ({ label: label.slice(5), value }));
}

export default async function handler(req) {
  try {
    if ((await getUser(req))?.role !== "admin") return errorResponse(403, "需要管理员权限");
    if (cached && Date.now() - cachedAt < CACHE_MS) return jsonResponse({ ok: true, ...cached });
    const store = getResponsesStore();
    if (new URL(req.url).searchParams.get("summary") === "1") {
      const [users, responses, ratings, watchlist, forum, feedback] = await Promise.all([
        store.list({ prefix: "accounts/" }), store.list({ prefix: "responses/" }),
        store.list({ prefix: "ratings/" }), store.list({ prefix: "watchlist/" }),
        store.list({ prefix: "forum/" }), readSiteFeedback(store)
      ]);
      return jsonResponse({
        ok: true, summaryOnly: true,
        totals: {
          accounts: users.blobs.length, assessments: responses.blobs.length,
          publicReviews: ratings.blobs.length,
          watchlist: watchlist.blobs.filter(({ key }) => key.endsWith("/_index.json")).length,
          generalPosts: forum.blobs.length, feedback: feedback.length,
          pendingFeedback: feedback.filter((item) => item.state === "open").length
        },
        assessments: [], ratings: [], feedback: [], preferences: [], dimensions: [], feedbackKinds: []
      });
    }
    const [results, ratings, feedback, users, watchlist, generalPosts] = await Promise.all([
      readAllRecords(), readAllRatings(), readSiteFeedback(store), store.list({ prefix: "accounts/" }),
      store.list({ prefix: "watchlist/" }), store.list({ prefix: "forum/" })
    ]);
    const visible = (row) => {
      const publication = publicationFor(row);
      return publication?.published_at && !publication?.deleted_at && !publication?.moderated;
    };
    const indexed = watchlist.blobs.filter(({ key }) => key.endsWith("/_index.json"));
    const migrated = new Set(indexed.map(({ key }) => key.split("/")[1]));
    const counts = [];
    for (let i = 0; i < indexed.length; i += 50) {
      const rows = await Promise.all(indexed.slice(i, i + 50).map(({ key }) => store.get(key, { type: "json" })));
      counts.push(...rows.map((row) => Object.keys(row?.items || {}).length));
    }
    const watched = counts.reduce((a, b) => a + b, 0) + watchlist.blobs.filter(({ key }) => !migrated.has(key.split("/")[1])).length;
    const reviews = [...ratings.filter(visible).map((row) => row.review), ...results.filter(visible)
      .flatMap((row) => (row.actual_favorites || []).map((item) => item.review))].filter(Boolean);
    const metrics = {
      totals: { accounts: users.blobs.length, assessments: results.length, publicReviews: ratings.filter(visible).length,
        watchlist: watched, generalPosts: generalPosts.blobs.length, feedback: feedback.length,
        pendingFeedback: feedback.filter((item) => item.state === "open").length },
      assessments: lastDays(results, (row) => row.submitted_at || row.receivedAt),
      ratings: lastDays(ratings.filter(visible), (row) => publicationFor(row).published_at),
      feedback: lastDays(feedback, (row) => row.created),
      preferences: means(results.map((row) => row.analysis?.dimensions || (row.answers && taste.userDimensions(row.answers))), taste.AXES),
      dimensions: means(reviews.map(({ dimensions }) => dimensions), watch.criteria),
      feedbackKinds: Object.entries(feedbackKinds).map(([key, label]) => ({ label, value: feedback.filter((item) => item.kind === key).length }))
    };
    cached = metrics;
    cachedAt = Date.now();
    return jsonResponse({ ok: true, ...metrics });
  } catch (error) {
    console.error("Admin metrics:", error);
    return errorResponse(500, "暂时无法读取统计");
  }
}
