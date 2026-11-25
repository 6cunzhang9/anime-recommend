import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const COVER_FILE = path.join(ROOT, "scripts", "media-covers.json");
const TARGET_DIR = path.join(ROOT, "assets", "covers");
const MANIFEST_FILE = path.join(ROOT, "scripts", "local-covers.json");
const covers = JSON.parse(await fs.readFile(COVER_FILE, "utf8"));

await fs.mkdir(TARGET_DIR, { recursive: true });
const manifest = {};
const entries = Object.entries(covers);
let cursor = 0;
let failed = 0;

async function worker() {
  while (cursor < entries.length) {
    const index = cursor;
    cursor += 1;
    const [id, cover] = entries[index];
    const extension = (new URL(cover.coverUrl).pathname.match(/\.([a-z0-9]+)$/i) || [null, "jpg"])[1].toLowerCase();
    const filename = `${id}.${extension}`;
    const destination = path.join(TARGET_DIR, filename);
    try {
      let existing = null;
      try {
        existing = await fs.stat(destination);
      } catch {
        // Download below.
      }
      if (!existing || existing.size < 1000) {
        const response = await fetch(cover.coverUrl, {
          headers: {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
            referer: "https://anilist.co/"
          }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length < 1000) throw new Error(`Suspiciously small image: ${bytes.length} bytes`);
        await fs.writeFile(destination, bytes);
      }
      manifest[id] = {
        cover: `assets/covers/${filename}`,
        remote: cover.coverUrl,
        color: cover.coverColor
      };
      console.log(`[${index + 1}/${entries.length}] ${filename}`);
    } catch (error) {
      failed += 1;
      console.error(`FAILED ${id}: ${error.message}`);
      manifest[id] = {
        cover: cover.coverUrl,
        remote: cover.coverUrl,
        color: cover.coverColor
      };
    }
  }
}

await Promise.all(Array.from({ length: 5 }, worker));
await fs.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2), "utf8");
console.log(`Downloaded ${entries.length - failed} / ${entries.length} covers; manifest ${MANIFEST_FILE}`);
if (failed) process.exitCode = 1;
