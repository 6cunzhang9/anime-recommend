import assert from "node:assert/strict";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { discoverySignals } from "../netlify/shared/discovery-signals.mjs";
import { searchAnime } from "../netlify/shared/bangumi.mjs";
import discover from "../netlify/functions/discover.mjs";
import { startSession } from "../netlify/shared/auth.mjs";
import { changeWatchlist } from "../netlify/shared/watchlist.mjs";
import { getResponsesStore } from "../netlify/shared/store.mjs";
import { observationKey } from "../netlify/shared/observations.mjs";

const root = await mkdtemp(join(tmpdir(), "soul-lab-recommendations-"));
const file = join(root, "store.json");
const previousStore = process.env.ANIME_LOCAL_STORE;
process.env.ANIME_LOCAL_STORE = file;
const originalFetch = globalThis.fetch;
const base = "http://127.0.0.1/api/discover";
const row = (id, name, date, tags, platform = "TV") => ({
  id, type: 2, name, name_cn: name, date, platform, tags: tags.map((name) => ({ name })),
  rating: { score: 8, total: 100 }, summary: "成长与温暖"
});
const works = [
  row(80, "测试番", "2012-01-01", ["治愈", "日常", "温暖"]),
  row(81, "测试番 第二季", "2015-04-01", ["治愈", "日常", "温暖"]),
  row(82, "高度匹配老番", "1997-04-01", ["治愈", "日常", "温暖", "成长"]),
  row(83, "普通老番", "2004-04-01", ["战斗"]),
  row(84, "另一部 2014 番", "2014-04-01", ["成长"]),
  row(85, "显式避免的番", "2023-04-01", ["猎奇"])
];
for (const id of [81, 82, 84]) {
  works.find((item) => String(item.id) === String(id)).tags.push(
    { name: "成长" }, { name: "群像关系" }, { name: "喜剧调节" });
}
let calls = 0;
let throttled = false;
globalThis.fetch = async (url, options) => {
  const path = new URL(url);
  assert.equal(path.host, "api.bgm.tv");
  calls += 1;
  if (throttled) return Response.json({}, { status: 429, headers: { "Retry-After": "60" } });
  if (path.pathname.endsWith("/search/subjects")) {
    const { filter } = JSON.parse(options.body);
    const data = works.filter((item) => (filter.air_date || []).every((term) => {
      const match = term.match(/^(>=|<=|<)(.*)$/);
      if (!match) return true;
      return match[1] === ">=" ? item.date >= match[2] : match[1] === "<=" ? item.date <= match[2] : item.date < match[2];
    }) && (filter.tag || []).every((tag) => item.tags.some(({ name }) => name === tag)));
    return Response.json({ data });
  }
  const row = works.find((item) => String(item.id) === path.pathname.split("/").at(-1));
  return row ? Response.json(row) : Response.json({}, { status: 404 });
};

try {
  const answers = { q03: ["m_relax"], q09: ["set_everyday"], q13: ["drive_mood"],
    q18: ["char_growth"], q23: ["feel_warmth"], q38: ["avoid_cruelty"] };
  const weights = discoverySignals(answers);
  const broaderChoice = discoverySignals({ ...answers, q09: ["set_everyday", "set_school_youth", "set_fantasy", "set_history"] });
  assert.ok(broaderChoice.find(({ tag }) => tag === "日常").weight < weights.find(({ tag }) => tag === "日常").weight);

  const id = "f".repeat(32);
  const cookie = (await startSession(new Request(base), { id, username: "qa" })).split(";")[0];
  await changeWatchlist(id, { action: "add", status: "watched", work: { provider: "bangumi", provider_id: "80", title_display: "测试番", year: 2012 } });
  const seeded = getResponsesStore();
  for (const providerId of ["81", "82", "84"]) {
    const observation = {
      id: randomUUID(), owner: "e".repeat(32), owner_username: "recommendation-fixture",
      work: { provider: "bangumi", provider_id: providerId, title_display: `测试番 ${providerId}`,
        canonical_url: `https://bgm.tv/subject/${providerId}`, lookup_status: "matched" },
      axes: { pace: 75, cast_spread: 75 }, tags: ["coming_of_age", "ensemble_relation", "comedy_balance"],
      review: null, attachments: [], comment: "", created: new Date().toISOString(), updated: new Date().toISOString()
    };
    await seeded.setJSON(observationKey(observation.id), observation);
  }
  const recommend = async (settings) => {
    const response = await discover(new Request(base, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ assessment: { answers, favorites: [] }, ...settings }) }));
    const result = await response.json();
    assert.equal(response.status, 200, result.error);
    return result.items;
  };
  const featureTags = ["coming_of_age", "ensemble_relation", "comedy_balance"];
  const items = await recommend({ featureTags });
  assert.deepEqual(items.map((item) => item.provider_id), ["81", "84", "82"]);
  assert.equal(items.at(-1).older, true);
  assert.ok(items[0].overlap.includes("成长"));
  assert.deepEqual((await recommend({ featureTags, until: 2010 })).map((item) => item.provider_id), ["82", "83"]);

  const before = calls;
  await Promise.all(Array.from({ length: 12 }, () => searchAnime("相同查询", { limit: 4 })));
  await searchAnime("相同查询", { limit: 4 });
  assert.equal(calls - before, 1, "重复和并发查询应共用外部请求");
  throttled = true;
  await assert.rejects(searchAnime("触发上游限流", { limit: 4 }), /429/);
  const pausedAt = calls;
  await assert.rejects(searchAnime("另一个新查询", { limit: 4 }), /暂忙/);
  await searchAnime("相同查询", { limit: 4 });
  assert.equal(calls, pausedAt, "上游限流期间应从缓存响应，并暂停新的外部请求");
  console.log("Bangumi 推荐、跨年限制、同系列不同季、排斥项与并发缓存检查通过。");
} finally {
  globalThis.fetch = originalFetch;
  if (previousStore === undefined) delete process.env.ANIME_LOCAL_STORE;
  else process.env.ANIME_LOCAL_STORE = previousStore;
  await rm(file, { force: true });
  await rm(file + ".tmp", { force: true });
  await rmdir(root);
}
