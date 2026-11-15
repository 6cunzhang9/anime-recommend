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
  const auth = checkAdmin(req);
  if (!auth.ok) return errorResponse(auth.status, auth.message);

  try {
    const url = new URL(req.url);
    const format = url.searchParams.get("format") || "jsonl";
    if (!["json", "jsonl", "csv"].includes(format)) {
      return errorResponse(400, "Unsupported export format");
    }

    const records = await readAllRecords();
    const reactions = await readAllReactions();
    const ratings = await readAllRatings();
    const questionnaires = records.filter((record) => Number(record.schemaVersion) === 4);
    const legacy = records.filter((record) => Number(record.schemaVersion) !== 4);
    const stamp = new Date().toISOString().slice(0, 10);
    let body;
    let contentType;
    let extension = format;

    if (format === "csv") {
      body = recordsToCsv(records, reactions);
      contentType = "text/csv; charset=utf-8";
    } else if (format === "json") {
      body = JSON.stringify({
        exported_at: new Date().toISOString(),
        schema_version: 4,
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
