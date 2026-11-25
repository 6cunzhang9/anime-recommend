import v4 from "../../v4-validation.js";
import { getUser } from "../shared/auth.mjs";
import {
  checkAdmin,
  errorResponse,
  readAllRatings,
  readAllReactions,
  readAllRecords,
  recordsToCsv
} from "../shared/store.mjs";

export const config = {
  path: "/api/export",
  method: "GET",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: "ip",
    windowSize: 60,
    windowLimit: 5
  }
};

export default async function handler(req) {
  try {
    const auth = checkAdmin(req);
    if (!auth.ok && (await getUser(req))?.role !== "admin") {
      return errorResponse(auth.status, auth.message);
    }
    const url = new URL(req.url);
    const format = url.searchParams.get("format") || "jsonl";
    if (!["summary", "json", "jsonl", "csv"].includes(format)) {
      return errorResponse(400, "Unsupported export format");
    }

    const [records, reactions, ratings] = await Promise.all([
      readAllRecords(), readAllReactions(), readAllRatings()
    ]);
    const summary = {
      ...v4.summarize(records),
      account_profiles: new Set(records.map((record) => record.accountOwner).filter(Boolean)).size,
      ratings: ratings.length,
      ratings_by_score: Object.fromEntries([1, 2, 3, 4, 5].map((score) => [
        score, ratings.filter((rating) => rating.rating === score).length
      ])),
      public_reviews: ratings.filter((rating) => rating.public_review === true && rating.accountOwner && !rating.publication?.moderated).length,
      public_favorite_posts: records.filter((record) => record.accountOwner && record.publication?.published_at && !record.publication.moderated && !record.publication.deleted_at).length,
      recommendation_feedback: reactions.length,
      community_picks: records.reduce((totals, record) => {
        const source = record.recommendation_snapshot?.community_pick?.source;
        if (source === "similar" || source === "reviews") totals[source] += 1;
        return totals;
      }, { similar: 0, reviews: 0 })
    };
    const questionnaires = records.filter((record) => Number(record.schemaVersion) === 4);
    const legacy = records.filter((record) => Number(record.schemaVersion) !== 4);
    const stamp = new Date().toISOString().slice(0, 10);
    let body;
    let contentType;
    let extension = format;

    if (format === "csv") {
      body = recordsToCsv(records, reactions);
      contentType = "text/csv; charset=utf-8";
    } else if (format === "summary") {
      body = JSON.stringify({ exported_at: new Date().toISOString(), ...summary }, null, 2);
      contentType = "application/json; charset=utf-8";
      extension = "json";
    } else if (format === "json") {
      body = JSON.stringify({
        exported_at: new Date().toISOString(),
        schema_version: 4,
        summary,
        questionnaires,
        legacy_questionnaires: legacy,
        reactions,
        ratings
      }, null, 2);
      contentType = "application/json; charset=utf-8";
    } else {
      body = records.map((record) => JSON.stringify(record)).join("\n");
      if (body) body += "\n";
      contentType = "application/x-ndjson; charset=utf-8";
      extension = "jsonl";
    }

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="anime-soul-samples-${stamp}.${extension}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer"
      }
    });
  } catch (error) {
    console.error("export function failed:", error);
    return errorResponse(500, "导出失败");
  }
}
