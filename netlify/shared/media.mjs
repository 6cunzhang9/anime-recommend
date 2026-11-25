import { randomBytes } from "node:crypto";
import { getResponsesStore } from "./store.mjs";

export const mediaIdPattern = /^[a-f0-9]{24}$/;
export const maxAttachments = 4;
export const maxMediaBytes = 3 * 1024 * 1024;

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const videoTypes = new Set(["video/mp4", "video/webm"]);

export const mediaKey = (id) => `media/${id}.json`;

export function mediaKind(type) {
  if (imageTypes.has(type)) return "image";
  if (videoTypes.has(type)) return "video";
  return null;
}

export function cleanMediaName(value) {
  return String(value || "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120);
}

export function cleanAttachment(input) {
  if (!input || typeof input !== "object") return null;
  const id = String(input.id || "");
  if (!mediaIdPattern.test(id)) return null;
  const type = String(input.type || "").slice(0, 120);
  const kind = mediaKind(type);
  if (!kind) return null;
  return {
    id,
    kind,
    name: cleanMediaName(input.name) || (kind === "image" ? "图片" : kind === "video" ? "视频" : "附件"),
    type,
    size: Math.max(0, Math.min(maxMediaBytes, Number(input.size) || 0)),
    url: `/api/media?id=${id}`
  };
}

export function cleanAttachments(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  return input.map(cleanAttachment).filter((item) => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, maxAttachments);
}

export function mediaDescriptor(record, id) {
  return {
    id,
    kind: record.kind,
    name: record.name,
    type: record.type,
    size: record.size,
    url: `/api/media?id=${id}`
  };
}

export async function saveMedia({ owner, name, type, bytes }) {
  const kind = mediaKind(type);
  if (!kind) throw new Error("不支持的文件类型");
  if (!bytes.length || bytes.length > maxMediaBytes) throw new Error("文件大小超过限制");
  const id = randomBytes(12).toString("hex");
  const record = {
    id,
    owner,
    kind,
    name: cleanMediaName(name) || "附件",
    type,
    size: bytes.length,
    data: bytes.toString("base64"),
    created: new Date().toISOString()
  };
  await getResponsesStore().setJSON(mediaKey(id), record);
  return mediaDescriptor(record, id);
}

export async function readMedia(id) {
  if (!mediaIdPattern.test(String(id || ""))) return null;
  const record = await getResponsesStore().get(mediaKey(id), { type: "json" });
  if (!record?.data || !mediaKind(record.type)) return null;
  return { ...record, bytes: Buffer.from(record.data, "base64") };
}
