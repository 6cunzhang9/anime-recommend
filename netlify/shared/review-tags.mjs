import { createHash } from "node:crypto";
import watch from "../../watch-model.js";
import { getResponsesStore } from "./store.mjs";

export const proposalPrefix = "review-tags/";
export const defaultTags = Object.keys(watch.glossary);
export const proposalKey = (label) =>
  `${proposalPrefix}${createHash("sha256").update(watch.normalize(label)).digest("hex")}.json`;

export async function proposals() {
  const store = getResponsesStore();
  const { blobs } = await store.list({ prefix: proposalPrefix });
  const items = [];
  for (let start = 0; start < blobs.length; start += 20) {
    const rows = await Promise.all(blobs.slice(start, start + 20).map(({ key }) => store.get(key, { type: "json" })));
    items.push(...rows.filter(Boolean));
  }
  return items;
}

export function approvedTags(items) {
  return [...defaultTags, ...items.filter(({ status }) => status === "approved").map(({ label }) => label).sort((a, b) => a.localeCompare(b, "zh-CN"))];
}
