(function () {
  "use strict";

  const maxBytes = 480000;

  async function prepare(file) {
    if (!file?.type.startsWith("image/") || file.size > 15000000) throw new Error("请选择不超过 15 MB 的图片。");
    const bitmap = await createImageBitmap(file).catch(() => { throw new Error("无法打开这张图，请换用 JPG 或 PNG。"); });
    const canvas = document.createElement("canvas");
    const paint = canvas.getContext("2d", { alpha: false });
    let scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        paint.fillStyle = "white";
        paint.fillRect(0, 0, canvas.width, canvas.height);
        paint.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const image = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", .87));
        if (image?.size && image.size <= maxBytes) return image;
        scale *= .72;
      }
      throw new Error("无法处理这张图片，请裁剪后重试。");
    } finally {
      bitmap.close();
    }
  }

  async function searchImage(file) {
    const body = await prepare(file);
    const response = await fetch("/api/photo-search", {
      method: "POST", headers: { "Content-Type": body.type }, body, signal: AbortSignal.timeout(26000)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.error || "外部搜图暂时不可用，请稍后重试。");
    return data;
  }

  window.PHOTO_SEARCH = { searchImage };
})();
