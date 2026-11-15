import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

let pending = Promise.resolve();
let records;

async function previousSamples() {
  const entries = new Map();
  if (process.env.ANIME_LOCAL_LEGACY !== "1") return entries;
  const directory = dirname(process.env.ANIME_LOCAL_STORE);
  const importers = {
    responses: (row) => row.response_id || row.id,
    ratings: (row) => row.id,
    reactions: (row) => row.responseId && row.animeId
      ? `${encodeURIComponent(row.responseId)}/${encodeURIComponent(row.animeId)}` : null
  };
  for (const [name, id] of Object.entries(importers)) {
    const file = await readFile(join(directory, `${name}.jsonl`), "utf8").catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    for (const line of file.split(/\r?\n/).filter(Boolean)) {
      try {
        const data = JSON.parse(line);
        const key = id(data);
        if (key) entries.set(`${name}/${key}.json`, { data, etag: randomUUID() });
      } catch { /* Preserve the original JSONL even if an old line is unreadable. */ }
    }
  }
  return entries;
}

async function data() {
  if (!records) {
    records = readFile(process.env.ANIME_LOCAL_STORE, "utf8")
      .then((text) => new Map(JSON.parse(text)))
      .catch((error) => {
        if (error.code === "ENOENT") return previousSamples();
        throw error;
      });
  }
  return records;
}

async function replaceFile(source, destination) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (process.platform !== "win32" || attempt >= 4 || !["EBUSY", "EACCES", "EPERM"].includes(error.code)) throw error;
      await delay(20 * 2 ** attempt);
    }
  }
}

function write(update) {
  const work = pending.then(async () => {
    const entries = await data();
    const next = new Map(entries);
    const result = update(next);
    if (!result.modified) return result;
    const file = process.env.ANIME_LOCAL_STORE;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file + ".tmp", JSON.stringify([...next]), { encoding: "utf8", mode: 0o600 });
    await replaceFile(file + ".tmp", file);
    records = Promise.resolve(next);
    return result;
  });
  pending = work.catch(() => {});
  return work;
}

export const localStore = {
  async get(key) { return structuredClone((await data()).get(key)?.data ?? null); },
  async getWithMetadata(key) { return structuredClone((await data()).get(key) ?? null); },
  async list({ prefix = "" } = {}) {
    return { blobs: [...(await data()).keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
  },
  setJSON(key, value, options = {}) {
    return write((entries) => {
      const previous = entries.get(key);
      if ((options.onlyIfNew && previous) || (options.onlyIfMatch && options.onlyIfMatch !== previous?.etag)) {
        return { modified: false };
      }
      const etag = randomUUID();
      entries.set(key, { data: JSON.parse(JSON.stringify(value)), etag });
      return { modified: true, etag };
    });
  },
  delete(key) { return write((entries) => ({ modified: entries.delete(key) })); }
};
