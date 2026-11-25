import { memberSettings, saveMemberSettings } from "../shared/members.mjs";
import { checkAccountContext, endSession, getUser, readJson, refreshSession, RequestError, startSession, verifyAccount } from "../shared/auth.mjs";
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
      if (new URL(req.url).searchParams.get("view") === "session") {
        const refreshed = await refreshSession(req);
        return jsonResponse({ ok: true, user }, 200, refreshed ? { "Set-Cookie": refreshed } : {});
      }
      const [questionnaires, ratings, reactions, settings] = await Promise.all([
        readAllRecords(user.id), readAllRatings(user.id), readAllReactions(user.id), memberSettings(user)
      ]);
      return jsonResponse({ ok: true, user: { id: user.id, username: user.username, role: user.role || "member", ...settings }, questionnaires, ratings, reactions });
    }
    const payload = await readJson(req, 75000);
    if (payload.action === "logout") {
      return jsonResponse({ ok: true }, 200, { "Set-Cookie": await endSession(req) });
    }
    if (payload.action === "settings") {
      const user = await getUser(req);
      if (!user) return errorResponse(401, "请先登录");
      checkAccountContext(payload, user);
      return jsonResponse({ ok: true, settings: await saveMemberSettings(user, payload) });
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
