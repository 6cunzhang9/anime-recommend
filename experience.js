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
    g.strokeStyle = "#c7d4c7";
    g.lineWidth = 1.5;
    for (const step of [.2, .4, .6, .8, 1]) { path(points(step)); g.stroke(); }
    for (const point of points(1)) {
      g.beginPath(); g.moveTo(x, y); g.lineTo(point.x, point.y); g.stroke();
    }
    const ratios = entries.map(([, value]) => Math.max(0, Math.min(1, value / max)));
    path(points(ratios));
    g.fillStyle = "rgba(37,117,90,.28)";
    g.strokeStyle = "#286f58";
    g.lineWidth = 3;
    g.fill();
    g.stroke();
    g.fillStyle = "#263d35";
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
    radar(node, values, max);
    return node;
  }

  function create(deps) {
    const { state, apiJson, openAccount, showToast, findWorks, renderWorkChoices, workLink, textButton, openTree, sameWork, postCard } = deps;
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

    async function saveWatch(work, action, extra = {}) {
      let selected = work;
      if (action === "add" && work.provider === "anilist-candidate-snapshot") {
        const lookup = await findWorks(work.title_display, "remote");
        selected = lookup.exact || lookup.items.find((item) =>
          Number(item.year) === Number(work.year) && sameWork(work, item)) || work;
      }
      return accountMutation("/api/watchlist", { work: selected, action, ...extra });
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

    function lookupPanel(pick) {
      const box = element("section", undefined, "tree-card");
      const form = element("form", undefined, "tree-search");
      const search = text("input", "", 120);
      search.type = "search";
      search.placeholder = "在 Bangumi 搜索番剧";
      search.setAttribute("aria-label", "作品名");
      const submit = element("button", "搜索", "primary-button");
      const list = element("div", undefined, "tree-search-results");
      const status = element("p", "", "tree-copy");
      status.setAttribute("role", "status");
      form.append(search, submit);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!search.value.trim()) return;
        submit.disabled = true;
        list.replaceChildren();
        status.textContent = "正在搜索…";
        try {
          const data = await findWorks(search.value.trim(), "remote");
          status.textContent = data.items.length ? "" : data.fallback ? "Bangumi 暂时不可用。" : "未找到相关作品。";
          renderWorkChoices(list, data.items, pick, data);
        } catch (error) { status.textContent = error.message; }
        finally { submit.disabled = false; }
      });
      box.append(form, status, list);
      return box;
    }

    async function renderWatchlist(container, status) {
      const isWatched = status === "watched";
      const list = element("div");
      container.append(lookupPanel(async (work) => {
        try {
          await saveWatch(work, isWatched ? "save" : "add", { status });
          openTree(status);
          showToast(isWatched ? "已记入已追。" : "已加入待追。");
        } catch (error) { showToast(error.message); }
      }), list);
      list.textContent = "正在读取清单…";
      try {
        const { items, stats } = await apiJson("/api/watchlist");
        if (!list.isConnected) return;
        list.replaceChildren();
        if (isWatched) {
          const overview = element("section", undefined, "tree-card");
          overview.append(element("h3", `已追 ${stats.watched} 部 · 重刷 ${stats.rewatches} 次`));
          if (stats.topTags.length) {
            overview.append(element("p", "共同作品特征", "tree-copy"));
            fitTags(overview, stats.topTags);
          }
          if (stats.topReasons.length) {
            overview.append(element("p", "戳到我的点", "tree-copy"));
            fitTags(overview, stats.topReasons);
          }
          if (stats.dimensions) overview.append(radarPanel(Object.fromEntries(Object.entries(stats.dimensions)
            .map(([key, value]) => [model.criteria[key], value])), 10));
          list.append(overview);
        }
        const rows = element("div");
        list.append(rows);
        const render = (filter) => {
          rows.replaceChildren();
          const matches = items.filter((item) => item.status === status && (!filter || item.love === filter));
          if (!matches.length) rows.append(element("p", "这里还没有作品。", "tree-copy"));
          for (const item of matches) {
            const card = workTile({ ...item.work, features: item.features });
            const actions = element("div", undefined, "experience-actions");
            if (isWatched) {
              const love = choice([["favorite", "最喜欢"], ["like", "喜欢"], ["neutral", "一般"], ["dislike", "不喜欢"]], item.love);
              love.setAttribute("aria-label", "喜爱程度");
              love.addEventListener("change", async () => {
                try { await saveWatch(item.work, "save", { status, love: love.value }); openTree(status); }
                catch (error) { showToast(error.message); }
              });
              actions.append(love, element("span", `${item.plays} 刷`), busyButton("再刷一次", async () => {
                await saveWatch(item.work, "rewatch"); openTree(status);
              }));
              const details = element("details");
              details.append(element("summary", "评价这部作品"));
              const form = element("form");
              const editor = reviewEditor(item.review, undefined, { work: item.work });
              form.append(editor.node, element("button", "保存追番评价", "primary-button"));
              form.addEventListener("submit", async (event) => {
                event.preventDefault();
                try { await saveWatch(item.work, "save", { status, review: editor.read() }); openTree(status); }
                catch (error) { showToast(error.message); }
              });
              details.append(form);
              card.append(details);
            } else {
              actions.append(busyButton("记为已追", async () => {
                await saveWatch(item.work, "save", { status: "watched" });
                openTree("watched");
              }));
            }
            actions.append(busyButton("移除", async () => {
              await saveWatch(item.work, "remove"); openTree(status);
            }, "text-button"));
            card.append(actions);
            rows.append(card);
          }
        };
        if (isWatched) {
          const filter = choice([["", "全部"], ["favorite", "最喜欢"], ["like", "喜欢"], ["neutral", "一般"], ["dislike", "不喜欢"]]);
          filter.addEventListener("change", () => render(filter.value));
          list.insertBefore(control("按喜爱程度筛选", filter), rows);
        }
        render("");
      } catch (error) { list.textContent = error.message; }
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
        source.hidden = false;
        source.append(element("h2", "站外高赞评论"), element("p", "正在匹配相关作品…", "tree-copy"));
        const outputs = await Promise.allSettled(data.post.works.map((entry) => external(entry.external_ref)));
        if (!source.isConnected) return;
        source.replaceChildren(element("h2", "站外高赞评论"));
        const seen = new Set();
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
        if (!seen.size) source.append(element("p", "暂无已匹配的高赞评论。", "tree-copy"));
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

    return { preferencesPanel, reviewEditor, wantButton, saveWatch, renderWatchlist, renderDiscovery,
      renderThread, renderShare, renderShared, radarPanel };
  }
  root.createWatchExperience = create;
})(globalThis);
