(function (root) {
  "use strict";

  const rows = [
    ["frieren", "葬送的芙莉莲", ["frieren"], ["芙莉莲", "芙莉蓮", "sousounofrieren"]],
    ["fma", "钢之炼金术师", ["fmab"], ["钢炼", "hagane", "fullmetalalchemist"]],
    ["attack-on-titan", "进击的巨人", ["attack-on-titan"], ["shingekinokyojin", "attackontitan"]],
    ["demon-slayer", "鬼灭之刃", ["demon-slayer"], ["鬼灭", "kimetsunoyaiba"]],
    ["jujutsu", "咒术回战", ["jujutsu"], ["咒术迴战", "咒术", "jujutsukaisen"]],
    ["haikyuu", "排球少年", ["haikyuu"], ["排少", "haikyuu"]],
    ["gundam", "机动战士高达", ["gundam-08ms"], ["高达", "鋼彈", "gundam"]],
    ["evangelion", "新世纪福音战士", ["evangelion"], ["新世纪天鹰战士", "新世紀福音戰士", "evangelion", "福音战士新剧场版"]],
    ["ghost-in-the-shell", "攻壳机动队", ["gits-1995", "gits-sac"], ["攻殼機動隊", "ghostintheshell", "koukakukidoutai"]],
    ["fate", "Fate 系列", ["fate-zero", "fate-ubw"], ["fatezero", "fatestaynight", "fategrandorder", "fateapocrypha"]],
    ["monogatari", "物语系列", ["bakemonogatari"], ["化物语", "伤物语", "伪物语", "猫物语", "终物语", "bakemonogatari", "kizumonogatari"]],
    ["clannad", "CLANNAD", ["clannad", "clannad-after-story"], ["团子大家族", "clannad"]],
    ["k-on", "轻音少女", ["k-on"], ["輕音少女", "kon"]],
    ["mob-psycho", "灵能百分百", ["mob-psycho"], ["路人超能100", "mobpsycho100"]],
    ["bocchi", "孤独摇滚", ["bocchi"], ["孤獨搖滾", "bocchitherock"]],
    ["natsume", "夏目友人帐", ["natsume"], ["夏目友人帳", "natsumeyuujinchou"]],
    ["re-zero", "Re:从零开始的异世界生活", ["re-zero"], ["从零开始的异世界生活", "rezero"]],
    ["fruits-basket", "水果篮子", ["fruits-basket"], ["fruitsbasket", "水果籃子"]],
    ["violet-evergarden", "紫罗兰永恒花园", ["violet-evergarden"], ["violetevergarden", "紫羅蘭永恆花園"]],
    ["steins-gate", "命运石之门", ["steins-gate"], ["石头门", "steinsgate"]],
    ["slam-dunk", "灌篮高手", ["slam-dunk", "first-slam-dunk"], ["灌籃高手", "slamdunk", "thefirstslamdunk"]],
    ["chihayafuru", "花牌情缘", ["chihayafuru"], ["花牌情緣", "chihayafuru"]],
    ["vinland-saga", "冰海战记", ["vinland-saga"], ["海盗战记", "vinlandsaga"]],
    ["spice-and-wolf", "狼与香辛料", ["spice-and-wolf"], ["狼與香辛料", "spiceandwolf", "ookamitokoushinryou"]]
  ];
  const all = rows.map(([id, title, members, aliases]) => ({ id, title, members, aliases }));
  const byId = new Map(all.map((series) => [series.id, series]));
  const normalize = (value) => String(value || "").normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");

  function identify(ref, anime) {
    if (ref?.provider === "series") return byId.get(ref.provider_id);
    const matched = all.find((series) => anime && series.members.includes(anime.id));
    if (matched) return matched;
    const names = [ref?.title_display, ref?.title_canonical].map(normalize).filter(Boolean);
    return all.find(({ title, aliases }) => [title, ...aliases].map(normalize).some((alias) =>
      names.some((name) => name === alias || (alias.length >= 4 && name.startsWith(alias)))));
  }

  function reference(series) {
    if (series.bangumiId) {
      return {
        provider: "bangumi-series", provider_id: series.bangumiId,
        canonical_url: `https://bgm.tv/subject/${series.bangumiId}`,
        title_display: series.title, title_canonical: series.title, media_type: "unknown", lookup_status: "matched"
      };
    }
    return {
      provider: "series", provider_id: series.id, title_display: series.title, title_canonical: series.title,
      canonical_url: `https://bgm.tv/subject_search/${encodeURIComponent(series.title)}?cat=2`,
      media_type: "unknown", lookup_status: "matched"
    };
  }

  const api = { all, byId, identify, reference };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ANIME_SERIES = api;
})(globalThis);
