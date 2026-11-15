import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { getResponsesStore } from "./store.mjs";

const derive = promisify(scrypt);
const cookieName = "anime_soul_session";
const sessionSeconds = 30 * 24 * 60 * 60;
const adminSessionSeconds = 8 * 60 * 60;
const adminId = "00000000000000000000000000000000";

export const digest = (value) => createHash("sha256").update(value).digest("hex");
export const keyPart = /^[A-Za-z0-9_-]{6,100}$/;
export const usernamePattern = /^[a-z0-9_]{3,32}$/;

export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function readJson(req, maxBytes) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) {
    throw new RequestError(403, "请求来源不正确");
  }
  if (req.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw new RequestError(415, "需要 JSON 请求");
  }
  const raw = await req.text();
  if (Buffer.byteLength(raw) > maxBytes) throw new RequestError(413, "请求内容过长");
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new RequestError(400, "请求内容不是合法的 JSON 对象");
  }
}

function sessionKey(req) {
  const cookies = (req.headers.get("cookie") || "").split(";").map((part) => part.trim());
  const token = cookies.find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return /^[a-f0-9]{64}$/.test(token || "") ? `sessions/${digest(token)}.json` : null;
}

export async function getUser(req) {
  const key = sessionKey(req);
  if (!key) return null;
  const session = await getResponsesStore().get(key, { type: "json" });
  if (!session || session.expiresAt <= Date.now()) return null;
  if (session.user.role === "admin") {
    const secret = process.env.ADMIN_TOKEN;
    if (!secret || session.adminVersion !== digest(secret)) return null;
  }
  return session.user;
}

export function checkAccountContext(payload, user) {
  if (payload.account === true && (!user || (payload.account_username && payload.account_username !== user.username))) {
    throw new RequestError(401, "登录状态已变更，请刷新或重新登录");
  }
  if (payload.account === false && user) throw new RequestError(409, "已在其他页面登录，请刷新后再操作");
}

function cookie(req, value, age) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure}`;
}

export async function endSession(req) {
  const key = sessionKey(req);
  if (key) await getResponsesStore().delete(key);
  return cookie(req, "", 0);
}

export async function startSession(req, user) {
  const token = randomBytes(32).toString("hex");
  const store = getResponsesStore();
  const isAdmin = user.role === "admin";
  const seconds = isAdmin ? adminSessionSeconds : sessionSeconds;
  await store.setJSON(`sessions/${digest(token)}.json`, {
    user,
    expiresAt: Date.now() + seconds * 1000,
    ...(isAdmin && { adminVersion: digest(process.env.ADMIN_TOKEN) })
  });
  const previous = sessionKey(req);
  if (previous) await store.delete(previous);
  return cookie(req, token, seconds);
}

export async function verifyAccount(payload, register) {
  const username = typeof payload.username === "string" ? payload.username.trim().toLowerCase() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  if (username === "admin") {
    if (register) throw new RequestError(400, "请使用其他用户名注册");
    const token = process.env.ADMIN_TOKEN;
    if (!token || !timingSafeEqual(Buffer.from(digest(token), "hex"), Buffer.from(digest(password), "hex"))) {
      throw new RequestError(401, "用户名或密码不正确");
    }
    return { id: adminId, username, role: "admin" };
  }
  const bytes = Buffer.byteLength(password);
  if (!usernamePattern.test(username) || password.length < 10 || bytes > 128) {
    throw new RequestError(400, "用户名需为 3–32 位英文字母、数字或下划线，密码至少 10 个字符且最多 128 字节");
  }
  const store = getResponsesStore();
  const key = `accounts/${username}.json`;
  if (register) {
    const salt = randomBytes(16).toString("hex");
    const hash = (await derive(password, salt, 64)).toString("hex");
    const user = { id: randomBytes(16).toString("hex"), username };
    const result = await store.setJSON(key, { ...user, salt, hash }, { onlyIfNew: true });
    if (!result.modified) throw new RequestError(409, "这个用户名已被使用");
    return user;
  }
  const account = await store.get(key, { type: "json" });
  const candidate = await derive(password, account?.salt || "00000000000000000000000000000000", 64);
  const expected = account ? Buffer.from(account.hash, "hex") : Buffer.alloc(64);
  if (!timingSafeEqual(candidate, expected) || !account) throw new RequestError(401, "用户名或密码不正确");
  return { id: account.id, username: account.username };
}
