import { checkCanPublish } from "../shared/members.mjs";
import { withdrawFavorite } from "../shared/posts.mjs";
import { checkAccountContext, getUser, keyPart, readJson, RequestError } from "../shared/auth.mjs";
import { deleteResponse, errorResponse, getResponsesStore, jsonResponse, responseKey } from "../shared/store.mjs";
import taste from "../../taste-analysis.js";
import testData from "../../test-data.js";
import v4 from "../../v4-validation.js";
import { changeEntry, packQuestionnaire, publicationFor } from "../shared/records.mjs";
import { ValidationError, validateQuestionnaire } from "../shared/validation.mjs";

const MAX_BODY_BYTES = 220 * 1024;

export const config = {
  path: "/api/responses",
  method: "POST",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: "ip",
    windowSize: 60,
    windowLimit: 10
  }
};

export default async function handler(req) {
  try {
    const payload = await readJson(req, MAX_BODY_BYTES);
    const user = await getUser(req);
    checkAccountContext(payload, user);

    if (!user) return errorResponse(401, "登录后即可匿名发布本命番并保存画像");
    if (payload.action === "delete") {
      if (typeof payload.response_id !== "string" || !keyPart.test(payload.response_id)) {
        return errorResponse(400, "测评编号无效");
      }
      await deleteResponse(payload.response_id, user.id);
      return jsonResponse({ ok: true });
    }

    if (payload.action === "withdraw") {
      if (typeof payload.response_id !== "string" || !keyPart.test(payload.response_id)) {
        return errorResponse(400, "测评编号无效");
      }
      const result = await withdrawFavorite(getResponsesStore(), user.id, payload.response_id);
      if (result.conflict) return errorResponse(409, "发言已变更，请重试");
      if (!result.record) return errorResponse(404, "发言不存在");
      return jsonResponse({ ok: true, publication: result.record.publication });
    }

    if (user) await checkCanPublish(user);
    const record = validateQuestionnaire(payload);
    if (!record.consent.profile_storage) return errorResponse(400, "需要保存测评才能发布");
    const archive = payload.import_local === true;
    const editing = payload.action === "update";
    if (!archive) {
      const works = record.actual_favorites.map(({ external_ref, title_raw }) =>
        v4.workIdentity(external_ref || { title_display: title_raw }));
      if (new Set(works).size !== works.length) return errorResponse(400, "同一部作品只可填写一次");
    }
    const key = responseKey(record.response_id, user.id);
    const result = await changeEntry(getResponsesStore(), key, (previous) => {
      if (editing && !previous) return null;
      const publication = publicationFor(previous || {}) || (!archive && !editing ? {
        published_at: record.received_at, moderated: false
      } : null);
      const analysis = !archive ? taste.compile(record.answers, testData.QUESTIONS) : null;
      return packQuestionnaire({
        ...record,
        ...(analysis && { analysis }),
        consent: { ...record.consent, similar_taste_anonymous_use: previous
          ? previous.consent?.similar_taste_anonymous_use === true : !archive || record.consent.similar_taste_anonymous_use },
        submitted_at: previous?.submitted_at || (archive ? record.submitted_at : record.received_at),
        ...(publication && { publication })
      });
    }, { createOnly: !editing });
    if (result.conflict) return errorResponse(409, "测评已变更，请重试");
    if (!result.record) return errorResponse(404, "测评已删除或不存在");
    return jsonResponse({ ok: true, id: record.response_id, publication: result.record.publication || null,
      duplicate: !result.modified, receivedAt: result.record.received_at }, result.modified ? 201 : 200);
  } catch (error) {
    if (error instanceof ValidationError || error instanceof RequestError) return errorResponse(error.status, error.message);
    console.error("responses function failed:", error);
    return errorResponse(500, "服务器保存问卷失败，请稍后再试");
  }
}
