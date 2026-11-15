import { endSession, getUser, readJson, RequestError, startSession, verifyAccount } from "../shared/auth.mjs";
import { errorResponse, jsonResponse, readAllRatings, readAllReactions, readAllRecords } from "../shared/store.mjs";

export const config = {
  path: "/api/account",
  method: ["GET", "POST"],
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 12 }
};

export default async function handler(req) {
  try {
    if (req.method === "GET") {
      const user = await getUser(req);
      if (!user) return jsonResponse({ ok: true, user: null });
      const [questionnaires, ratings, reactions] = await Promise.all([
        readAllRecords(user.id), readAllRatings(user.id), readAllReactions(user.id)
      ]);
      return jsonResponse({ ok: true, user: { username: user.username, role: user.role || "member" }, questionnaires, ratings, reactions });
    }
    const payload = await readJson(req, 2048);
    if (payload.action === "logout") {
      return jsonResponse({ ok: true }, 200, { "Set-Cookie": await endSession(req) });
    }
    if (!["register", "login"].includes(payload.action)) return errorResponse(400, "未知的账号操作");
    const user = await verifyAccount(payload, payload.action === "register");
    return jsonResponse({ ok: true, user: { username: user.username, role: user.role || "member" } }, 200, {
      "Set-Cookie": await startSession(req, user)
    });
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(error.status, error.message);
    console.error("account function failed:", error);
    return errorResponse(500, "账号服务暂时不可用");
  }
}
