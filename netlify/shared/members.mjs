import { randomInt } from "node:crypto";
import { digest, RequestError } from "./auth.mjs";
import { getResponsesStore } from "./store.mjs";

const profileKey = (id) => `profiles/${id}.json`;
const sanctionKey = (id) => `sanctions/${id}.json`;

async function publicId(store, owner) {
  const key = `member-codes/${owner}.json`;
  const existing = await store.get(key, { type: "json" });
  if (existing?.code) return existing.code;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  for (let i = 0; i < 12; i++) {
    const code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
    if (!(await store.setJSON(`member-code-index/${code}.json`, { owner }, { onlyIfNew: true })).modified) continue;
    const result = await store.setJSON(key, { code }, { onlyIfNew: true });
    if (result.modified) return code;
    await store.delete(`member-code-index/${code}.json`);
    return (await store.get(key, { type: "json" })).code;
  }
  throw new Error("Could not allocate member code");
}

export async function memberSettings(user, { includeCode = true } = {}) {
  const store = getResponsesStore();
  const [settings, sanction, code] = await Promise.all([
    store.get(profileKey(user.id), { type: "json" }), store.get(sanctionKey(user.id), { type: "json" }),
    includeCode ? publicId(store, user.id) : null
  ]);
  return {
    code,
    avatar: settings?.avatar || "",
    nickname: settings?.nickname || "",
    bio: settings?.bio || "",
    accent: settings?.accent || "jade",
    compact: settings?.compact === true,
    mutedUntil: Date.parse(sanction?.until) > Date.now() ? sanction.until : null,
    moderationReason: Date.parse(sanction?.until) > Date.now() ? sanction.reason : ""
  };
}

export async function saveMemberSettings(user, payload) {
  const nickname = typeof payload.nickname === "string" ? payload.nickname.normalize("NFKC").trim().replace(/ +/g, " ") : "";
  if (nickname && !/^[\p{L}\p{N} _.-]{2,24}$/u.test(nickname)) {
    throw new RequestError(400, "昵称需为 2–24 个字，可用文字、数字、空格、点、下划线或短横线");
  }
  if (nickname && /^admin$/i.test(nickname)) throw new RequestError(409, "此昵称已保留");
  const bio = typeof payload.bio === "string" ? payload.bio.trim().slice(0, 160) : "";
  const accent = ["jade", "blue", "amber"].includes(payload.accent) ? payload.accent : "jade";
  const store = getResponsesStore();
  if (nickname) {
    const key = `nicknames/${digest(nickname.toLowerCase())}.json`;
    const result = await store.setJSON(key, { id: user.id }, { onlyIfNew: true });
    if (!result.modified && (await store.get(key, { type: "json" }))?.id !== user.id) {
      throw new RequestError(409, "这个昵称已被占用");
    }
  }
  const avatar = typeof payload.avatar === "string" ? payload.avatar : "";
  if (avatar && (avatar.length > 68000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar))) {
    throw new RequestError(400, "头像需为小于 50 KB 的 PNG、JPEG 或 WebP");
  }
  await store.setJSON(profileKey(user.id), { nickname, bio, accent, avatar, compact: payload.compact === true });
  return memberSettings(user);
}

export async function checkCanPublish(user) {
  if (user.role === "admin") return;
  const sanction = await getResponsesStore().get(sanctionKey(user.id), { type: "json" });
  if (Date.parse(sanction?.until) > Date.now()) {
    const date = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" })
      .format(new Date(sanction.until));
    throw new RequestError(403, `账号已禁言至 ${date}`);
  }
}

export async function listMembers() {
  const store = getResponsesStore();
  const { blobs } = await store.list({ prefix: "accounts/" });
  const members = [];
  for (let i = 0; i < blobs.length; i += 20) {
    const batch = await Promise.all(blobs.slice(i, i + 20).map(async ({ key }) => {
      const user = await store.get(key, { type: "json" });
      if (!user?.id) return null;
      const [{ nickname, mutedUntil, moderationReason }, code] = await Promise.all([
        memberSettings(user, { includeCode: false }), store.get(`member-codes/${user.id}.json`, { type: "json" })
      ]);
      return { id: user.id, code: code?.code || "", username: user.username, nickname, mutedUntil, moderationReason };
    }));
    members.push(...batch.filter(Boolean));
  }
  return members.sort((a, b) => a.username.localeCompare(b.username));
}

export async function setSanction(id, username, days, reason) {
  const store = getResponsesStore();
  const member = await store.get(`accounts/${username}.json`, { type: "json" });
  if (member?.id !== id) throw new RequestError(404, "未找到账号");
  const until = days ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
  await store.setJSON(sanctionKey(id), { until, reason: until ? reason.trim().slice(0, 160) : "" });
  return until;
}
