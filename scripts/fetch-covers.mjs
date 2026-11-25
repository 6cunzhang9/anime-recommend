import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ANIME_CATALOG } = require("../catalog.js");

const ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT = path.join(ROOT, "scripts", "media-covers.json");
const BATCH_SIZE = 20;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchBatch(items) {
  const fields = "id coverImage { large extraLarge color }";
  const aliases = items
    .map((anime, index) => `a${index}: Media(id:${anime.anilistId}, type:ANIME) { ${fields} }`)
    .join("\n");
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "AnimeSoulLab/3.0 (local recommendation project)"
    },
    body: JSON.stringify({ query: `query { ${aliases} }` })
  });
  if (!response.ok) throw new Error(`AniList HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.data) throw new Error(JSON.stringify(payload.errors || payload));
  return payload.data;
}

async function main() {
  const covers = {};
  const items = ANIME_CATALOG.filter((anime) => anime.anilistId);
  for (let index = 0; index < items.length; index += BATCH_SIZE) {
    const batch = items.slice(index, index + BATCH_SIZE);
    const data = await fetchBatch(batch);
    batch.forEach((anime, aliasIndex) => {
      const media = data[`a${aliasIndex}`];
      covers[anime.id] = {
        coverUrl: media?.coverImage?.large || media?.coverImage?.extraLarge || "",
        coverColor: media?.coverImage?.color || anime.colors?.[1] || "#dfe5df"
      };
    });
    console.log(`fetched ${Math.min(index + BATCH_SIZE, items.length)} / ${items.length}`);
    await sleep(700);
  }
  await fs.writeFile(OUTPUT, JSON.stringify(covers, null, 2), "utf8");
  console.log(`Wrote ${Object.keys(covers).length} covers to ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
