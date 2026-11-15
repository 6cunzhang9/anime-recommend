import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import catalog from "../catalog.js";
import questionData from "../test-data.js";
import series from "../series-data.js";
import taste from "../taste-analysis.js";

const { ANIME_CATALOG } = catalog;
const { QUESTIONS } = questionData;
const dimensions = ANIME_CATALOG.map(taste.workDimensions);
assert.ok(ANIME_CATALOG.length >= 150);
assert.equal(new Set(dimensions.map((item) => JSON.stringify(item))).size, ANIME_CATALOG.length);
for (const values of dimensions) {
  assert.equal(Object.keys(values).length, Object.keys(taste.AXES).length);
  assert.ok(Object.values(values).every((value) => Number.isInteger(value) && value >= 0 && value <= 100));
}

const sandbox = createContext({ ...catalog, ...questionData, ANIME_TASTE: taste, ANIME_SERIES: series,
  document: { querySelector: () => null } });
const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
runInContext(source.replace("  init();", "  globalThis.engine = { state, deriveProfile, buildRecommendations };"), sandbox);
const { state, deriveProfile, buildRecommendations } = sandbox.engine;

let seed = 0xa11ce;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
}

function sampleAnswers() {
  const take = (options) => options[Math.floor(random() * options.length)].code;
  return Object.fromEntries(QUESTIONS.slice(0, 39).map((question) => {
    const { id, options, type, rows, rankCount } = question;
    if (type === "matrix") return [id, Object.fromEntries(rows.map((row) => [row.key, take(row.options)]))];
    if (type === "likert") {
      const index = Math.floor(random() * options.length);
      return [id, { value: index + 1, code: options[index].code }];
    }
    if (type === "rank") {
      const pool = [...options];
      return [id, Array.from({ length: rankCount }, () => pool.splice(Math.floor(random() * pool.length), 1)[0].code)];
    }
    if (type === "multi") return [id, [take(options)]];
    return [id, take(options)];
  }));
}

const reachable = new Set();
for (let i = 0; i < 180 && reachable.size < ANIME_CATALOG.length; i++) {
  state.answers = sampleAnswers();
  const normalized = taste.compile(state.answers, QUESTIONS);
  assert.deepEqual(taste.decode(normalized, QUESTIONS), state.answers);
  const favorites = [{ title_raw: "不在精选库的作品", reasons: [], external_ref: { provider: "manual", title_display: "不在精选库的作品" } }];
  const profile = deriveProfile(state.answers, favorites);
  const result = buildRecommendations(profile, favorites, { seed: String(i) });
  assert.equal(result.candidateCount, ANIME_CATALOG.length);
  for (const entry of result.top) if (entry.source !== "探索推荐") reachable.add(entry.anime.id);
  if (result.exploration.candidates.length) {
    const unseenIndex = result.exploration.candidates.findIndex((id) => !reachable.has(id));
    if (unseenIndex >= 0) {
      const rotated = buildRecommendations(profile, favorites, { exploreIndex: unseenIndex });
      assert.equal(rotated.top.at(-1).anime.id, result.exploration.candidates[unseenIndex]);
    }
    for (const id of result.exploration.candidates) reachable.add(id);
  }
}
const unreachable = ANIME_CATALOG.filter(({ id }) => !reachable.has(id));
assert.deepEqual(unreachable.map(({ title }) => title), [], "精选库存在永远不能进入推荐的作品");
console.log(`${reachable.size}/${ANIME_CATALOG.length} 部作品具有不同的标准向量和经过测评样本验证的推荐入口。`);
