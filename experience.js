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
    select.value = initial;
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

  function radar(canvas, values, max = 10, settings = {}) {
    const g = canvas.getContext("2d");
    if (!g) return;
    const entries = Object.entries(values || {});
    const { x = canvas.width / 2, y = canvas.height / 2, size = Math.min(canvas.width, canvas.height) * .30 } = settings;
    if (!settings.overlay) g.clearRect(0, 0, canvas.width, canvas.height);
    if (settings.surface) {
      g.fillStyle = settings.surface;
      g.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (entries.length < 3) return;
    const points = (scale) => entries.map(([label], i) => {
      const angle = (i * 2 / entries.length - .5) * Math.PI;
      const reach = typeof scale === "number" ? scale : scale[i];
      return { label, x: x + Math.cos(angle) * size * reach, y: y + Math.sin(angle) * size * reach };
    });
    const path = (array) => {
      g.beginPath();
      array.forEach((point, i) => i ? g.lineTo(point.x, point.y) : g.moveTo(point.x, point.y));
      g.closePath();
    };
    g.save();
    g.strokeStyle = settings.grid || "#c7d4c7";
    g.lineWidth = 1.5;
    for (const step of [.2, .4, .6, .8, 1]) { path(points(step)); g.stroke(); }
    for (const point of points(1)) {
      g.beginPath(); g.moveTo(x, y); g.lineTo(point.x, point.y); g.stroke();
    }
    const ratios = entries.map(([, value]) => Math.max(0, Math.min(1, value / max)));
    path(points(ratios));
    g.fillStyle = settings.area || "rgba(37,117,90,.28)";
    g.strokeStyle = settings.outline || "#286f58";
    g.lineWidth = 3;
    g.fill();
    g.stroke();
    g.fillStyle = settings.label || "#263d35";
    g.font = `${settings.font || 17}px "Microsoft YaHei", sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const point of points(1.26)) g.fillText(point.label, point.x, point.y, size * .85);
    g.restore();
  }

  function radarPanel(values, max) {
    const node = element("canvas", undefined, "taste-radar");
    node.width = 540;
    node.height = 326;
    node.setAttribute("role", "img");
    node.setAttribute("aria-label", Object.entries(values).map(([name, value]) => `${name} ${value} 分`).join("、"));
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const palette = dark ? { surface: "#18221e", grid: "#698179", label: "#e4f0ea",
      area: "rgba(105,211,163,.35)", outline: "#8ce0b9" } : { surface: "#fbfdfb", label: "#20352c" };
    radar(node, values, max, { ...palette, font: 21 });
    return node;
  }

  function create(deps) {
    const { state, apiJson, openAccount, showToast, findWorks, renderWorkChoices, expandWorkResults, workLink, externalWorkLink,
      openWork, reviewWork, openBoard, textButton, sameWork, postCard } = deps;
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

    let watchRead;
    function getWatchlist() {
      const owner = state.account?.id;
      if (!watchRead || watchRead.owner !== owner || watchRead.expires < Date.now()) {
        const pending = { owner, expires: Date.now() + 15000, result: apiJson("/api/watchlist") };
        watchRead = pending;
        pending.result.catch(() => { if (watchRead === pending) watchRead = null; });
      }
      return watchRead.result;
    }

    async function saveWatch(work, action, extra = {}) {
      let selected = work;
      if (action === "add" && work.provider === "anilist-candidate-snapshot") {
        const lookup = await findWorks(work.title_display, "remote");
        selected = lookup.exact || lookup.items.find((item) =>
          Number(item.year) === Number(work.year) && sameWork(work, item)) || work;
      }
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
      const metadata = [work.year && `${work.year} 年`, work.score && `Bangumi ${work.score} 分`,
        work.minutes && `${work.minutes} 分钟`, work.wanted && "待追清单"].filter(Boolean);
      if (metadata.length) article.append(element("p", metadata.join(" · "), "tree-copy"));
      if (work.features?.length) fitTags(article, work.features);
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
      const submit = element("button", "搜索", "primary-button");
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
      const box = element("details", undefined, "tree-card watch-import");
      box.append(element("summary", "批量导入"));
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
      const start = busyButton("开始匹配并加入", async () => {
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
        for (const row of pending) {
          const card = element("section", undefined, "tree-card");
          card.append(element("h3", row.input));
          const picker = lookupPanel(async (work) => {
            try {
              await saveWatch(work, status === "watched" ? "save" : "add", { status });
              card.remove();
              refresh();
            } catch (error) { showToast(error.message); }
          });
          if (row.items?.length) renderWorkChoices(card, row.items, async (work) => {
            try {
              await saveWatch(work, status === "watched" ? "save" : "add", { status });
              card.remove();
              refresh();
            } catch (error) { showToast(error.message); }
          });
          else card.append(element("p", row.retry ? "索引暂忙，可重试或改用完整片名。" : "暂未匹配到作品。", "tree-copy"));
          card.append(picker.node, textButton("重查原名称", () => picker.searchBy(row.input), "text-button"));
          unresolved.append(card);
        }
        watchRead = null;
        refresh();
      }, "primary-button");
      box.append(control("粘贴片名", content), control("导入 TXT、CSV 或 JSON", file), start, feedback, unresolved);
      return box;
    }

    async function renderWatchlist(container, status) {
      const isWatched = status === "watched";
      const list = element("div");
      const lookup = lookupPanel(async (work) => {
        try {
          await saveWatch(work, isWatched ? "save" : "add", { status });
          await refresh();
          showToast(isWatched ? "已记入已追。" : "已加入待追。");
        } catch (error) { showToast(error.message); }
      }, { key: status });
      const filter = choice([["", "全部"], ["favorite", "最喜欢"], ["like", "喜欢"], ["neutral", "一般"], ["dislike", "不喜欢"]]);
      container.append(lookup.node, watchImport(status, refresh));
      if (isWatched) container.append(control("按喜爱程度筛选", filter));
      container.append(list);
      let current = [];
      let stats;
      let generation = 0;
      list.textContent = "正在读取清单…";

      function cardFor(item) {
        const card = workTile({ ...item.work, features: item.features });
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
          }), textButton("写评价", () => reviewWork(item.work, true, item.review, item.love)));
        } else {
          actions.append(busyButton("记为已追", async () => {
            await saveWatch(item.work, "save", { status: "watched" }); refresh();
          }));
        }
        actions.append(busyButton("移除", async () => {
          await saveWatch(item.work, "remove"); refresh();
        }, "text-button"));
        card.append(actions);
        return card;
      }

      function paint() {
        list.replaceChildren();
        if (isWatched && stats) {
          const overview = element("section", undefined, "tree-card");
          overview.append(element("h3", `已追 ${stats.watched} 部 · 重刷 ${stats.rewatches} 次`));
          if (stats.topTags.length) { overview.append(element("p", "共同作品特征", "tree-copy")); fitTags(overview, stats.topTags); }
          if (stats.topReasons.length) { overview.append(element("p", "戳到我的点", "tree-copy")); fitTags(overview, stats.topReasons); }
          if (stats.dimensions) overview.append(radarPanel(Object.fromEntries(Object.entries(stats.dimensions)
            .map(([key, value]) => [model.criteria[key], value])), 10));
          list.append(overview);
        }
        const matches = current.filter((item) => item.status === status && (!filter.value || item.love === filter.value));
        if (!matches.length) list.append(element("p", "这里还没有作品。", "tree-copy"));
        const series = new Map();
        for (const item of matches) {
          const ref = item.work;
          const explicitParent = current.find((entry) => entry.work.provider === "bangumi-series" &&
            entry.status === status && entry.members?.includes(ref.provider_id));
          const id = ref.provider === "bangumi-series" ? ref.provider_id : ref.series_id || explicitParent?.work.provider_id;
          if (!id) { list.append(cardFor(item)); continue; }
          if (!series.has(id)) {
            const title = ref.series_title || explicitParent?.work.title_display || ref.title_display;
            const details = element("details", undefined, "series-result watch-series");
            details.open = true;
            const label = element("summary", title + " · 系列");
            const rows = element("div", undefined, "series-options");
            details.append(label, rows);
            series.set(id, rows);
            list.append(details);
          }
          series.get(id).append(cardFor(item));
        }
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
      await refresh();
    }

    function renderSearch(container) {
      const search = lookupPanel(openWork, { mode: true, key: "search" });
      container.append(search.node);
      const photo = element("details", undefined, "tree-card photo-search");
      const file = element("input");
      file.type = "file";
      file.accept = "image/*";
      const camera = element("input");
      camera.type = "file";
      camera.accept = "image/*";
      camera.setAttribute("capture", "environment");
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
      photo.append(element("summary", "拍照或选图片"), control("选择海报或图片", file), control("用相机拍摄", camera),
        disclosure, button, status, results);
      container.append(photo);
    }

    async function renderWorkDetail(container, reference) {
      const area = element("div");
      container.append(area);
      area.textContent = "正在读取作品详情…";
      try {
        let ref = reference;
        if (!["bangumi", "bangumi-series"].includes(ref.provider)) {
          const lookup = await findWorks(ref.title_display);
          const sameYear = lookup.items.filter((item) => Number(item.year) === Number(ref.year) && sameWork(item, ref));
          ref = sameYear.length === 1 ? sameYear[0] : lookup.exact || ref;
        }
        const detail = ["bangumi", "bangumi-series"].includes(ref.provider)
          ? await apiJson(`/api/anime-search?id=${ref.provider_id}`, undefined, 7000).catch(() => ({ work: ref, items: [] }))
          : { work: ref, items: [] };
        if (!area.isConnected) return;
        const work = { ...ref, ...detail.work };
        if (!work.title_display) { area.textContent = "暂时无法读取作品详情。"; return; }
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
        if (work.summary) card.append(element("p", work.summary, "work-summary"));
        const tools = element("div", undefined, "experience-actions");
        tools.append(wantButton(work), busyButton("记为已追", async () => {
          if (!requireAccount("登录后可以保存已追记录。")) return;
          await saveWatch(work, "save", { status: "watched" });
          showToast("已记入已追。");
        }), textButton("写评价", () => reviewWork(work)), externalWorkLink(work));
        if (work.provider_id && ["bangumi", "bangumi-series"].includes(work.provider)) {
          tools.append(textButton("看系列讨论", () => openBoard(work)));
        }
        card.append(tools);
        area.replaceChildren(card);
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
        if (work.summary) card.append(element("p", work.summary.slice(0, 150), "tree-copy"));
        const actions = element("div", undefined, "experience-actions");
        actions.append(wantButton(work));
        if (rate) actions.append(textButton("写评价", () => rate(work)));
        card.append(actions);
        container.append(card);
      }
    }

    function renderDiscovery(container) {
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
      add("scoreMin", "Bangumi 最低评分", number(0, 10, .1));
      add("scoreMax", "Bangumi 最高评分", number(0, 10, .1));
      add("since", "最早年份", number(1900, 2100));
      add("until", "最晚年份", number(1900, 2100));
      add("theme", "特殊主题", text("input", "", 28));
      const filters = element("fieldset", undefined, "review-fields discover-filters");
      filters.append(element("legend", "树洞评分与标签"),
        element("p", "同一作品按其他用户最近的公开评价取均值，已添加的条件须同时满足。", "tree-copy"));
      const dimensions = [];
      const tags = [];
      const chips = element("div", undefined, "experience-chips");
      chips.setAttribute("aria-label", "已添加的筛选条件");
      const dimensionLabels = { average: "平均分", ...model.criteria };
      const axis = choice([["", "选择维度"], ...Object.entries(dimensionLabels)]);
      const operator = choice([["min", "至少"], ["max", "至多"]], "min");
      const score = choice([["", "选择分数"], ...Array.from({ length: 10 }, (_, i) => [String(i + 1), `${i + 1} 分`])]);
      const update = () => {
        const makeChip = (label, remove) => {
          const button = textButton(`${label} ×`, remove);
          button.setAttribute("aria-label", `移除${label}`);
          return button;
        };
        chips.replaceChildren(
          ...dimensions.map((item, index) => makeChip(
            `${dimensionLabels[item.axis]} ${item.operator === "min" ? "≥" : "≤"} ${item.score}`, () => {
              dimensions.splice(index, 1); update();
            })),
          ...tags.map((tag, index) => makeChip(tag, () => { tags.splice(index, 1); update(); paintTags(); })));
      };
      const attach = () => {
        if (!axis.value || !score.value) { showToast("请选择维度和分数。"); return; }
        const index = dimensions.findIndex((item) => item.axis === axis.value && item.operator === operator.value);
        const condition = { axis: axis.value, operator: operator.value, score: Number(score.value) };
        if (index < 0) dimensions.push(condition);
        else dimensions[index] = condition;
        update();
      };
      const scoreFields = element("div", undefined, "discover-axis");
      scoreFields.append(control("维度", axis), control("条件", operator), control("分数", score), textButton("添加评分条件", attach));
      const searchTag = text("input", "", 28);
      searchTag.type = "search";
      searchTag.placeholder = "搜索可选标签";
      const suggestions = element("div", undefined, "experience-chips");
      let available = Object.keys(model.glossary);
      const paintTags = () => {
        const query = model.normalize(searchTag.value);
        const matches = available.filter((tag) => !tags.includes(tag) && model.normalize(tag).includes(query));
        suggestions.replaceChildren(...matches.slice(0, 8).map((tag) => textButton(tag, () => {
          if (tags.length >= 16) { showToast("最多添加 16 个标签。"); return; }
          tags.push(tag);
          searchTag.value = "";
          update();
          paintTags();
        })));
        if (!matches.length) suggestions.append(element("span", "暂无可添加的匹配标签。", "tree-copy"));
      };
      const propose = element("details", undefined, "tag-proposal");
      const proposal = text("input", "", 28);
      const proposalStatus = element("span", undefined, "tree-copy");
      proposalStatus.setAttribute("role", "status");
      propose.append(element("summary", "提议新标签"),
        control("新标签", proposal), busyButton("提交审核", async () => {
          const label = proposal.value.trim();
          if (!label) { proposal.focus(); return; }
          await accountMutation("/api/tags", { action: "propose", label });
          proposal.value = "";
          proposalStatus.textContent = "已提交，审核通过后可以筛选。";
        }), proposalStatus);
      searchTag.addEventListener("input", paintTags);
      for (const field of [searchTag, proposal]) field.addEventListener("keydown", (event) => {
        if (event.key === "Enter") event.preventDefault();
      });
      getTagCatalog().then(({ tags: approved }) => {
        available = approved;
        if (form.isConnected) paintTags();
      }).catch(() => {});
      paintTags();
      filters.append(scoreFields, control("戳到别人的点", searchTag), suggestions, propose, chips);
      form.append(filters);
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
          const data = await apiJson("/api/discover", { ...values, dimensions: scoresRequested, tags: tagsRequested }, 15000);
          for (const work of data.items) {
            const card = workTile(work);
            if (work.overlap?.length) card.append(element("p", `共同作品特征 · ${work.overlap.join("、")}`, "tree-copy"));
            if (work.reasonMatches?.length) card.append(element("p", `戳到你的点 · ${work.reasonMatches.join("、")}`, "tree-copy"));
            if (work.community) {
              const points = [...new Set(scoresRequested.map(({ axis }) => axis))];
              if (!points.includes("average")) points.unshift("average");
              const labels = points.map((key) => `${dimensionLabels[key]} ${work.community.scores[key]} 分`);
              card.append(element("p", `树洞 ${work.community.count} 人评价 · ${labels.join(" · ")}`, "tree-copy"));
              if (tagsRequested.length) card.append(element("p", `评价标签 · ${tagsRequested.join("、")}`, "tree-copy"));
            }
            card.append(wantButton(work));
            results.append(card);
          }
          status.textContent = data.series && !data.series.total
            ? data.series.watched ? "已追作品暂未定位到 Bangumi 系列。可在追番列表中搜索并添加对应条目。"
              : "请先把看过的作品或系列加入已追列表。"
            : data.items.length ? `找到 ${data.items.length} 部` : "这组条件下暂无候选，可以调整筛选。";
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

    async function renderThread(container, id) {
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
        replies.append(element("h2", "跟帖"));
        const form = element("form", undefined, "tree-form tree-card");
        const body = text("textarea", "", 600);
        body.required = true;
        const target = element("p", "", "tree-copy");
        const replyButton = element("button", "发表回复", "primary-button");
        let parent = null;
        form.append(target, control("回复内容", body), replyButton);
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          replyButton.disabled = true;
          try { await mutate({ action: "reply", parent, text: body.value, replyId: crypto.randomUUID() }); }
          catch (error) { showToast(error.message); }
          finally { replyButton.disabled = false; }
        });
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
            const actions = element("div", undefined, "experience-actions");
            actions.append(busyButton(`${reply.liked ? "取消赞" : "赞"} · ${reply.likes}`, () =>
              mutate({ action: "like-reply", reply: reply.id, active: !reply.liked }), "text-button"),
            textButton("回复", () => { parent = reply.id; target.textContent = "回复一条跟帖"; body.focus(); }, "text-button"));
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
        forum.replaceChildren(card, replies, form);
      }
      try {
        const data = await apiJson(`/api/thread?post=${encodeURIComponent(id)}`);
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

    function posterView(data) {
      const article = element("article", undefined, "watch-poster");
      const header = element("header");
      header.append(element("p", "ANIME SOUL LAB", "poster-mark"), element("h1", "我的阅番纪事"));
      if (data.identity) {
        const label = element("p", `${data.identity.name} · #${data.identity.code || ""}`, "poster-identity");
        if (data.identity.avatar) {
          const img = element("img");
          img.src = data.identity.avatar;
          img.alt = "";
          label.prepend(img);
        }
        header.append(label);
      }
      article.append(header);
      const facts = element("div", undefined, "poster-facts");
      if (data.count !== undefined) facts.append(element("strong", `${data.count} 部已追`));
      if (data.rewatches) facts.append(element("strong", `${data.rewatches.total} 次重刷`));
      article.append(facts);
      const section = (title, values) => {
        if (!values?.length) return;
        article.append(element("h2", title));
        for (const value of values) article.append(element("p", value));
      };
      section("多刷记录", data.rewatches?.titles.map(({ title, plays }) => `${title} · ${plays} 刷`));
      section("最爱番", data.favorites);
      if (Object.keys(data.dimensions || {}).length >= 3) article.append(element("h2", "审美维度"), radarPanel(data.dimensions, 100));
      if (data.highlights?.length) {
        article.append(element("h2", "树洞高赞"));
        for (const item of data.highlights) {
          const note = element("p");
          const entry = element("a", `${item.title} · ${item.likes} 赞`);
          entry.href = `?post=${encodeURIComponent(item.post)}`;
          note.append(entry, element("span", item.text));
          article.append(note);
        }
      }
      return article;
    }

    async function savePoster(data, url) {
      const canvas = element("canvas");
      const chart = Object.keys(data.dimensions || {}).length >= 3;
      const lines = [
        ...(data.favorites || []).slice(0, 5).map((title) => `最爱 · ${title}`),
        ...(data.rewatches?.titles || []).slice(0, 5).map(({ title, plays }) => `${plays} 刷 · ${title}`),
        ...(data.highlights || []).slice(0, 3).map(({ title, likes, text }) => `${likes} 赞 · ${title} · ${text.slice(0, 27)}`)
      ];
      canvas.width = 900;
      canvas.height = 430 + (chart ? 365 : 0) + lines.length * 38;
      const g = canvas.getContext("2d");
      if (!g) throw new Error("当前浏览器无法生成图片");
      g.fillStyle = "#edf2e8"; g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = "#20483d"; g.fillRect(0, 0, canvas.width, 240);
      g.fillStyle = "#d6e8d4"; g.font = '20px "Microsoft YaHei", sans-serif';
      g.fillText("ANIME SOUL LAB · WATCH JOURNAL", 64, 62);
      g.fillStyle = "#fff"; g.font = 'bold 67px "Microsoft YaHei", sans-serif';
      g.fillText("我的阅番纪事", 60, 150);
      if (data.identity) {
        g.font = '25px "Microsoft YaHei", sans-serif';
        g.fillText(`${data.identity.name} · #${data.identity.code || ""}`, 65, 201, 700);
        if (data.identity.avatar) {
          const img = new Image();
          img.src = data.identity.avatar;
          try {
            await img.decode();
            g.save(); g.beginPath(); g.arc(795, 124, 54, 0, Math.PI * 2); g.clip();
            g.drawImage(img, 741, 70, 108, 108); g.restore();
          } catch { /* Text identity still renders. */ }
        }
      }
      g.fillStyle = "#20483d";
      g.font = 'bold 39px "Microsoft YaHei", sans-serif';
      g.fillText([data.count !== undefined ? `${data.count} 部已追` : "", data.rewatches ? `${data.rewatches.total} 次重刷` : ""]
        .filter(Boolean).join("     /     "), 62, 320, 780);
      let y = 365;
      if (chart) {
        radar(canvas, data.dimensions, 100, { overlay: true, x: 450, y: 530, size: 123, font: 20 });
        y = 740;
      }
      g.font = '22px "Microsoft YaHei", sans-serif';
      lines.forEach((line) => { g.fillText(line, 63, y, 775); y += 38; });
      g.font = '13px sans-serif';
      g.fillText(url, 62, canvas.height - 35, 775);
      const anchor = element("a");
      anchor.href = canvas.toDataURL("image/png");
      anchor.download = "我的阅番纪事.png";
      anchor.click();
    }

    function renderShare(container) {
      const form = element("form", undefined, "tree-card poster-options");
      const options = [["identity", "昵称与头像"], ["count", "已追数量"], ["rewatches", "多刷记录"],
        ["favorites", "最喜欢的番"], ["dimensions", "审美维度图"], ["highlights", "自己的树洞高赞评论"]];
      for (const [key, label] of options) {
        const input = element("input");
        input.type = "checkbox"; input.value = key; input.name = "sections"; input.checked = key !== "highlights";
        form.append(control(label, input));
      }
      const preview = element("div");
      const status = element("p", "", "tree-copy");
      const generate = element("button", "生成海报与分享链接", "primary-button");
      form.append(generate, busyButton("撤回现有分享", async () => {
        await apiJson("/api/reading-share", { action: "revoke" });
        status.textContent = "已撤回分享。";
        preview.replaceChildren();
      }, "text-button"));
      container.append(form, status, preview);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        generate.disabled = true;
        try {
          const sections = new FormData(form).getAll("sections");
          const data = await apiJson("/api/reading-share", { sections }, 12000);
          const url = new URL(location.pathname, location.origin);
          url.searchParams.set("share", data.token);
          const address = text("input", url.href);
          address.readOnly = true;
          const actions = element("div", undefined, "experience-actions");
          actions.append(busyButton("复制链接", async () => {
            try {
              await navigator.clipboard.writeText(url.href);
              showToast("分享链接已复制。");
            } catch {
              address.select();
              showToast("请复制选中的链接。");
            }
          }), busyButton("下载 PNG", () => savePoster(data.poster, url.href)));
          preview.replaceChildren(posterView(data.poster), control("分享链接", address), actions);
          status.textContent = "";
        } catch (error) { status.textContent = error.message; }
        finally { generate.disabled = false; }
      });
    }

    async function renderShared(container, token) {
      container.textContent = "正在打开阅番总结…";
      try {
        const data = await apiJson(`/api/reading-share?share=${encodeURIComponent(token)}`);
        container.replaceChildren(posterView(data.poster));
      } catch (error) { container.textContent = error.message; }
    }

    return { preferencesPanel, reviewEditor, wantButton, saveWatch, renderWatchlist, renderDiscovery, renderSearch,
      renderWorkDetail, renderOnlinePicks, renderThread, renderShare, renderShared, radarPanel };
  }
  root.createWatchExperience = create;
})(globalThis);
