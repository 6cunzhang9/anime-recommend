import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");

const PUBLIC_FILES = [
  "index.html",
  "styles.css",
  "app.js",
  "watch-model.js",
  "experience.js",
  "taste-analysis.js",
  "series-data.js",
  "test-data.js",
  "catalog.js",
  "media-assets.js"
];

async function main() {
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  for (const filename of PUBLIC_FILES) {
    await fs.copyFile(path.join(ROOT, filename), path.join(DIST, filename));
  }

  await fs.cp(path.join(ROOT, "assets"), path.join(DIST, "assets"), { recursive: true });

  await fs.writeFile(
    path.join(DIST, "robots.txt"),
    "User-agent: *\nAllow: /\nDisallow: /api/\n",
    "utf8"
  );

  console.log(`Netlify publish directory ready: ${DIST}`);
  console.log(`Files: ${[...PUBLIC_FILES, "robots.txt"].join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
