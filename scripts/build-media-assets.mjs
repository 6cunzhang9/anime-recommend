import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { SYNOPSES } from "./synopses.mjs";

const require = createRequire(import.meta.url);
const { ANIME_CATALOG } = require("../catalog.js");

const ROOT = path.resolve(import.meta.dirname, "..");
const COVER_FILE = path.join(ROOT, "scripts", "media-covers.json");
const LOCAL_COVER_FILE = path.join(ROOT, "scripts", "local-covers.json");
const OUTPUT = path.join(ROOT, "media-assets.js");

const covers = JSON.parse(await fs.readFile(COVER_FILE, "utf8"));
const localCovers = JSON.parse(await fs.readFile(LOCAL_COVER_FILE, "utf8"));
const missingCovers = ANIME_CATALOG.filter((anime) => !localCovers[anime.id]?.cover && !covers[anime.id]?.coverUrl).map((anime) => anime.id);
const missingSynopses = ANIME_CATALOG.filter((anime) => !SYNOPSES[anime.id]).map((anime) => anime.id);
if (missingCovers.length || missingSynopses.length) {
  throw new Error(`Missing assets: covers=${missingCovers.join(",")} synopses=${missingSynopses.join(",")}`);
}

const lines = [
  "/* 本命番推荐所 · 封面与简介",
  " * 封面地址来自 AniList 公开 API；简介为项目改写的短版剧情提示，不是官方文案。",
  " * 封面版权归原作者及权利方所有。",
  " */",
  "",
  "const ANIME_MEDIA = {"
];

for (const anime of ANIME_CATALOG) {
  const cover = covers[anime.id];
  const local = localCovers[anime.id];
  lines.push(
    `  ${JSON.stringify(anime.id)}: { cover: ${JSON.stringify(local?.cover || cover.coverUrl)}, remote: ${JSON.stringify(cover.coverUrl)}, color: ${JSON.stringify(cover.coverColor)}, synopsis: ${JSON.stringify(SYNOPSES[anime.id])} },`
  );
}

lines.push("};", "");
lines.push('if (typeof module !== "undefined" && module.exports) module.exports = { ANIME_MEDIA };', "");

await fs.writeFile(OUTPUT, lines.join("\n"), "utf8");
console.log(`Wrote ${ANIME_CATALOG.length} media records to ${OUTPUT}`);
