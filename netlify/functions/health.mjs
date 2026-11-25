import { jsonResponse } from "../shared/store.mjs";

export const config = {
  path: "/api/health",
  method: "GET"
};

export default async function handler() {
  return jsonResponse({
    ok: true,
    service: "anime-soul-lab",
    questionnaireVersion: "4.0.0",
    storage: process.env.ANIME_LOCAL_STORE ? "local-json" : "netlify-blobs",
    adminAuth: Boolean(process.env.ADMIN_TOKEN),
    accounts: true,
    externalSearch: true,
    time: new Date().toISOString()
  });
}
