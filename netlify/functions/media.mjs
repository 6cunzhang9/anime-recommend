import { checkAccountContext, getUser, readJson, RequestError } from "../shared/auth.mjs";
import { checkCanPublish } from "../shared/members.mjs";
import { cleanMediaName, maxMediaBytes, mediaKind, readMedia, saveMedia } from "../shared/media.mjs";
import { errorResponse, jsonResponse } from "../shared/store.mjs";

export const config = {
  path: "/api/media",
  method: ["GET", "POST"],
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 30 }
};

function fileName(name) {
  return encodeURIComponent(cleanMediaName(name) || "attachment")
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export default async function handler(req) {
  try {
    if (req.method === "GET") {
      const id = new URL(req.url).searchParams.get("id") || "";
      const record = await readMedia(id);
      if (!record) return errorResponse(404, "文件不存在");
      const disposition = record.kind === "file" ? "attachment" : "inline";
      return new Response(record.bytes, {
        status: 200,
        headers: {
          "Content-Type": record.type,
          "Content-Length": String(record.bytes.length),
          "Content-Disposition": `${disposition}; filename*=UTF-8''${fileName(record.name)}`,
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox"
        }
      });
    }

    const user = await getUser(req);
    if (!user) return errorResponse(401, "登录后可上传附件");
    const payload = await readJson(req, 4_500_000);
    checkAccountContext(payload, user);
    await checkCanPublish(user);
    const type = String(payload.type || "").toLowerCase();
    if (!mediaKind(type)) return errorResponse(415, "仅支持图片和 MP4/WebM 视频");
    const match = String(payload.data || "").match(/^data:([^;]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
    if (!match || match[1].toLowerCase() !== type) return errorResponse(400, "文件数据不正确");
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.length > maxMediaBytes) return errorResponse(413, "单个文件不能超过 3 MB");
    const attachment = await saveMedia({
      owner: user.id,
      name: payload.name,
      type,
      bytes
    });
    return jsonResponse({ ok: true, attachment }, 201);
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(error.status, error.message);
    if (/文件大小|不支持/.test(error.message)) return errorResponse(400, error.message);
    console.error("Media:", error);
    return errorResponse(500, "附件服务暂时不可用");
  }
}
