import assert from "node:assert/strict";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import handler from "../netlify/functions/photo-search.mjs";

const dir = await mkdtemp(join(tmpdir(), "soul-lab-photo-"));
const store = join(dir, "data.json");
process.env.ANIME_LOCAL_STORE = store;
delete process.env.SAUCENAO_API_KEY;
delete process.env.SERPAPI_API_KEY;
const origin = "https://anime.test";
const endpoint = origin + "/api/photo-search";
const image = new Uint8Array([255, 216, 255, 217]);
const work = { id: 41001, name_cn: "外部检索的番剧", name: "Outside Title", type: 2,
  date: "2020-05-01", platform: "TV", tags: [], rating: { score: 8, total: 22 } };
const calls = [];
let mode = "frame";
globalThis.fetch = async (url, init = {}) => {
  const target = new URL(url);
  calls.push(target.hostname + target.pathname);
  if (target.hostname === "api.trace.moe") {
    assert.deepEqual(Array.from(new Uint8Array(await init.body.arrayBuffer())), Array.from(image));
    assert.equal(init.method, "POST");
    if (mode === "outage") return Response.json({}, { status: 429 });
    return Response.json({ result: [
      { similarity: .91, anilist: { id: 100, title: { native: "Outside Title" } } },
      { similarity: .95, anilist: { id: 101, isAdult: true, title: { native: "Adult Title" } } },
      { similarity: .65, anilist: { id: 102, title: { native: "Unrelated Title" } } }
    ].filter(() => mode === "frame") });
  }
  if (target.hostname === "saucenao.com") {
    assert.equal(init.body.get("api_key"), "test-sauce");
    assert.equal(init.body.get("file").type, "image/jpeg");
    return Response.json({ header: { status: 0 }, results: [{ header: { similarity: "93", index_id: 9 },
      data: { ext_urls: ["https://danbooru.donmai.us/posts/999", "https://invalid.test/posts/1"] } }] });
  }
  if (target.hostname === "danbooru.donmai.us") return Response.json({ rating: "g", tag_string_character: "screen_character" });
  if (target.hostname === "serpapi.com") {
    if (target.pathname === "/image") {
      assert.equal(init.body.get("api_key"), "test-lens");
      assert.equal(init.body.get("image").type, "image/jpeg");
      return Response.json({ image_id: "test-image-id" });
    }
    assert.equal(target.searchParams.get("image_id"), "test-image-id");
    return Response.json({ visual_matches: [{ title: "Lens Character | Fan Wiki", link: "https://invalid.test/wiki" }] });
  }
  assert.equal(target.hostname, "api.bgm.tv");
  if (target.pathname === "/v0/search/subjects") {
    const { keyword } = JSON.parse(init.body);
    return Response.json({ data: keyword === "Outside Title" ? [work] : [] });
  }
  if (target.pathname === "/v0/search/characters") {
    const { keyword } = JSON.parse(init.body);
    return Response.json({ data: [{ id: ["screen character", "Lens Character"].indexOf(keyword) + 51 }] });
  }
  assert.match(target.pathname, /^\/v0\/characters\/(51|52)\/subjects$/);
  return Response.json([work]);
};

const search = (body = image, headers = {}) => handler(new Request(endpoint, {
  method: "POST", headers: { "Content-Type": "image/jpeg", Origin: origin, ...headers }, body
}));

try {
  assert.deepEqual((await (await handler(new Request(endpoint))).json()).providers, ["trace.moe"]);
  assert.equal((await search(new Uint8Array([1, 2, 3]))).status, 400);
  assert.equal((await search(image, { Origin: "https://other.test" })).status, 403);
  assert.equal((await search(new Uint8Array(480001))).status, 413);
  assert.equal(calls.length, 0);
  const frame = await (await search()).json();
  assert.equal(frame.items[0].provider_id, "41001");
  assert.equal(frame.items[0].image_source, "trace.moe");
  assert.deepEqual(frame.clues.map(({ text }) => text), ["Outside Title"]);

  mode = "portrait";
  process.env.SAUCENAO_API_KEY = "test-sauce";
  process.env.SERPAPI_API_KEY = "test-lens";
  const sauce = await (await search()).json();
  assert.equal(sauce.items[0].image_source, "SauceNAO");
  assert.equal(sauce.clues[0].mode, "character");
  assert.ok(calls.every((call) => !call.startsWith("serpapi.com")));

  delete process.env.SAUCENAO_API_KEY;
  const lens = await (await search()).json();
  assert.equal(lens.items[0].image_source, "Google Lens");
  assert.equal(lens.clues[0].text, "Lens Character");
  assert.ok(!JSON.stringify(lens).includes("test-lens"));

  delete process.env.SERPAPI_API_KEY;
  const missed = await (await search()).json();
  assert.deepEqual(missed.items, []);
  assert.deepEqual(missed.clues, []);
  mode = "outage";
  assert.equal((await search()).status, 502);
  console.log("图片转发、外部截图和角色线索、Bangumi 查询、输入边界和服务故障检查通过。");
} finally {
  await rm(store, { force: true });
  await rm(store + ".tmp", { force: true });
  await rmdir(dir);
}
