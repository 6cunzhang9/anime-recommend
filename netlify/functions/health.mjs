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
    storage: "netlify-blobs",
    adminAuth: true,
    time: new Date().toISOString()
  });
}
