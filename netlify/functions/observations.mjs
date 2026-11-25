import { checkAccountContext, getUser, readJson, RequestError } from "../shared/auth.mjs";
import { checkCanPublish } from "../shared/members.mjs";
import { publicObservation, readFavoritePosts, readObservations, saveObservation } from "../shared/observations.mjs";
import { errorResponse, jsonResponse } from "../shared/store.mjs";

export const config = {
  path: "/api/observations",
  method: ["GET", "POST"],
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 20 }
};

export default async function handler(req) {
  try {
    const user = await getUser(req);
    if (req.method === "GET") {
      if (!user) return errorResponse(401, "登录后可以查看自己的发帖");
      const all = await readObservations();
      const ownOnly = new URL(req.url).searchParams.get("mine") === "1";
      const favorites = await readFavoritePosts(ownOnly ? user.id : undefined);
      const visible = (item) => !item.ghost && (ownOnly ? item.owner === user.id : true);
      if (!ownOnly && user.role !== "admin") return errorResponse(403, "只能查看自己的发帖");
      const items = [...all.filter(visible), ...favorites].sort((left, right) =>
        String(right.updated || right.created || "").localeCompare(String(left.updated || left.created || "")));
      return jsonResponse({ ok: true, items: items.map(publicObservation) });
    }
    if (!user) return errorResponse(401, "登录后可以分享作品观察");
    const payload = await readJson(req, 24000);
    checkAccountContext(payload, user);
    await checkCanPublish(user);
    const record = await saveObservation(user, payload);
    return jsonResponse({ ok: true, observation: publicObservation(record) }, 201);
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(error.status, error.message);
    if (/无权|不完整|评价/.test(error.message)) return errorResponse(400, error.message);
    console.error("Observations:", error);
    return errorResponse(500, "观察服务暂时不可用");
  }
}
