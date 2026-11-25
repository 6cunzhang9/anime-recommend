/**
 * 作品搜索、追番、评价、找番和分享页面。
 * 对外通过 createWatchExperience 暴露节点构造函数；所有网络写入仍走 app.js 的 apiJson。
 */
(function (root) {
  "use strict";
  const model = root.WATCH_MODEL;
  function element(tag, text, cls) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  const control = (label, node) => {
    const field = element("label", label, "experience-field");
    field.append(node);
    return field;
  };
  const choice = (values, initial = "") => {
    const select = element("select");
    for (const [key, label] of values) {
      const option = element("option", label);
      option.value = key;
      select.append(option);
    }
    if (initial && [...select.options].some((option) => option.value === initial)) select.value = initial;
    else select.selectedIndex = Math.max(0, [...select.options].findIndex((option) => option.value === initial));
    return select;
  };
  const text = (input, value, max = 120) => {
    const node = element(input);
    node.value = value || "";
    node.maxLength = max;
    return node;
  };
  const link = (url, label) => {
    const node = element("a", label);
    node.href = url;
    node.target = "_blank";
    node.rel = "noopener noreferrer";
    return node;
  };
  const tagLink = (tag) => link(`https://bgm.tv/anime/tag/${encodeURIComponent(tag)}`, tag);

  const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  function radarLabel(g, label, cx, cy, angle, size, settings) {
    const maxWidth = size * .82;
    const lines = [];
    let line = "";
    for (const char of [...String(label)]) {
      const candidate = line + char;
      if (line && g.measureText(candidate).width > maxWidth) { lines.push(line); line = char; }
      else line = candidate;
    }
    if (line) lines.push(line);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = cx + cos * size * 1.32;
    const y = cy + sin * size * 1.30;
    g.textAlign = cos > .25 ? "left" : cos < -.25 ? "right" : "center";
    g.textBaseline = "middle";
    const offset = lines.length > 1 ? (lines.length - 1) * (settings.font || 17) * .58 : 0;
    for (let index = 0; index < lines.length; index += 1) {
      g.fillText(lines[index], x, y - offset + index * (settings.font || 17) * 1.16, maxWidth);
    }
  }

  function radar(canvas, values, max = 10, settings = {}) {
    const g = canvas.getContext("2d");
    if (!g) return;
    const entries = Object.entries(values || {});
    const { x = canvas.width / 2, y = canvas.height / 2, size = Math.min(canvas.width, canvas.height) * .30 } = settings;
    if (!settings.overlay) g.clearRect(0, 0, canvas.width, canvas.height);
    if (settings.surface) { g.fillStyle = settings.surface; g.fillRect(0, 0, canvas.width, canvas.height); }
    if (entries.length < 3) return;
    const points = (scale) => entries.map(([label], i) => {
      const angle = (i * 2 / entries.length - .5) * Math.PI;
      const reach = typeof scale === "number" ? scale : scale[i];
      return { label, angle, x: x + Math.cos(angle) * size * reach, y: y + Math.sin(angle) * size * reach };
    });
    const path = (array) => { g.beginPath(); array.forEach((point, i) => i ? g.lineTo(point.x, point.y) : g.moveTo(point.x, point.y)); g.closePath(); };
    const progress = Math.max(0, Math.min(1, settings.progress ?? 1));
    g.save();
    g.strokeStyle = settings.grid || "#c7d4c7";
    g.lineWidth = 1.4;
    g.globalAlpha = .7;
    for (const step of [.2, .4, .6, .8, 1]) { path(points(step)); g.stroke(); }
    for (const point of points(1)) { g.beginPath(); g.moveTo(x, y); g.lineTo(point.x, point.y); g.stroke(); }
    g.globalAlpha = 1;
    const ratios = entries.map(([, value]) => Math.max(0, Math.min(1, value / max)) * progress);
    path(points(ratios));
    g.fillStyle = settings.area || "rgba(37,117,90,.28)";
    g.strokeStyle = settings.outline || "#286f58";
    g.lineWidth = 3;
    g.fill(); g.stroke();
    g.fillStyle = settings.label || "#263d35";
    g.font = `${settings.font || 17}px "Microsoft YaHei", sans-serif`;
    g.globalAlpha = Math.max(0, (progress - .25) / .75);
    for (const point of points(1)) radarLabel(g, point.label, x, y, point.angle, size, settings);
    g.restore();
  }

  function radarPanel(values, max, options = {}) {
    const node = element("canvas", undefined, "taste-radar");
    node.width = options.width || 640;
    node.height = options.height || 420;
    node.setAttribute("role", "img");
    node.setAttribute("aria-label", Object.entries(values).map(([name, value]) => `${name} ${value} 分`).join("、"));
    const dark = !options.light && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const palette = options.light
      ? { grid: "#c9d9cf", label: "#20352c", area: "rgba(31,122,77,.20)", outline: "#1f7a4d" }
      : dark
        ? { surface: "#18221e", grid: "#698179", label: "#e4f0ea", area: "rgba(105,211,163,.35)", outline: "#8ce0b9" }
        : { surface: "#fbfdfb", grid: "#c7d4c7", label: "#20352c", area: "rgba(37,117,90,.18)", outline: "#286f58" };
    const draw = (progress) => radar(node, values, max, {
      ...palette, font: options.font || 17, size: options.size || Math.min(node.width, node.height) * .31, progress
    });
    if (!options.animate || reducedMotion() || !window.requestAnimationFrame) { draw(1); return node; }
    const started = performance.now();
    const frame = (now) => {
      draw(Math.min(1, (now - started) / 760));
      if (node.isConnected && now - started < 760) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return node;
  }

  function create(deps) {
    const { state, apiJson, openAccount, showToast, findWorks, renderWorkChoices, expandWorkResults, workLink, externalWorkLink,
      openWork, reviewWork, openBoard, openTextComposer, openShareComposer, rememberWork, textButton, sameWork, postCard } = deps;
    const busyButton = (name, run, className) => {
      const button = textButton(name, async () => {
        button.disabled = true;
        try { await run(button); }
        catch (error) { showToast(error.message); }
        finally { button.disabled = false; }
      }, className);
      return button;
    };
    const accountMutation = (url, payload) => apiJson(url, { ...payload, account: true, account_username: state.account?.username });
    const mediaUrl = (attachment) => attachment?.id ? `/api/media?id=${encodeURIComponent(attachment.id)}` : "";
    const mediaSize = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;

    function mediaGallery(attachments, className = "") {
      const list = (attachments || []).filter((item) => item?.id);
      if (!list.length) return null;
      const gallery = element("div", undefined, `media-gallery ${className}`.trim());
      const ordered = [...list.filter((item) => item.kind !== "file"), ...list.filter((item) => item.kind === "file")];
      for (const attachment of ordered) {
        const url = mediaUrl(attachment);
        if (attachment.kind === "image") {
          const image = element("img", undefined, "media-image");
          image.src = url;
          image.alt = attachment.name || "图片";
          image.loading = "lazy";
          gallery.append(image);
        } else if (attachment.kind === "video") {
          const video = element("video", undefined, "media-video");
          video.src = url;
          video.controls = true;
          video.preload = "metadata";
          gallery.append(video);
        } else {
          const file = link(url, `${attachment.name || "附件"} · ${mediaSize(attachment.size || 0)}`);
          file.className = "media-file";
          file.setAttribute("download", attachment.name || "attachment");
          gallery.append(file);
        }
      }
      return gallery;
    }

    function readAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("无法读取文件"));
        reader.readAsDataURL(file);
      });
    }

    function compressedImage(file) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= 1.4 * 1024 * 1024) return readAsDataUrl(file);
      return readAsDataUrl(file).then((source) => new Promise((resolve) => {
        const image = new Image();
        image.onerror = () => resolve(source);
        image.onload = () => {
          const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const context = canvas.getContext("2d");
          if (!context) { resolve(source); return; }
          context.fillStyle = "#fff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.84));
        };
        image.src = source;
      }));
    }

    async function uploadMedia(file) {
      const allowed = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm))$/;
      if (!allowed.test(file.type || "")) throw new Error("只支持图片和视频");
      const isCompressibleImage = /^image\/(jpeg|png|webp)$/.test(file.type);
      if (isCompressibleImage ? file.size > 8 * 1024 * 1024 : file.size > 3 * 1024 * 1024) {
        throw new Error(isCompressibleImage ? "图片不能超过 8 MB" : "视频不能超过 3 MB");
      }
      let data = await compressedImage(file);
      const match = data.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) throw new Error("无法读取文件");
      const size = Math.floor(match[2].length * 3 / 4);
      if (size > 3 * 1024 * 1024) throw new Error("压缩后仍超过 3 MB，请换一张图片");
      const response = await apiJson("/api/media", {
        account: true,
        account_username: state.account?.username,
        name: file.name,
        type: match[1],
        size,
        data
      }, 30000);
      return response.attachment;
    }

    function mediaPicker(initial = []) {
      const box = element("div", undefined, "composer-media");
      const input = element("input");
      input.type = "file";
      input.multiple = true;
      input.hidden = true;
      input.accept = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm";
      const add = element("button", "＋ 图片 / 视频", "media-add");
      add.type = "button";
      const previews = element("div", undefined, "media-previews");
      const status = element("p", "", "composer-media-status");
      status.setAttribute("role", "status");
      let attachments = (initial || []).slice(0, 4);
      let busy = false;
      function paint() {
        previews.replaceChildren();
        attachments.forEach((attachment, index) => {
          const item = element("div", undefined, "media-preview");
          if (attachment.kind === "image") {
            const image = element("img");
            image.src = mediaUrl(attachment);
            image.alt = "";
            item.append(image);
          } else if (attachment.kind === "video") {
            const video = element("video");
            video.src = mediaUrl(attachment);
            video.muted = true;
            video.preload = "metadata";
            item.append(video);
          } else {
            item.append(element("span", attachment.name || "附件", "media-file-name"));
          }
          const remove = element("button", "×", "media-remove");
          remove.type = "button";
          remove.setAttribute("aria-label", "移除附件");
          remove.addEventListener("click", () => { attachments.splice(index, 1); paint(); });
          item.append(remove);
          previews.append(item);
        });
        add.disabled = busy || attachments.length >= 4;
        status.textContent = busy ? "上传中…" : attachments.length >= 4 ? "最多 4 个附件" : "";
      }
      add.addEventListener("click", () => { if (!busy && attachments.length < 4) input.click(); });
      input.addEventListener("change", async () => {
        const files = [...input.files || []];
        input.value = "";
        if (!files.length) return;
        if (!state.account) { openAccount({ message: "登录后可上传附件。" }); return; }
        busy = true;
        paint();
        try {
          for (const file of files.slice(0, 4 - attachments.length)) {
            status.textContent = `上传 ${file.name}…`;
            attachments.push(await uploadMedia(file));
          }
        } catch (error) {
          showToast(error.message);
        } finally {
          busy = false;
          paint();
        }
      });
      box.append(add, input, previews, status);
      paint();
      return { node: box, read: () => attachments.slice(), isEmpty: () => attachments.length === 0 };
    }
    let tagCatalog;
    let tagCatalogTime = 0;
    function getTagCatalog() {
      if (!tagCatalog || Date.now() - tagCatalogTime > 30000) {
        tagCatalogTime = Date.now();
        tagCatalog = apiJson("/api/tags").catch((error) => {
          tagCatalog = null;
          throw error;
        });
      }
      return tagCatalog;
    }
    const requireAccount = (message) => {
      if (state.account) return true;
      openAccount({ message });
      return false;
    };
    function reviewEditor(initial, onChange = () => {}, { work } = {}) {
      const block = element("fieldset", undefined, "review-fields");
      block.append(element("legend", "作品评价"));
      const dims = element("div", undefined, "review-scores");
      const fields = {};
      for (const [key, label] of Object.entries(model.criteria)) {
        const options = [["", "请选择"], ...Array.from({ length: 10 }, (_, i) => [String(i + 1), `${i + 1} 分`])];
        const select = choice(options, String(initial?.dimensions?.[key] ?? ""));
        select.required = true;
        select.name = key;
        fields[key] = select;
        dims.append(control(label, select));
      }
      block.append(dims);
      let selected = model.tags(initial?.tags);
      const chips = element("div", undefined, "experience-chips");
      const suggestions = element("div", undefined, "experience-chips");
      const input = text("input", "", 28);
      input.type = "search";
      input.placeholder = "搜索或添加标签";
      const comment = text("textarea", initial?.comment, 600);
      comment.rows = 3;
      const chart = element("div");
      const read = () => ({
        dimensions: Object.fromEntries(Object.entries(fields).map(([key, select]) => [key, Number(select.value)])),
        tags: selected, comment: comment.value
      });
      const emit = () => {
        onChange(read());
        const clean = model.review(read());
        chart.replaceChildren();
        if (clean) chart.append(radarPanel(Object.fromEntries(Object.keys(clean.dimensions).map((key) =>
          [model.criteria[key], clean.dimensions[key]])), 10));
      };
      let related = [];
      let approved = Object.keys(model.glossary);
      const paint = () => {
        chips.replaceChildren(...selected.map((tag) => textButton(`${tag} ×`, () => {
          selected = selected.filter((item) => item !== tag); paint(); emit();
        })));
        const query = model.normalize(input.value);
        const available = model.tags([...related, ...approved], related.length + approved.length);
        suggestions.replaceChildren(...available.filter((tag) => !selected.includes(tag) && (!query || model.normalize(tag).includes(query)))
          .slice(0, 8).map((tag) => textButton(tag, () => add(tag), "text-button")));
      };
      const add = (tag) => {
        selected = model.tags([...selected, tag]);
        input.value = "";
        paint();
        emit();
      };
      input.addEventListener("input", paint);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); add(input.value); }
      });
      const tagsBox = element("div", undefined, "tag-composer");
      tagsBox.append(control("戳到我的点", input), textButton("添加标签", () => add(input.value)), chips, suggestions);
      block.append(tagsBox, control("具体评论", comment), chart);
      dims.addEventListener("change", emit);
      comment.addEventListener("input", () => onChange(read()));
      paint();
      getTagCatalog().then(({ tags }) => {
        approved = tags;
        if (block.isConnected) paint();
      }).catch(() => {});
      if (work?.provider === "bangumi") external(work).then((data) => {
        related = model.tags(data.items.flatMap((item) => item.tags), 12);
        if (block.isConnected) paint();
      }).catch(() => {});
      if (model.review(initial)) emit();
      return { node: block, read };
    }

    function preferencesPanel(initial, onChange) {
      const panel = element("div", undefined, "preferences-panel");
      const selected = model.choices(initial);
      for (const [key, label] of [["characters", "以下主角或角色人设，你最喜欢哪几项？"], ["art", "哪些画风更吸引你？"]]) {
        const section = element("fieldset", undefined, "tree-card");
        section.append(element("legend", label), element("p", "选填，最多选 4 项。", "tree-copy"));
        const chips = element("div", undefined, "experience-chips");
        for (const value of model.preferences[key]) {
          const button = textButton(value, () => {
            if (selected[key].includes(value)) selected[key] = selected[key].filter((item) => item !== value);
            else if (selected[key].length < 4) selected[key].push(value);
            else { showToast("最多选择 4 项。"); return; }
            button.setAttribute("aria-pressed", String(selected[key].includes(value)));
            onChange(model.choices(selected));
          });
          button.setAttribute("aria-pressed", String(selected[key].includes(value)));
          chips.append(button);
        }
        section.append(chips);
        panel.append(section);
      }
      return panel;
    }

    // 登录后在后台预取一次清单；点开列表时先画缓存，再静默刷新，避免整页等待。
    let watchRead;
    function getWatchlist() {
      const owner = state.account?.id;
      if (!watchRead || watchRead.owner !== owner || watchRead.expires < Date.now()) {
        const pending = { owner, expires: Date.now() + 120000, data: null, result: apiJson("/api/watchlist") };
        watchRead = pending;
        pending.result.then((data) => { pending.data = data; })
          .catch(() => { if (watchRead === pending) watchRead = null; });
      }
      return watchRead.result;
    }

    function watchlistSnapshot() {
      return watchRead?.owner === state.account?.id && watchRead.data ? watchRead.data : null;
    }

    function preloadWatchlist() {
      if (!state.account) return null;
      return getWatchlist().catch(() => null);
    }

    function overviewWatchlist() {
      return state.account ? getWatchlist() : Promise.resolve({ items: [], stats: null });
    }

    async function saveWatch(work, action, extra = {}) {
      const selected = work;
      rememberWork?.(selected);
      const data = await accountMutation("/api/watchlist", { work: selected, action, members: selected.members, ...extra });
      watchRead = null;
      return data;
    }
    function wantButton(work) {
      return busyButton("＋ 想看", async (button) => {
        if (!requireAccount("登录后可以把作品加入待追列表。")) return;
        const data = await saveWatch(work, "add", { status: "wanted" });
        button.textContent = data.item?.status === "watched" ? "已追" : "已在待追";
        showToast(data.item?.status === "watched" ? "这部作品已在已追列表。" : "已加入待追列表。");
      }, "outline-button");
    }

    function fitTags(container, items) {
      const chips = element("div", undefined, "experience-chips");
      for (const value of model.tags(items, 10)) chips.append(tagLink(value));
      container.append(chips);
    }
    function workTile(work) {
      const article = element("article", undefined, "tree-card watch-work");
      const heading = element("h3");
      heading.append(workLink(work));
      article.append(heading);
      const metadata = [work.year && `${work.year} 年`, work.studio,
        work.minutes && `${work.minutes} 分钟`, work.wanted && "待追清单"].filter(Boolean);
      if (metadata.length) article.append(element("p", metadata.join(" · "), "tree-copy"));
      if (work.internalTags?.length) fitTags(article, work.internalTags);
      return article;
    }

    function lookupPanel(pick, { mode = false, key = "" } = {}) {
      const box = element("section", undefined, "tree-card work-search-panel");
      const form = element("form", undefined, "tree-search");
      const chosen = choice([["title", "片名 / 别称"], ["character", "角色"], ["description", "剧情 / 标签"]]);
      const search = text("input", "", 120);
      search.type = "search";
      search.placeholder = "输入番名或别称";
      search.setAttribute("aria-label", "搜索内容");
      chosen.setAttribute("aria-label", "搜索方式");
      const submit = element("button", "搜索", "primary-button search-submit");
      const list = element("div", undefined, "tree-search-results");
      const status = element("p", "", "tree-copy");
      status.setAttribute("role", "status");
      if (mode) form.append(chosen);
      form.append(search, submit);
      let serial = 0;
      if (key && state.lookupMemory?.[key]) {
        const remembered = state.lookupMemory[key];
        search.value = remembered.query;
        chosen.value = remembered.mode;
        if (remembered.data) renderWorkChoices(list, remembered.data.items, pick, remembered.data);
      }
      chosen.addEventListener("change", () => {
        search.placeholder = { title: "输入番名或别称", character: "输入角色名", description: "输入剧情线索或标签，例如 校园 治愈" }[chosen.value];
      });

      async function run() {
        const query = search.value.trim();
        const searchMode = chosen.value;
        if (!query) { search.focus(); return; }
        const generation = ++serial;
        submit.disabled = true;
        list.replaceChildren();
        status.textContent = "正在搜索…";
        const display = (data) => {
          if (!box.isConnected || generation !== serial || search.value.trim() !== query || chosen.value !== searchMode) return;
          if (key) {
            state.lookupMemory ||= {};
            state.lookupMemory[key] = { query, mode: searchMode, data };
          }
          list.replaceChildren();
          status.textContent = data.items.length ? "" : data.fallback ? "作品索引暂时忙，请稍后重试。" : "未找到相关作品。";
          renderWorkChoices(list, data.items, pick, data);
        };
        try {
          const data = await findWorks(query, searchMode);
          display(data);
          if (searchMode === "title") expandWorkResults(data).then((grouped) => { if (grouped !== data) display(grouped); });
        } catch (error) { status.textContent = error.message; }
        finally { if (generation === serial) submit.disabled = false; }
      }

      if (key) search.addEventListener("input", () => {
        state.lookupMemory ||= {};
        const remembered = state.lookupMemory[key];
        if (!remembered || remembered.query !== search.value.trim()) state.lookupMemory[key] = { query: search.value, mode: chosen.value };
      });
      form.addEventListener("submit", (event) => { event.preventDefault(); run(); });
      box.append(form, status, list);
      return { node: box, searchBy: (query, mode = "title") => { search.value = query; chosen.value = mode; return run(); } };
    }

    function importTitles(input, filename = "") {
      if (/\.json$/i.test(filename)) {
        const data = JSON.parse(input);
        const rows = Array.isArray(data) ? data : data.items || data.data;
        if (!Array.isArray(rows)) throw new Error("JSON 文件应包含作品列表。");
        return rows.map((value) => typeof value === "string" ? value
          : value?.work?.title_display || value?.subject?.name_cn || value?.subject?.name || value?.title || value?.name_cn || value?.name);
      }
      if (/\.csv$/i.test(filename)) {
        const rows = input.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim()).map((line) =>
          (line.match(/"(?:[^"]|"")*"|[^,]+|(?<=,)(?=,)/g) || []).map((cell) => cell.replace(/^"|"$/g, "").replace(/""/g, '"').trim()));
        const header = rows[0]?.findIndex((cell) => /^(title|title_display|name_cn|name|作品名|番名|标题|番剧)$/i.test(cell));
        return header >= 0 ? rows.slice(1).map((row) => row[header]) : rows.map((row) => row[0]);
      }
      return input.split(/[\r\n、；;]+/).flatMap((line) => {
        const titles = [...line.matchAll(/《([^》]+)》/g)].map((match) => match[1]);
        if (titles.length) return titles;
        return [line.replace(/^\s*(?:[-*•]\s*|\d+[.、)]\s*)/, "")
          .replace(/^\s*(?:我)?(?:已经看过|看过|看完了?|追过|想看|待追|已追)\s*[：:]?\s*/, "").replace(/[。！？!?]$/, "")];
      });
    }

    function watchImport(status, refresh) {
      const box = element("section", undefined, "watch-import");
      box.id = "watch-import-panel";
      box.hidden = true;
      const content = text("textarea", "", 15000);
      content.rows = 4;
      content.placeholder = "每行填一部作品，例如 中二病一";
      const file = element("input");
      file.type = "file";
      file.accept = ".txt,.csv,.json,text/plain,text/csv,application/json";
      const feedback = element("p", "", "tree-copy");
      feedback.setAttribute("role", "status");
      const unresolved = element("div", undefined, "post-list");
      let results = [];
      const start = busyButton("开始匹配", async () => {
        const selectedFile = file.files?.[0];
        if (selectedFile?.size > 350000) throw new Error("请导入小于 350 KB 的文件。");
        const source = selectedFile ? await selectedFile.text() : content.value;
        const terms = [...new Set(importTitles(source, selectedFile?.name).filter((title) => typeof title === "string")
          .map((title) => title.trim()).filter((title) => title && title.length <= 120))];
        if (!terms.length || terms.length > 120) throw new Error("每次可导入 1–120 条作品名。");
        const owner = state.account?.username;
        results = [];
        unresolved.replaceChildren();
        for (let i = 0; i < terms.length; i += 8) {
          if (state.account?.username !== owner) return;
          feedback.textContent = `已处理 ${i}/${terms.length}…`;
          try {
            const data = await accountMutation("/api/watchlist", { action: "import", status, lines: terms.slice(i, i + 8) });
            results.push(...data.matches);
          } catch {
            results.push(...terms.slice(i, i + 8).map((input) => ({ input, items: [], retry: true })));
          }
        }
        const pending = results.filter((row) => !row.item);
        feedback.textContent = `已确认 ${results.length - pending.length} 条 · ${pending.length} 条待确认`;
        const addConfirmed = async (work) => {
          await saveWatch(work, status === "watched" ? "save" : "add", { status });
          watchRead = null;
          await refresh();
        };
        const pendingCard = (row) => {
          const card = element("section", undefined, "tree-card import-pending");
          const head = element("div", undefined, "import-pending-head");
          const name = element("div", undefined, "import-pending-name");
          name.append(element("h3", row.input));
          name.append(element("p", row.retry ? "索引暂时没有响应，可点右侧重试。" : "暂未确认到唯一作品，可重试或手动选择。", "tree-copy small-note"));
          const retry = busyButton("重试匹配", async () => {
            try {
              const data = await accountMutation("/api/watchlist", { action: "import", status, lines: [row.input] });
              const match = data.matches?.[0];
              if (match?.item) {
                card.remove();
                feedback.textContent = `已确认「${row.input}」并加入${status === "watched" ? "已追" : "待追"}。`;
                watchRead = null;
                await refresh();
                return;
              }
              row.items = match?.items || [];
              row.retry = match?.retry === true;
              card.replaceWith(pendingCard(row));
              showToast(row.items.length ? "仍未唯一匹配，请从候选中选择。" : "这次没有匹配到，可稍后重试或手动搜索。");
            } catch (error) {
              showToast(error.message);
            }
          }, "outline-button import-retry");
          head.append(name, retry);
          card.append(head);

          const picker = lookupPanel(async (work) => {
            try {
              await addConfirmed(work);
              card.remove();
            } catch (error) { showToast(error.message); }
          });
          if (row.items?.length) renderWorkChoices(card, row.items, async (work) => {
            try {
              await addConfirmed(work);
              card.remove();
            } catch (error) { showToast(error.message); }
          });
          const manual = element("details", undefined, "import-manual");
          manual.append(element("summary", "手动搜索或换一个条目"));
          manual.append(picker.node, textButton("按完整片名重查", () => picker.searchBy(row.input), "text-button"));
          card.append(manual);
          return card;
        };
        for (const row of pending) unresolved.append(pendingCard(row));
        watchRead = null;
        refresh();
      }, "primary-button");
      const form = element("div", undefined, "watch-import-fields");
      const toolbar = element("div", undefined, "watch-import-actions");
      toolbar.append(control("导入 TXT、CSV 或 JSON", file), start);
      form.append(control("粘贴片名", content), toolbar);
      box.append(form, feedback, unresolved);
      return box;
    }

    function inferredSeries(ref) {
      const title = String(ref?.title_display || ref?.title_canonical || "").trim();
      const match = title.match(/^(.*?)(?:\s*(?:第\s*[一二三四五六七八九十百零\d]+\s*[季期部篇]|season\s*\d+|s\d{1,2}|part\s*\d+|final season|最终季|完結篇|完结篇|剧场版|劇場版|电影版|電影版|ova|oad|特别篇|特別篇|番外篇|总集篇|總集篇|外传|外傳).*)$/i);
      const base = match?.[1]?.replace(/[\s:：·・,，。!！?？\-—_]+$/g, "").trim();
      if (!base || base.length < 2 || model.normalize(base) === model.normalize(title)) return null;
      return { id: `title:${model.normalize(base)}`, title: base };
    }

    async function renderWatchlist(container, status) {
      const isWatched = status === "watched";
      const list = element("div", undefined, "watch-items");
      const lookup = lookupPanel(async (work) => {
        try {
          await saveWatch(work, isWatched ? "save" : "add", { status });
          await refresh();
          showToast(isWatched ? "已记入已追。" : "已加入待追。");
        } catch (error) { showToast(error.message); }
      }, { key: status });
      const filter = choice([["", "全部"], ["favorite", "最喜欢"], ["like", "喜欢"], ["neutral", "一般"], ["dislike", "不喜欢"]]);
      const toolbar = element("section", undefined, "watch-tools");
      const importer = watchImport(status, refresh);
      const toggleImport = textButton("批量导入", () => {
        importer.hidden = !importer.hidden;
        toggleImport.setAttribute("aria-expanded", String(!importer.hidden));
        if (!importer.hidden) importer.scrollIntoView({ block: "nearest" });
      }, "outline-button watch-import-toggle");
      toggleImport.setAttribute("aria-controls", importer.id);
      toggleImport.setAttribute("aria-expanded", "false");
      toolbar.append(lookup.node, toggleImport, importer);
      container.append(toolbar);
      if (isWatched) {
        const filters = element("div", undefined, "watch-filters");
        filters.append(control("按喜爱程度筛选", filter));
        container.append(filters);
      }
      container.append(list);
      let current = [];
      let stats;
      let generation = 0;
      const cached = watchlistSnapshot();
      if (cached) {
        current = cached.items;
        stats = cached.stats;
      } else list.textContent = "正在读取清单…";

      function cardFor(item) {
        const card = workTile({ ...item.work, internalTags: item.internalTags });
        const actions = element("div", undefined, "experience-actions");
        if (isWatched) {
          const love = choice([["favorite", "最喜欢"], ["like", "喜欢"], ["neutral", "一般"], ["dislike", "不喜欢"]], item.love);
          love.setAttribute("aria-label", "喜爱程度");
          love.addEventListener("change", async () => {
            try { await saveWatch(item.work, "save", { status, love: love.value }); refresh(); }
            catch (error) { showToast(error.message); }
          });
          actions.append(love, element("span", `${item.plays} 刷`), busyButton("再刷一次", async () => {
            await saveWatch(item.work, "rewatch"); refresh();
          }));
        } else {
          actions.append(busyButton("记为已追", async () => {
            await saveWatch(item.work, "save", { status: "watched" }); refresh();
          }));
        }
        actions.append(textButton("分享观察", () => openShareComposer(item.work)), busyButton("移除", async () => {
          await saveWatch(item.work, "remove"); refresh();
        }, "text-button"));
        card.append(actions);
        return card;
      }

      function paint() {
        list.replaceChildren();
        if (isWatched && stats) {
          const overview = element("section", undefined, "tree-card watch-overview");
          overview.append(element("h3", `已追 ${stats.watched} 部 · 重刷 ${stats.rewatches} 次`));
          if (stats.internalTags?.length) { overview.append(element("p", "共同作品特征", "tree-copy")); fitTags(overview, stats.internalTags); }
          if (stats.dimensions) overview.append(radarPanel(Object.fromEntries(Object.entries(stats.dimensions)
            .map(([key, value]) => [model.criteria[key], value])), 10));
          list.append(overview);
        }
        const matches = current.filter((item) => item.status === status && (!filter.value || item.love === filter.value));
        if (!matches.length) {
          const empty = element("div", undefined, "watch-empty");
          empty.append(element("h2", filter.value ? "没有符合筛选的作品" : `${isWatched ? "已追" : "待追"}清单还是空的`),
            element("p", filter.value ? "可以换一个喜爱程度试试。" : "搜索番名添加，或批量导入已有清单。"));
          list.append(empty);
        }
        const series = new Map();
        const singles = [];
        for (const item of matches) {
          const ref = item.work;
          const explicitParent = current.find((entry) => entry.work.provider === "bangumi-series" &&
            entry.status === status && entry.members?.includes(ref.provider_id));
          const inferred = inferredSeries(ref);
          const id = ref.provider === "bangumi-series" ? ref.provider_id
            : ref.series_id || explicitParent?.work.provider_id || inferred?.id;
          if (!id) { singles.push(item); continue; }
          if (!series.has(id)) {
            series.set(id, {
              title: ref.series_title || explicitParent?.work.title_display || inferred?.title || ref.title_display,
              entries: []
            });
          }
          series.get(id).entries.push(item);
        }
        for (const { title, entries } of series.values()) {
          const details = element("details", undefined, "series-result watch-series");
          details.open = true;
          const label = element("summary", `${title} · 系列（清单内 ${entries.length} 部）`);
          const rows = element("div", undefined, "series-options");
          details.append(label, rows);
          for (const entry of entries) rows.append(cardFor(entry));
          list.append(details);
        }
        for (const item of singles) list.append(cardFor(item));
      }

      async function refresh() {
        const request = ++generation;
        try {
          const data = await getWatchlist();
          if (!list.isConnected || request !== generation) return;
          current = data.items;
          stats = data.stats;
          paint();
        } catch (error) { if (list.isConnected) list.textContent = error.message; }
      }
      filter.addEventListener("change", paint);
      if (cached) paint();
      await refresh();
    }

    function renderSearch(container) {
      const search = lookupPanel(openWork, { mode: true, key: "search" });
      container.append(element("h1", "搜番剧", "workspace-title"), search.node);
      const photo = element("details", undefined, "tree-card photo-search");
      const file = element("input");
      file.type = "file";
      file.accept = "image/*";
      const camera = element("input");
      camera.type = "file";
      camera.accept = "image/*";
      camera.setAttribute("capture", "environment");
      const canCapture = navigator.userAgentData?.mobile === true ||
        /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const status = element("p", "", "tree-copy");
      status.setAttribute("role", "status");
      const disclosure = element("p", "", "tree-copy");
      const results = element("div", undefined, "tree-search-results");
      let sources;
      const upload = async () => {
        const image = camera.files?.[0] || file.files?.[0];
        if (!image) { status.textContent = "请先选择图片。"; return; }
        results.replaceChildren();
        status.textContent = "正在搜图并查询 Bangumi…";
        try {
          const found = await PHOTO_SEARCH.searchImage(image);
          if (!results.isConnected) return;
          if (found.items.length) {
            status.textContent = "请确认匹配到的番剧。";
            for (const work of found.items) {
              const row = element("button", undefined, "tree-search-result");
              row.type = "button";
              row.append(element("strong", work.title_display), element("span", [work.year, work.image_source].filter(Boolean).join(" · ")));
              row.addEventListener("click", () => openWork(work));
              results.append(row);
            }
          } else if (found.clues.length) {
            status.textContent = found.catalogUnavailable ? "Bangumi 暂时没有响应，可用搜图线索重查。"
              : "还没定位到番剧，可用搜图获得的线索重查。";
            for (const clue of found.clues) {
              results.append(textButton(`${clue.text} · ${clue.source}`, () =>
                search.searchBy(clue.text, clue.mode === "character" ? "character" : "title"), "outline-button"));
            }
          } else status.textContent = sources.length === 1 ? "暂未找到相符的正片截图。角色图或海报需要开通插画或网页搜图来源。"
            : "这张图暂未搜到可用的作品或角色线索。";
        } catch (error) { status.textContent = error.message; }
      };
      const button = busyButton("搜图", upload, "primary-button");
      button.disabled = true;
      photo.addEventListener("toggle", () => {
        if (!photo.open || sources) return;
        status.textContent = "正在确认可用的搜图来源…";
        apiJson("/api/photo-search").then(({ providers }) => {
          sources = providers;
          disclosure.textContent = `点击搜图会把图片发送给已启用的外部服务（${providers.join("、")}）。本站不保存图片。`;
          status.textContent = providers.length === 1 ? "当前已启用正片截图搜索。" : "";
          button.disabled = false;
        }).catch((error) => { status.textContent = error.message; });
      });
      file.addEventListener("change", () => { camera.value = ""; });
      camera.addEventListener("change", () => { file.value = ""; });
      photo.append(element("summary", canCapture ? "拍照或选图片" : "图片搜番"), control("选择海报或图片", file));
      if (canCapture) photo.append(control("用相机拍摄", camera));
      photo.append(disclosure, button, status, results);
      container.append(photo);
    }

    async function renderWorkDetail(container, reference) {
      const area = element("div");
      container.append(area);
      area.textContent = "正在读取作品详情…";
      try {
        let ref = reference;
        const localSnapshot = ref.provider === "anilist-candidate-snapshot";
        if (!localSnapshot && !["bangumi", "bangumi-series", "anilist"].includes(ref.provider)) {
          const lookup = await findWorks(ref.title_display);
          const sameYear = lookup.items.filter((item) => Number(item.year) === Number(ref.year) && sameWork(item, ref));
          ref = sameYear.length === 1 ? sameYear[0] : lookup.exact || ref;
        }
        const detail = ["bangumi", "bangumi-series"].includes(ref.provider)
          ? await apiJson(`/api/anime-search?id=${ref.provider_id}`, undefined, 7000).catch(() => ({ work: ref, items: [] }))
          : ref.provider === "anilist"
            ? await apiJson(`/api/anime-search?id=${ref.provider_id}&source=anilist`, undefined, 7000)
              .catch(() => ({ work: ref, items: [] }))
            : { work: ref, items: [] };
        if (!area.isConnected) return;
        const work = { ...ref, ...detail.work };
        if (!work.title_display) { area.textContent = "暂时无法读取作品详情。"; return; }
        rememberWork?.(work);
        if (ref.provider === "bangumi-series") {
          work.provider = "bangumi-series";
          work.title_display = ref.title_display || detail.series?.title || work.title_display;
          work.members = detail.items.map(({ provider_id }) => provider_id);
        }
        const card = workTile(work);
        if (work.cover) {
          const image = element("img", undefined, "detail-cover");
          image.src = work.cover;
          image.alt = work.title_display + " 海报";
          card.prepend(image);
        }
        if (work.aliases?.length) card.append(element("p", work.aliases.join(" · "), "tree-copy"));
        const tools = element("div", undefined, "experience-actions");
        tools.append(wantButton(work), busyButton("记为已追", async () => {
          if (!requireAccount("登录后可以保存已追记录。")) return;
          await saveWatch(work, "save", { status: "watched" });
          showToast("已记入已追。");
        }), textButton("分享观察", () => openShareComposer(work)), externalWorkLink(work));

        card.append(tools);
        area.replaceChildren(card);
        const featurePanel = element("section", undefined, "tree-card work-feature-panel");
        featurePanel.append(element("h3", "作品特征"));
        const featureStatus = element("p", "正在读取作品特征…", "tree-copy");
        featurePanel.append(featureStatus);
        area.append(featurePanel);
        const query = new URLSearchParams({
          provider: work.provider, id: String(work.provider_id || ""), title: work.title_display || ""
        });
        apiJson(`/api/work-features?${query}`, undefined, 8000).then((data) => {
          if (!featurePanel.isConnected) return;
          const profile = data.profile;
          featureStatus.remove();
          const axes = element("div", undefined, "work-feature-axes");
          for (const axis of profile.axes) {
            const row = element("div", undefined, "work-feature-axis");
            row.append(element("span", axis.label));
            row.append(element("strong", axis.value === null ? "资料不足" : `${axis.value} / 100`,
              axis.value === null ? "is-missing" : ""));
            row.append(element("small", axis.count ? `${axis.count} 条内部证据` : "等待内部标注", "tree-copy"));
            axes.append(row);
          }
          const tagBox = element("div", undefined, "work-feature-tags");
          for (const tag of profile.tags) {
            const chip = element("span", tag.present ? tag.label : `${tag.label} · 资料不足`,
              `feature-tag ${tag.present ? "is-known" : "is-missing"}`);
            chip.title = tag.definition;
            tagBox.append(chip);
          }
          const meta = element("p", [
            profile.work?.year ? `${profile.work.year} 年` : "", profile.work?.studio,
            profile.work?.media_type ? profile.work.media_type.toUpperCase() : ""
          ].filter(Boolean).join(" · "), "tree-copy");
          featurePanel.append(axes, tagBox, meta);
          if (profile.rating?.count) {
            featurePanel.append(element("p", `站内评分 ${profile.rating.value} / 5 · ${profile.rating.count} 条`, "tree-copy"));
          }
          if (profile.comments?.dimensions?.length) {
            const consensus = element("div", undefined, "comment-consensus");
            consensus.append(element("h4", `评论共识 · ${profile.comments.comments} 条`));
            for (const row of profile.comments.dimensions) {
              const line = element("p", `${row.label} ${row.value} / 10`);
              line.append(element("span", `出现 ${Math.round(row.frequency * 100)}% · 权重 ${row.count}`));
              consensus.append(line);
            }
            featurePanel.append(consensus);
          }
        }).catch((error) => {
          if (featureStatus.isConnected) featureStatus.textContent = error.message;
        });
        const related = detail.items.filter((item) => item.provider_id !== work.provider_id || work.provider === "bangumi-series");
        if (related.length) {
          const panel = element("section", undefined, "tree-card");
          panel.append(element("h3", "同系列作品"));
          for (const item of related) {
            const line = element("p");
            line.append(workLink(item, [item.title_display, item.year].filter(Boolean).join(" · ")));
            panel.append(line);
          }
          area.append(panel);
        }
      } catch (error) { area.textContent = error.message; }
    }

    function renderOnlinePicks(container, works, { rate } = {}) {
      for (const work of works) {
        const card = workTile(work);
        if (work.overlap?.length) card.append(element("p", `契合的看点 · ${work.overlap.join("、")}`, "tree-copy"));
        const actions = element("div", undefined, "experience-actions");
        actions.append(wantButton(work));
        if (rate) actions.append(textButton("写评价", () => rate(work)));
        card.append(actions);
        container.append(card);
      }
    }

    function renderDiscovery(container) {
      container.append(element("h1", "想追番了", "workspace-title"));
      const form = element("form", undefined, "tree-card discover-form");
      const opts = {};
      const add = (key, label, node) => { opts[key] = node; form.append(control(label, node)); };
      const number = (min, max, step = 1) => {
        const field = text("input");
        field.type = "number";
        Object.assign(field, { min, max, step });
        return field;
      };
      add("mode", "这次想看", choice([["similar", "看点相似"], ["different", "换种口味"]], "similar"));
      add("queue", "待追作品", choice([["consider", "纳入考虑"], ["prefer", "优先考虑"], ["exclude", "排除"]], "consider"));
      add("type", "作品类型", choice([["", "不限"], ["side", "已看过系列的番外"], ["movie", "剧场版"], ["ordinary", "普通番剧"]]));
      add("popularity", "热度", choice([["", "不限"], ["rare", "冷门"], ["popular", "热门"]]));
      add("since", "最早年份", number(1900, 2100));
      add("until", "最晚年份", number(1900, 2100));
      add("theme", "特殊主题", text("input", "", 28));
      const dimensions = [];
      const tags = [];
      const featureSection = element("fieldset", undefined, "review-fields discover-features");
      featureSection.append(element("legend", "作品特征"));
      const featureAxes = {};
      const axisGrid = element("div", undefined, "feature-request-grid");
      for (const axis of FEATURE_MODEL.AXES) {
        const select = choice([["", "不限"], ...FEATURE_MODEL.LEVELS.map((level) => [String(level), String(level)])]);
        select.setAttribute("aria-label", axis.label);
        select.addEventListener("change", () => {
          if (select.value) featureAxes[axis.id] = Number(select.value);
          else delete featureAxes[axis.id];
        });
        axisGrid.append(control(axis.label, select));
      }
      const featureTags = [];
      const featureTagBox = element("div", undefined, "feature-tags");
      for (const tag of FEATURE_MODEL.TAGS) {
        const button = textButton(tag.label, () => {
          const index = featureTags.indexOf(tag.id);
          if (index >= 0) featureTags.splice(index, 1);
          else if (featureTags.length < 12) featureTags.push(tag.id);
          else { showToast("最多选择 12 个标签。"); return; }
          button.setAttribute("aria-pressed", String(featureTags.includes(tag.id)));
        });
        button.className = "feature-tag";
        button.setAttribute("aria-pressed", "false");
        button.title = tag.definition;
        featureTagBox.append(button);
      }
      featureSection.append(axisGrid, featureTagBox);
      form.append(featureSection);
      const submit = element("button", "推荐下一部", "primary-button");
      form.append(submit);
      const status = element("p", "", "tree-copy");
      status.setAttribute("role", "status");
      const results = element("div");
      container.append(form, status, results);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        submit.disabled = true;
        status.textContent = "正在从 Bangumi 找番…";
        results.replaceChildren();
        try {
          const values = Object.fromEntries(Object.entries(opts).map(([key, node]) => [key, node.value]));
          const scoresRequested = [...dimensions];
          const tagsRequested = [...tags];
          const data = await apiJson("/api/discover", {
            ...values,
            dimensions: scoresRequested,
            tags: tagsRequested,
            featureTags,
            featureAxes
          }, 15000);
          for (const work of data.items) {
            const card = workTile(work);
            if (work.overlap?.length) card.append(element("p", `共同作品特征 · ${work.overlap.join("、")}`, "tree-copy"));
            if (work.reasonMatches?.length) card.append(element("p", `戳到你的点 · ${work.reasonMatches.join("、")}`, "tree-copy"));
            if (work.axisFit) card.append(element("p", `特征接近度 ${work.axisFit}%`, "tree-copy"));
            if (work.community) {
              const points = [...new Set(scoresRequested.map(({ axis }) => axis))];
              if (!points.includes("average")) points.unshift("average");
              const labels = points.map((key) => `${dimensionLabels[key]} ${work.community.scores[key]} 分`);
              card.append(element("p", `交流中心 ${work.community.count} 人评价 · ${labels.join(" · ")}`, "tree-copy"));
              if (tagsRequested.length) card.append(element("p", `评价标签 · ${tagsRequested.join("、")}`, "tree-copy"));
            }
            card.append(wantButton(work));
            results.append(card);
          }
          status.textContent = data.series && !data.series.total
            ? data.series.watched ? "已追作品暂未定位到 Bangumi 系列。可在追番列表中搜索并添加对应条目。"
              : "请先把看过的作品或系列加入已追列表。"
            : data.items.length ? `找到 ${data.items.length} 部${data.fallback ? "（本地候选）" : ""}` : "这组条件下暂无候选，可以调整筛选。";
          if (data.series?.checked < data.series?.total) status.textContent += ` 已查到 ${data.series.checked}/${data.series.total} 条已追作品的系列关系。`;
        } catch (error) { status.textContent = error.message; }
        finally { submit.disabled = false; }
      });
    }

    function external(work) {
      const params = new URLSearchParams({ provider: work.provider, id: work.provider_id, title: work.title_display,
        name: work.title_canonical || work.title_display, year: work.year || "", format: work.media_type || "" });
      return apiJson(`/api/external-comments?${params}`, undefined, 9400);
    }

    async function renderThread(container, id, initial) {
      const source = element("section", undefined, "tree-card external-insights");
      const forum = element("div");
      const status = element("p", "正在打开帖子…", "tree-copy");
      forum.append(status);
      container.append(forum, source);
      source.hidden = true;
      const mutate = async (payload) => {
        if (!requireAccount("登录后可以点赞、收藏或跟帖。")) return;
        const data = await accountMutation("/api/thread", { ...payload, post: id });
        paint(data);
      };
      function paint(data) {
        if (!forum.isConnected) return;
        const card = postCard(data.post, { detail: true });
        card.append(busyButton(`${data.liked ? "取消赞" : "点赞"} · ${data.stats.likes}`, () =>
          mutate({ action: "like-post", active: !data.liked })),
        busyButton(data.bookmarked ? "取消收藏" : "收藏", () =>
          mutate({ action: "bookmark", active: !data.bookmarked })));
        const replies = element("section", undefined, "thread-replies");
        const replyTo = (reply) => openTextComposer({ post: data.post, reply, onReply: (result) => {
          if (forum.isConnected) paint(result);
          else if (state.screen === "tree" && state.treeTab === "thread" && state.currentPost === id) {
            container.replaceChildren();
            renderThread(container, id, result);
          }
        } });
        const header = element("div", undefined, "thread-replies-head");
        header.append(element("h2", "跟帖"), textButton("写跟帖", () => replyTo(null), "primary-button"));
        replies.append(header);
        if (!data.replies.length) replies.append(element("p", "还没有回复。", "tree-copy"));
        const grouped = new Map();
        for (const reply of data.replies) {
          const list = grouped.get(reply.parent) || [];
          list.push(reply);
          grouped.set(reply.parent, list);
        }
        const markup = (reply) => {
          const node = element("article", undefined, "tree-card thread-reply");
          node.append(element("p", reply.deleted ? "这条回复已删除" : reply.text));
          if (!reply.deleted) {
            const gallery = mediaGallery(reply.attachments);
            if (gallery) node.append(gallery);
          }
          if (!reply.deleted) {
            const actions = element("div", undefined, "experience-actions");
            actions.append(busyButton(`${reply.liked ? "取消赞" : "赞"} · ${reply.likes}`, () =>
              mutate({ action: "like-reply", reply: reply.id, active: !reply.liked }), "text-button"),
            textButton("回复", () => replyTo(reply), "text-button"));
            if (reply.canDelete) actions.append(busyButton("删除", () =>
              mutate({ action: "delete", reply: reply.id }), "text-button danger-text"));
            node.append(actions);
          }
          return node;
        };
        for (const reply of grouped.get(null) || []) {
          const root = markup(reply);
          for (const child of grouped.get(reply.id) || []) {
            const item = markup(child);
            item.classList.add("nested");
            root.append(item);
          }
          replies.append(root);
        }
        forum.replaceChildren(card, replies);
      }
      try {
        const data = initial || await apiJson(`/api/thread?post=${encodeURIComponent(id)}`);
        paint(data);
        if (!data.post.works.length) return;
        source.hidden = false;
        source.append(element("h2", "站外高赞评论"), element("p", "正在匹配相关作品…", "tree-copy"));
        const outputs = await Promise.allSettled(data.post.works.map((entry) => external(entry.external_ref)));
        if (!source.isConnected) return;
        source.replaceChildren(element("h2", "站外高赞评论"));
        const seen = new Set();
        const unavailable = outputs.some((result) => result.status === "rejected" || result.value?.unavailable);
        for (const result of outputs) {
          if (result.status !== "fulfilled") continue;
          for (const item of result.value.items) {
            if (seen.has(item.url)) continue;
            seen.add(item.url);
            const line = element("div", undefined, "outside-row");
            line.append(link(item.url, `${item.source} · ${item.likes} 次互动 ↗`));
            fitTags(line, item.tags);
            source.append(line);
          }
        }
        if (!seen.size) source.append(element("p", unavailable ? "站外评论暂时无法读取。" : "暂未找到这部作品的高赞评论。", "tree-copy"));
        for (const result of outputs) if (result.status === "fulfilled") {
          for (const item of result.value.links || []) if (!seen.has(item.url)) {
            seen.add(item.url); source.append(link(item.url, `到 ${item.source} 看原讨论 ↗`));
          }
        }
      } catch (error) { status.textContent = error.message; }
    }


    async function renderShared(container, token) {
      container.textContent = "正在打开番剧概览…";
      try {
        const data = await apiJson(`/api/reading-share?share=${encodeURIComponent(token)}`);
        const poster = data.poster || {};
        const page = element("article", undefined, "shared-overview");
        const hero = element("header", undefined, "shared-overview-hero");
        hero.append(element("p", "ANIME SOUL LAB · SHARED", "shared-kicker"));
        hero.append(element("h1", poster.identity?.name ? `${poster.identity.name} 的番剧概览` : "一份番剧概览"));
        if (poster.identity?.code) hero.append(element("p", `#${poster.identity.code}`, "shared-identity"));
        page.append(hero);
        if (poster.count !== undefined && !poster.stats) {
          const stats = element("div", undefined, "shared-stats");
          const cell = element("div", undefined, "shared-stat");
          cell.append(element("strong", String(poster.count)), element("span", "部已追"));
          stats.append(cell);
          page.append(stats);
        }
        if (poster.stats) {
          const stats = element("div", undefined, "shared-stats");
          for (const [label, value] of [["阅番", poster.stats.watched], ["测评", poster.stats.records],
            ["评价", poster.stats.ratings], ["重刷", poster.stats.rewatches], ["活跃天数", poster.stats.activeDays]]) {
            if (value === undefined) continue;
            const cell = element("div", undefined, "shared-stat");
            cell.append(element("strong", String(value)), element("span", label));
            stats.append(cell);
          }
          page.append(stats);
        }
        const charts = element("div", undefined, "shared-charts");
        if (Array.isArray(poster.axes) && poster.axes.length) {
          const card = element("section", undefined, "tree-card shared-chart");
          card.append(element("h2", "八轴审美坐标"));
          card.append(radarPanel(Object.fromEntries(poster.axes.map((axis) => [axis.label, axis.value ?? 50])), 100));
          if (poster.axes.some((axis) => axis.value === null)) card.append(element("p", "部分轴暂无内部证据，图中按中线显示。", "annual-chart-note"));
          charts.append(card);
        }
        if (Array.isArray(poster.reviews) && poster.reviews.length) {
          const card = element("section", undefined, "tree-card shared-chart");
          card.append(element("h2", "七维作品评价"));
          card.append(radarPanel(Object.fromEntries(poster.reviews.map((axis) => [axis.label, axis.value])), 10));
          charts.append(card);
        }
        if (charts.childElementCount) page.append(charts);
        if (poster.favorites?.length) {
          const card = element("section", undefined, "tree-card");
          card.append(element("h2", "最喜欢的番"));
          const list = element("div", undefined, "shared-chips");
          for (const title of poster.favorites) list.append(element("span", title, "trait-chip"));
          card.append(list);
          page.append(card);
        }
        if (poster.rewatches?.titles?.length) {
          const card = element("section", undefined, "tree-card");
          card.append(element("h2", `多刷记录 · ${poster.rewatches.total} 次`));
          for (const item of poster.rewatches.titles) {
            card.append(element("p", `${item.title} · ${item.plays} 刷`, "tree-copy"));
          }
          page.append(card);
        }
        page.append(element("p", "由本命番推荐所生成 · 只展示本人选择公开的内容", "shared-foot"));
        container.replaceChildren(page);
      } catch (error) { container.textContent = error.message; }
    }

    return { preferencesPanel, reviewEditor, wantButton, saveWatch, renderWatchlist, renderDiscovery, renderSearch,
      renderWorkDetail, renderOnlinePicks, renderThread, renderShared, radarPanel,
      mediaPicker, mediaGallery, lookupPanel, preloadWatchlist, overviewWatchlist, uploadMedia };
  }
  root.createWatchExperience = create;
})(globalThis);
