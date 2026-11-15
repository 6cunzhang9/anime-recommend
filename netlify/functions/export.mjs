import {
  checkAdmin,
  errorResponse,
  joinFeedback,
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
    const joined = joinFeedback(records, reactions);
    const stamp = new Date().toISOString().slice(0, 10);
    let body;
    let contentType;
    let extension = format;

    if (format === "csv") {
      body = recordsToCsv(joined);
      contentType = "text/csv; charset=utf-8";
    } else if (format === "json") {
      body = JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          schemaVersion: 3,
          count: joined.length,
          responses: joined,
          reactions
        },
        null,
        2
      );
      contentType = "application/json; charset=utf-8";
    } else {
      body = joined.map((record) => JSON.stringify(record)).join("\n");
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
