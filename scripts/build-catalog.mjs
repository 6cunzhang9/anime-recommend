// 构建候选番剧数据：AniList 元数据/标签 + MyAnimeList 社区评分。
// 运行：node scripts/build-catalog.mjs
// 数据是构建时快照，不在用户打开页面时请求外部 API。

import fs from "node:fs/promises";
import path from "node:path";
import { SEEDS } from "./catalog-seed.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT = path.join(ROOT, "catalog.js");
const CACHE = path.join(ROOT, "scripts", "catalog-cache.json");
const TODAY = new Date().toISOString().slice(0, 10);
const USER_AGENT = "AnimeSoulLab/2.0 (local non-commercial research project)";
const REQUEST_DELAY_ANILIST = Number(process.env.ANILIST_DELAY_MS || 650);
const REQUEST_DELAY_MAL = Number(process.env.MAL_DELAY_MS || 500);
const ONLY_KEYS = new Set(
  String(process.env.ONLY_KEYS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

const ANILIST_QUERY = `
  query ($search: String) {
    Page(page: 1, perPage: 10) {
      media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
        id
        idMal
        format
        episodes
        duration
        status
        startDate { year }
        title { romaji english native }
        synonyms
        averageScore
        meanScore
        popularity
        favourites
        genres
        tags { name rank isMediaSpoiler }
        studios(isMain: true) { nodes { name } }
        coverImage { color }
        siteUrl
      }
    }
  }
`;

const FEATURE_KEYS = [
  "fantasy",
  "scifi",
  "healing",
  "action",
  "mystery",
  "romance",
  "dark",
  "comedy",
  "sports"
];

const FEATURE_RULES = {
  fantasy: {
    genres: ["Fantasy"],
    tags: {
      "World Building": 1,
      "Magic": 0.9,
      "Isekai": 0.9,
      "Mythology": 0.8,
      "Medieval": 0.55,
      "Urban Fantasy": 0.8,
      "Supernatural": 0.7,
      "Adventure": 0.4,
      "Steampunk": 0.45,
      "Fairy Tale": 0.8,
      "Elves": 0.7,
      "Dragons": 0.7,
      "Demons": 0.4,
      "Gods": 0.45,
      "Travel": 0.3
    }
  },
  scifi: {
    genres: ["Sci-Fi", "Mecha", "Space"],
    tags: {
      "Space": 1,
      "Cyberpunk": 1,
      "Robots": 0.9,
      "Artificial Intelligence": 0.9,
      "Time Manipulation": 0.55,
      "Dystopian": 0.5,
      "Science Fiction": 1,
      "Post-Apocalyptic": 0.6,
      "Space Opera": 1,
      "Military": 0.35,
      "Steampunk": 0.35
    }
  },
  healing: {
    genres: ["Slice of Life"],
    tags: {
      "Iyashikei": 1,
      "Slice of Life": 1,
      "Cute Girls Doing Cute Things": 0.85,
      "Cooking": 0.55,
      "Family": 0.5,
      "Found Family": 0.45,
      "Coming of Age": 0.35,
      "Work": 0.35,
      "Travel": 0.3,
      "Nature": 0.65,
      "Countryside": 0.7,
      "Agriculture": 0.55,
      "Music": 0.3
    }
  },
  action: {
    genres: ["Action"],
    tags: {
      "Swordplay": 0.8,
      "Super Power": 0.8,
      "Martial Arts": 0.9,
      "Guns": 0.45,
      "Battle Royale": 0.7,
      "Military": 0.45,
      "War": 0.45,
      "Revenge": 0.4,
      "Assassins": 0.55,
      "Samurai": 0.65,
      "Ninja": 0.55,
      "Henshin": 0.45,
      "Gore": 0.3
    }
  },
  mystery: {
    genres: ["Mystery", "Thriller"],
    tags: {
      "Detective": 1,
      "Crime": 0.7,
      "Police": 0.45,
      "Psychological": 0.8,
      "Time Manipulation": 0.55,
      "Non-Linear Narrative": 0.7,
      "Espionage": 0.55,
      "Conspiracy": 0.65,
      "Investigation": 1,
      "Serial Killer": 0.6,
      "Puzzle": 0.55
    }
  },
  romance: {
    genres: ["Romance"],
    tags: {
      "Love Triangle": 0.7,
      "Unrequited Love": 0.8,
      "School": 0.35,
      "Coming of Age": 0.45,
      "Romantic Drama": 1,
      "Romcom": 0.8,
      "Marriage": 0.45,
      "Age Gap": 0.3,
      "LGBTQ+ Themes": 0.35,
      "First Love": 1
    }
  },
  dark: {
    genres: ["Horror", "Psychological", "Drama"],
    tags: {
      "Tragedy": 0.8,
      "Gore": 0.9,
      "Graphic Violence": 1,
      "Body Horror": 0.9,
      "Horror": 1,
      "Psychological": 0.8,
      "War": 0.7,
      "Suicide": 0.8,
      "Abuse": 0.8,
      "Dystopian": 0.55,
      "Crime": 0.45,
      "Death": 0.6,
      "Existential": 0.7,
      "Surreal": 0.45,
      "Mature": 0.7
    }
  },
  comedy: {
    genres: ["Comedy"],
    tags: {
      "Gag Humor": 1,
      "Parody": 0.8,
      "Slapstick": 0.8,
      "Surreal Comedy": 0.8,
      "Satire": 0.8,
      "Romcom": 0.45,
      "School": 0.2
    }
  },
  sports: {
    genres: ["Sports"],
    tags: {
      "Teamwork": 0.9,
      "Training": 0.65,
      "Competition": 0.8,
      "Tournament": 0.6,
      "Baseball": 0.8,
      "Basketball": 0.8,
      "Volleyball": 0.8,
      "Football": 0.8,
      "Rugby": 0.8,
      "Boxing": 0.8,
      "Running": 0.8,
      "Swimming": 0.8,
      "Ice Skating": 0.8,
      "Martial Arts": 0.35,
      "Music": 0.15
    }
  }
};

const GENRE_ZH = {
  Action: "动作",
  Adventure: "冒险",
  Comedy: "喜剧",
  Drama: "剧情",
  Fantasy: "奇幻",
  Horror: "恐怖",
  "Mahou Shoujo": "魔法少女",
  Mecha: "机甲",
  Music: "音乐",
  Mystery: "悬疑",
  Psychological: "心理",
  Romance: "恋爱",
  "Sci-Fi": "科幻",
  "Slice of Life": "日常",
  Sports: "运动",
  Supernatural: "超自然",
  Thriller: "惊悚",
  Ecchi: "福利",
  Isekai: "异世界",
  Space: "太空",
  "Martial Arts": "武术",
  Military: "军事",
  Historical: "历史",
  School: "校园",
  Shounen: "少年",
  Seinen: "青年",
  Josei: "女性向",
  Kids: "儿童",
  Hentai: "成人"
};

const TAG_ZH = {
  "World Building": "世界观",
  "Ensemble Cast": "群像",
  "Coming of Age": "成长",
  "Time Manipulation": "时间操控",
  "Non-Linear Narrative": "非线性叙事",
  "Philosophy": "哲学",
  "Politics": "政治",
  "Survival": "生存",
  "Tragedy": "悲剧",
  "Mystery": "谜题",
  "Crime": "犯罪",
  "Police": "警察",
  "Military": "军事",
  "War": "战争",
  "Historical": "历史",
  "Iyashikei": "治愈日常",
  "Slice of Life": "生活流",
  "Found Family": "家人羁绊",
  "Female Protagonist": "女性主角",
  "Male Protagonist": "男性主角",
  "Primarily Adult Cast": "成人群像",
  "Primarily Teen Cast": "少年群像",
  "Primarily Female Cast": "女性群像",
  "Primarily Male Cast": "男性群像",
  "School": "校园",
  "Work": "职场",
  "Music": "音乐",
  "Band": "乐队",
  "Rock Music": "摇滚",
  "Isekai": "异世界",
  "Magic": "魔法",
  "Swordplay": "剑术",
  "Martial Arts": "武术",
  "Super Power": "超能力",
  "Mecha": "机甲",
  "Space": "太空",
  "Cyberpunk": "赛博朋克",
  "Dystopian": "反乌托邦",
  "Post-Apocalyptic": "末世",
  "Artificial Intelligence": "人工智能",
  "Robots": "机器人",
  "Time Skip": "时间跳跃",
  "Episodic": "单元剧",
  "Satire": "讽刺",
  "Surreal Comedy": "超现实喜剧",
  "Surreal": "超现实",
  "Slapstick": "闹剧",
  "Parody": "戏仿",
  "Gag Humor": "无厘头",
  "Romcom": "恋爱喜剧",
  "Romantic Drama": "恋爱剧情",
  "Love Triangle": "三角关系",
  "Unrequited Love": "单向暗恋",
  "First Love": "初恋",
  "Heterosexual": "异性恋",
  "LGBTQ+ Themes": "多元性别",
  "Age Gap": "年龄差",
  "Marriage": "婚姻",
  "Family": "家庭",
  "Cooking": "料理",
  "Agriculture": "农业",
  "Nature": "自然",
  "Countryside": "乡野",
  "Travel": "旅行",
  "Detective": "侦探",
  "Investigation": "调查",
  "Conspiracy": "阴谋",
  "Espionage": "谍战",
  "Serial Killer": "连环杀手",
  "Puzzle": "谜题",
  "Psychological": "心理",
  "Gore": "血腥",
  "Graphic Violence": "暴力",
  "Body Horror": "身体恐怖",
  "Horror": "恐怖",
  "Suicide": "自杀议题",
  "Abuse": "虐待议题",
  "Death": "死亡",
  "Existential": "存在主义",
  "Mature": "成人议题",
  "Teamwork": "团队",
  "Training": "训练",
  "Competition": "竞技",
  "Tournament": "锦标赛",
  "Baseball": "棒球",
  "Basketball": "篮球",
  "Volleyball": "排球",
  "Football": "足球",
  "Rugby": "橄榄球",
  "Boxing": "拳击",
  "Running": "长跑",
  "Swimming": "游泳",
  "Ice Skating": "花滑",
  "Samurai": "武士",
  "Ninja": "忍者",
  "Assassins": "刺客",
  "Guns": "枪战",
  "Revenge": "复仇",
  "Henshin": "变身",
  "Battle Royale": "大逃杀",
  "Steampunk": "蒸汽朋克",
  "Mythology": "神话",
  "Gods": "神明",
  "Demons": "恶魔",
  "Dragons": "龙",
  "Elves": "精灵",
  "Medieval": "中世纪",
  "Urban Fantasy": "都市奇幻",
  "Fairy Tale": "童话",
  "Supernatural": "超自然",
  "Adventure": "冒险",
  "Rock": "摇滚",
  "Classical Music": "古典乐",
  "Jazz": "爵士",
  "Idol": "偶像",
  "Rotoscoping": "转描",
  "CGI": "CG 演出",
  "Musical Theater": "音乐剧",
  "Disability": "残障议题",
  "Bullying": "霸凌议题",
  "Slavery": "奴役议题",
  "Rehabilitation": "疗愈",
  "Writing": "写作",
  "Food": "美食",
  "Photography": "摄影",
  "Language Barrier": "语言障碍",
  "POV": "主观视角",
  "Family Life": "家庭生活",
  "Shoujo": "少女向",
  "Curses": "诅咒",
  "Orphan": "孤儿",
  "Homeless": "无家可归",
  "School Club": "社团",
  "Shapeshifting": "变身",
  "Delinquents": "不良少年",
  "Cohabitation": "同居",
  "Kuudere": "冷娇",
  "Tsundere": "傲娇",
  "Iyashikei": "治愈日常",
  "Class Struggle": "阶级议题",
  "Gangs": "帮派",
  "Drugs": "药物议题",
  "Cyberpunk": "赛博朋克",
  "Dystopian": "反乌托邦",
  "Cyborg": "改造人",
  "Mythology": "神话",
  "Fairy Tale": "童话",
  "Urban": "都市",
  "Coming of Age": "成长",
  "Found Family": "家人羁绊",
  "Work": "职场",
  "Food": "美食",
  "Time Loop": "时间循环",
  "Memory Manipulation": "记忆操控",
  "Social Media": "社交媒体",
  "Isekai": "异世界",
  "Female Protagonist": "女性主角",
  "Primarily Female Cast": "女性群像",
  "Primarily Adult Cast": "成人群像",
  "Ensemble Cast": "群像",
  "Non-Linear Narrative": "非线性叙事",
  "Episodic": "单元剧",
  "School": "校园",
  "Historical": "历史",
  "Military": "军事",
  "Politics": "政治",
  "Philosophy": "哲学",
  "Surreal Comedy": "超现实喜剧",
  "Absurdist Humor": "荒诞幽默",
  "Slapstick": "闹剧",
  "Parody": "戏仿",
  "Gag Humor": "无厘头",
  "Satire": "讽刺",
  "Anti-Hero": "反英雄",
  "Noir": "黑色电影",
  "Post-Apocalyptic": "末世",
  "Space Opera": "太空歌剧",
  "Female Protagonist": "女性主角",
  "Male Protagonist": "男性主角",
  "Hikikomori": "家里蹲",
  "Band": "乐队",
  "Meta": "元叙事",
  "Time Loop": "时间循环",
  "Reincarnation": "转生",
  "Vampire": "吸血鬼",
  "Mafia": "黑帮",
  "Yakuza": "极道",
  "Politics": "政治",
  "Philosophy": "哲学"
};

const STUDIO_NOTES = {
  "Studio Ghibli": "剧场级美术与手绘作画是它最稳定的长板",
  "Topcraft": "吉卜力前身团队，手绘自然与飞行场面见长",
  "Kyoto Animation": "日常演出、作画稳定性和情绪调度是它的强项",
  "ufotable": "高密度作画与数字摄影是它最醒目的制作标签",
  "Bones": "动作作画与少年漫改编的制作完成度通常很高",
  "Madhouse": "作者性演出和成熟的类型制作能力是它的招牌",
  "MAPPA": "高强度动作作画与跨类型制作是它的常见优势",
  "Wit Studio": "节奏、镜头与动作演出常有鲜明的精工感",
  "WIT STUDIO": "节奏、镜头与动作演出常有鲜明的精工感",
  "Production I.G": "科幻设定、演出质感和稳定制作是它的传统强项",
  "Sunrise": "机甲/科幻演出与长线动作制作经验深厚",
  "Trigger": "夸张动作、色彩与作者性演出辨识度很高",
  "TRIGGER": "夸张动作、色彩与作者性演出辨识度很高",
  "Shaft": "几何构图、文字演出和意识流表达是它的风格标签",
  "Science SARU": "实验性作画与媒介混合是它最鲜明的制作特征",
  "A-1 Pictures": "类型覆盖广，重点项目通常有稳定的制作资源",
  "CloverWorks": "人物作画与情绪演出是近年亮眼的制作特征",
  "P.A. Works": "生活流演出、美术与人物情绪常常完成度很高",
  "Doga Kobo": "日常喜剧的作画节奏与可爱演出是它的长板",
  "White Fox": "叙事密度的处理和稳定的演出执行是它的优势",
  "J.C.Staff": "稳定产能与类型改编经验是它的特点",
  "Toei Animation": "长期系列经验与稳定的动作作画资源",
  "Gainax": "作者性科幻与大胆的演出选择是它的历史标签",
  "GAINAX": "作者性科幻与大胆的演出选择是它的历史标签",
  "Khara": "EVA 系列高强度作画与演出实验",
  "Studio Bind": "奇幻世界观与细致作画是近年亮眼的制作特征",
  "OLM": "类型化制作与稳定的系列改编能力",
  "Pierrot": "少年漫动作与长线制作的丰富经验",
  "Studio Pierrot": "少年漫动作与长线制作的丰富经验",
  "Sanzigen": "3D/CG 演出与类型动作制作",
  "SANZIGEN": "3D/CG 演出与类型动作制作",
  "Liden Films": "多类型改编与稳定产能",
  "Studio 3Hz": "动作演出与色彩表现常有余裕",
  "TMS Entertainment": "类型改编与稳定制作经验",
  "8bit": "奇幻/爽快型制作的稳定执行",
  "C2C": "类型改编与稳定作画",
  "Passione": "类型改编与角色作画的稳定执行",
  "David Production": "色彩、演出和节奏感常有鲜明风格",
  "Gonzo": "早期数字制作与实验性类型片的代表之一",
  "AIC": "经典科幻/OVA 的类型片制作经验",
  "Artland": "偏作者性的改编和演出执行",
  "Manglobe": "都市感演出与动作作画是它的历史特色",
  "Brain's Base": "群像、都市奇幻和类型改编的稳定制作",
  "Nippon Animation": "经典文学/家庭题材的长期制作经验",
  "Studio Deen": "类型改编经验丰富，制作波动较大",
  "Zexcs": "作者性改编与小规模制作",
  "Tatsunoko Production": "经典动画与动作类型的长期经验",
  "CoMix Wave": "新海诚作品常见的都市光影与高密度背景美术",
  "Kinema Citrus": "动作设计与情绪作画兼具的稳定制作",
  "Studio Durian": "独立动画团队，以手绘线条和克制的情绪演出见长",
  "Tokyo Movie Shinsha": "经典剧场动画与类型片的长期制作经验",
  "A.C.G.T.": "偏作者性、类型改编的小规模制作",
  "C-Station": "日常系演出的稳定作画与户外质感",
  "Hal Film Maker": "经典少女/奇幻题材的演出经验",
  "Imagin": "偏作者性奇幻改编与角色演出",
  "Shin-Ei Animation": "日常喜剧与情绪作画的稳定执行",
  "Radix": "早期奇幻/实验作品的制作团队",
  "Triangle Staff": "实验性演出与早期数字动画经验",
  "Lerche": "类型改编与节奏明快的稳定制作",
  "feel.": "青春/恋爱改编的细腻演出",
  "Geno Studio": "偏作者性演出与动作制作",
  "Platinum Vision": "类型改编的稳定作画",
  "SILVER LINK.": "日常喜剧的稳定演出与作画",
  "Orange": "3D 动画制作与细致角色表演",
  "NAZ": "悬疑/类型改编与数字制作",
  "Zero-G": "类型改编与角色作画的稳定执行",
  "Kitty Film": "经典都市/成人向动画的制作经验",
  "Sentai Filmworks": "海外发行，不作为主要制作方",
  "Kinumata": "",
  "WAO World": ""
};

const formatNumber = (value) => String(value).replace(/[^\d]/g, "");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeTitle(text) {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s《》〈〉「」『』【】\[\]()（）:：!！?？·・.,，。;；\-—_'"“”‘’]+/g, "");
}

function hashString(text) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function chooseMedia(seed, results) {
  const isMovie = seed.format === "MOVIE";
  const isTV = seed.format === "TV";
  const isOVA = seed.format === "OVA";
  const isONA = seed.format === "ONA";
  const searchNorm = normalizeTitle(seed.search);

  return results
    .map((media) => {
      const year = media.startDate?.year || 0;
      const yearDiff = Math.abs(year - seed.year);
      const candidateTitles = [
        media.title?.romaji,
        media.title?.english,
        media.title?.native,
        ...(media.synonyms || [])
      ].filter(Boolean);
      const titleHit = candidateTitles.some((title) => normalizeTitle(title) === searchNorm);
      const titleContains = candidateTitles.some((title) => {
        const normalized = normalizeTitle(title);
        return normalized.length > 3 && searchNorm.length > 3 &&
          (normalized.includes(searchNorm) || searchNorm.includes(normalized));
      });
      let formatScore = 0;
      if (media.format === seed.format) formatScore = 80;
      else if (isTV && media.format === "ONA") formatScore = 20;
      else if (isMovie && media.format === "MOVIE") formatScore = 80;
      else if (isOVA && media.format === "OVA") formatScore = 80;
      else if (isONA && ["ONA", "TV"].includes(media.format)) formatScore = 45;
      else formatScore = -120;

      const yearScore = yearDiff === 0 ? 80 : yearDiff <= 1 ? 35 : yearDiff <= 2 ? 5 : -90;
      const titleScore = titleHit ? 75 : titleContains ? 40 : 0;
      const junkPenalty = /mini|recap|picture drama|souhuuhen|digest|special|pilot|commercial/i.test(
        `${media.title?.romaji || ""} ${media.title?.english || ""} ${media.title?.native || ""}`
      ) ? -80 : 0;
      const popularityScore = Math.log10(1 + (media.popularity || 0)) * 4;
      const score = formatScore + yearScore + titleScore + junkPenalty + popularityScore;
      return { media, score, yearDiff };
    })
    .sort((a, b) => b.score - a.score)[0];
}

async function fetchJsonWithRetry(url, options, retries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429) {
        const wait = 4000 + attempt * 2500;
        console.warn(`  rate limited, waiting ${wait}ms...`);
        await sleep(wait);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(1500 + attempt * 1500);
    }
  }
  throw lastError;
}

async function fetchAniList(seed) {
  const data = await fetchJsonWithRetry("https://graphql.anilist.co", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json",
      "user-agent": USER_AGENT
    },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: { search: seed.search } })
  });
  const results = data?.data?.Page?.media || [];
  if (!results.length) return null;
  return chooseMedia(seed, results);
}

function parseMALPage(html) {
  const scoreMatch = html.match(/itemprop="ratingValue"[^>]*>([\d.]+)</i);
  const ratingCountMatch = html.match(/itemprop="ratingCount"[^>]*>([\d,]+)</i);
  const membersMatch = html.match(/Members:<\/span>\s*([\d,]+)/i);
  const favoritesMatch = html.match(/Favorites:<\/span>\s*([\d,]+)/i);
  const rankMatch = html.match(/Ranked:<\/span>\s*#([\d,]+)/i);
  return {
    score: scoreMatch ? Number(scoreMatch[1]) : null,
    scoredBy: ratingCountMatch ? Number(formatNumber(ratingCountMatch[1])) : null,
    members: membersMatch ? Number(formatNumber(membersMatch[1])) : null,
    favorites: favoritesMatch ? Number(formatNumber(favoritesMatch[1])) : null,
    rank: rankMatch ? Number(formatNumber(rankMatch[1])) : null
  };
}

async function fetchMAL(seed, media) {
  if (!media?.idMal) return { error: "AniList 没有提供 MAL ID" };
  const url = `https://myanimelist.net/anime/${media.idMal}`;
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        "accept-language": "en-US,en;q=0.9"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const parsed = parseMALPage(html);
    if (!parsed.score) throw new Error("页面中没有解析到评分");
    return parsed;
  } catch (error) {
    return { error: error.message };
  }
}

function buildFeatureVector(media) {
  const genreScores = new Map();
  const tagScores = new Map();
  (media.genres || []).forEach((genre) => genreScores.set(genre, 1));
  (media.tags || [])
    .filter((tag) => !tag.isMediaSpoiler)
    .forEach((tag) => tagScores.set(tag.name, tag.rank / 100));

  const raw = {};
  for (const feature of FEATURE_KEYS) {
    const rule = FEATURE_RULES[feature];
    let value = 0.025;
    for (const genre of rule.genres) {
      if (genreScores.has(genre)) value += 0.6;
    }
    for (const [tag, weight] of Object.entries(rule.tags)) {
      if (tagScores.has(tag)) value += tagScores.get(tag) * weight;
    }
    raw[feature] = value;
  }

  const maxRaw = Math.max(...Object.values(raw), 0.001);
  const normalized = {};
  for (const feature of FEATURE_KEYS) {
    normalized[feature] = Number(Math.min(1, raw[feature] / maxRaw).toFixed(3));
  }
  return normalized;
}

function selectDisplayTags(media) {
  const genres = new Set(media.genres || []);
  const tagCandidates = (media.tags || [])
    .filter((tag) => !tag.isMediaSpoiler && tag.rank >= 55 && TAG_ZH[tag.name])
    .sort((a, b) => b.rank - a.rank);
  const output = [];
  for (const tag of tagCandidates) {
    if (output.includes(TAG_ZH[tag.name])) continue;
    output.push(TAG_ZH[tag.name]);
    if (output.length >= 5) break;
  }
  for (const genre of genres) {
    if (output.length >= 5) break;
    if (GENRE_ZH[genre] && !output.includes(GENRE_ZH[genre])) output.push(GENRE_ZH[genre]);
  }
  return output;
}

function getStudio(media) {
  return media.studios?.nodes?.map((node) => node.name).filter(Boolean) || [];
}

function computeCaveats(media, quality) {
  const tags = new Map(
    (media.tags || [])
      .filter((tag) => !tag.isMediaSpoiler)
      .map((tag) => [tag.name, tag.rank])
  );
  const rank = (name) => tags.get(name) || 0;
  const caveats = [];
  if (rank("Gore") >= 70 || rank("Graphic Violence") >= 70) {
    caveats.push("含较直接的暴力/血腥画面");
  } else if (rank("Horror") >= 70 || rank("Body Horror") >= 70) {
    caveats.push("偏恐怖/身体恐怖");
  }
  if (rank("Sexual Content") >= 65 || rank("Explicit Sex") >= 65) {
    caveats.push("含成人向内容");
  } else if (rank("Nudity") >= 72) {
    caveats.push("含少量裸露画面");
  }
  if (rank("Suicide") >= 65 || rank("Abuse") >= 65 || rank("War") >= 84) {
    caveats.push("涉及死亡、虐待或战争等沉重议题");
  }
  if (media.episodes >= 50) caveats.push(`共 ${media.episodes} 集，补番成本较高`);
  if ((quality.consensusGap || 0) >= 7) caveats.push("两个平台的社区评分存在分歧");
  return [...new Set(caveats)].slice(0, 2);
}

function getQualityBand(score) {
  if (score >= 88) return "跨平台经典";
  if (score >= 83) return "高口碑";
  if (score >= 78) return "口碑扎实";
  return "类型内好评";
}

function hexToRgb(hex) {
  const value = String(hex || "#8a7d74").replace("#", "");
  const expanded = value.length === 3 ? value.split("").map((char) => char + char).join("") : value;
  const parsed = Number.parseInt(expanded, 16);
  if (Number.isNaN(parsed)) return { r: 138, g: 125, b: 116 };
  return { r: (parsed >> 16) & 255, g: (parsed >> 8) & 255, b: parsed & 255 };
}

function mixColor(hex, target, amount) {
  const source = hexToRgb(hex);
  const targetRgb = hexToRgb(target);
  const channel = (start, end) => Math.round(start + (end - start) * amount).toString(16).padStart(2, "0");
  return `#${channel(source.r, targetRgb.r)}${channel(source.g, targetRgb.g)}${channel(source.b, targetRgb.b)}`;
}

function buildColors(hex) {
  const base = /^#[0-9a-f]{6}$/i.test(hex || "") ? hex : "#9b806e";
  return [mixColor(base, "#19151c", 0.62), mixColor(base, "#f6eddf", 0.2), mixColor(base, "#f6eddf", 0.7)];
}

function pickEmoji(features, key) {
  const palette = {
    fantasy: ["🪄", "🐉", "🗺️", "🌿"],
    scifi: ["🌌", "🛸", "🤖", "🪐"],
    healing: ["🍵", "🏕️", "🌾", "☁️"],
    action: ["⚔️", "🔥", "⚡", "🗡️"],
    mystery: ["🔍", "🧩", "🕯️", "🕵️"],
    romance: ["🌸", "💌", "💐", "🎐"],
    dark: ["🌑", "🕯️", "🩸", "🧿"],
    comedy: ["🎭", "🤹", "💥", "🍡"],
    sports: ["🏐", "🏃", "🥊", "⛸️"]
  };
  const top = FEATURE_KEYS.reduce((best, feature) => features[feature] > features[best] ? feature : best, "fantasy");
  const list = palette[top] || palette.fantasy;
  return list[hashString(key) % list.length];
}

function toCatalogRecord(seed, match, mal) {
  const media = match.media;
  const features = buildFeatureVector(media);
  const anilistScore = media.averageScore ? media.averageScore : null;
  const malScore = mal?.score || null;
  const mal10 = malScore ? malScore * 10 : null;

  let communityScore = null;
  let consensusGap = null;
  if (anilistScore && mal10) {
    const mutual = (anilistScore + mal10) / 2;
    const conservative = Math.min(anilistScore, mal10);
    communityScore = Math.round((mutual * 0.68 + conservative * 0.32) * 10) / 10;
    consensusGap = Math.round(Math.abs(anilistScore - mal10) * 10) / 10;
  } else if (anilistScore) {
    communityScore = Math.round(anilistScore * 0.92 * 10) / 10;
  } else if (mal10) {
    communityScore = Math.round(mal10 * 0.95 * 10) / 10;
  }

  const qualityEligible = Boolean(
    communityScore !== null &&
    communityScore >= 75 &&
    (mal?.scoredBy || 0) >= 12000 &&
    (anilistScore || 0) >= 70
  );

  const studios = getStudio(media);
  const studio = studios[0] || "制作信息待补";
  const normalizeStudio = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const studioLookup = new Map(
    Object.entries(STUDIO_NOTES)
      .filter(([, note]) => Boolean(note))
      .map(([name, note]) => [normalizeStudio(name), note])
  );
  const studioNote = studioLookup.get(normalizeStudio(studio)) ||
    (studios.length > 1 ? `${studios.slice(0, 2).join(" / ")} 联合制作` : "制作信息以公开资料为准");
  const quality = {
    anilistScore,
    anilistPopularity: media.popularity || 0,
    anilistFavourites: media.favourites || 0,
    malScore,
    malScoredBy: mal?.scoredBy || null,
    malMembers: mal?.members || null,
    malFavorites: mal?.favorites || null,
    malRank: mal?.rank || null,
    communityScore: communityScore ? Number((communityScore / 10).toFixed(1)) : null,
    consensusGap: consensusGap === null ? null : Number((consensusGap / 10).toFixed(1)),
    band: communityScore ? getQualityBand(communityScore) : "口碑样本不足",
    eligible: qualityEligible
  };

  const musicTagRanks = ["Music", "Band", "Rock Music", "Classical Music", "Jazz", "Idol", "Musical Theater"]
    .map((name) => (media.tags || []).find((tag) => tag.name === name)?.rank || 0);
  const musicSignal = Math.min(
    1,
    0.08 +
    (media.genres || []).includes("Music") * 0.55 +
    Math.max(...musicTagRanks) / 100 * 0.45
  );
  const visualSignal = Math.min(
    1,
    0.2 +
    (media.format === "MOVIE" ? 0.16 : 0) +
    ((media.tags || []).find((tag) => tag.name === "Visual Arts")?.rank || 0) / 100 * 0.3 +
    (studioNote !== "制作信息以公开资料为准" ? 0.14 : 0) +
    (communityScore || 70) / 100 * 0.22
  );

  const caveats = computeCaveats(media, quality);
  const titleCandidates = [
    seed.zh,
    ...(seed.aliases || []),
    media.title?.english,
    media.title?.romaji,
    media.title?.native,
    ...(media.synonyms || [])
  ].filter(Boolean);
  const uniqueAliases = [...new Set(titleCandidates.map((title) => title.trim()).filter(Boolean))].slice(0, 14);

  return {
    id: seed.key,
    title: seed.zh,
    romaji: media.title?.romaji || "",
    english: media.title?.english || "",
    native: media.title?.native || "",
    aliases: uniqueAliases,
    year: media.startDate?.year || seed.year,
    format: media.format,
    episodes: media.episodes || (media.format === "MOVIE" ? 1 : null),
    duration: media.duration || null,
    status: media.status || null,
    studio,
    studios,
    studioNote,
    anilistId: media.id,
    malId: media.idMal || null,
    anilistUrl: media.siteUrl || null,
    source: "AniList + MyAnimeList",
    features,
    tags: selectDisplayTags(media),
    colors: buildColors(media.coverImage?.color),
    emoji: pickEmoji(features, seed.key),
    signals: {
      music: Number(musicSignal.toFixed(2)),
      visual: Number(visualSignal.toFixed(2))
    },
    quality,
    caveats,
    rawTagNames: (media.tags || [])
      .filter((tag) => !tag.isMediaSpoiler)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 8)
      .map((tag) => tag.name)
  };
}

async function main() {
  const selected = SEEDS.filter((seed) => !ONLY_KEYS.size || ONLY_KEYS.has(seed.key));
  console.log(`Building catalog for ${selected.length} seeds...`);
  let cache = {};
  try {
    cache = JSON.parse(await fs.readFile(CACHE, "utf8"));
  } catch {
    cache = {};
  }

  const records = [];
  const failures = [];
  for (let index = 0; index < selected.length; index += 1) {
    const seed = selected[index];
    console.log(`[${index + 1}/${selected.length}] ${seed.zh}`);
    try {
      let matched = cache[seed.key]?.matched;
      if (!matched) {
        const match = await fetchAniList(seed);
        if (!match) throw new Error("No AniList results");
        matched = match;
        cache[seed.key] = { seed, matched };
        await fs.writeFile(CACHE, JSON.stringify(cache, null, 2));
        await sleep(REQUEST_DELAY_ANILIST);
      }
      const mal = cache[seed.key]?.mal?.score ? cache[seed.key].mal : await fetchMAL(seed, matched.media);
      cache[seed.key] = { ...(cache[seed.key] || {}), seed, matched, mal };
      await fs.writeFile(CACHE, JSON.stringify(cache, null, 2));
      await sleep(REQUEST_DELAY_MAL);
      const record = toCatalogRecord(seed, matched, mal);
      records.push(record);
      console.log(
        `  -> ${record.romaji || record.title} (${record.year}, ${record.format}) | ` +
        `AL ${record.quality.anilistScore ?? "?"} / MAL ${record.quality.malScore ?? "?"} | ` +
        `community ${record.quality.communityScore ?? "?"} | eligible ${record.quality.eligible}`
      );
      if (!record.quality.eligible) failures.push({ seed, record, reason: "quality gate" });
    } catch (error) {
      console.warn(`  !! ${error.message}`);
      failures.push({ seed, error: error.message });
    }
  }

  const eligible = records.filter((record) => record.quality.eligible);
  const sorted = [...records].sort((a, b) => {
    if ((b.quality.communityScore || 0) !== (a.quality.communityScore || 0)) {
      return (b.quality.communityScore || 0) - (a.quality.communityScore || 0);
    }
    return a.title.localeCompare(b.title, "zh-Hans-CN");
  });

  const meta = {
    generatedAt: new Date().toISOString(),
    sourceSnapshotDate: TODAY,
    sources: [
      { name: "AniList", url: "https://anilist.co", fields: "社区均分、热度、收藏、类型标签、制作公司" },
      { name: "MyAnimeList", url: "https://myanimelist.net", fields: "加权社区评分、评分人数、成员数、收藏、排名" }
    ],
    qualityGate: "两平台加权口碑 ≥ 7.5/10，MAL 评分样本 ≥ 1.2 万，AniList 均分 ≥ 70",
    totalSelected: records.length,
    eligible: eligible.length,
    note: "候选番由人工初选；评分与标签用于质量门槛和解释，不代表官方排名。未使用单条论坛发言作为推荐特征。"
  };

  const banner = `/* 自动生成：node scripts/build-catalog.mjs
 * 数据快照：${TODAY}
 * 来源：AniList 社区数据 + MyAnimeList 社区数据
 * 仅作非商业向的推荐演示；作品版权归原作者与权利方所有。
 */
`;
  const body = `const CATALOG_META = ${JSON.stringify(meta, null, 2)};\n\nconst ANIME_CATALOG = ${JSON.stringify(sorted, null, 2)};\n\nif (typeof module !== "undefined" && module.exports) {\n  module.exports = { CATALOG_META, ANIME_CATALOG };\n}\n`;
  await fs.writeFile(OUTPUT, banner + body, "utf8");
  await fs.writeFile(
    path.join(ROOT, "scripts", "catalog-build-report.json"),
    JSON.stringify({ meta, failures: failures.map((item) => ({ key: item.seed?.key, zh: item.seed?.zh, error: item.error, eligible: item.record?.quality?.eligible })) }, null, 2),
    "utf8"
  );

  console.log(`\nDone. ${records.length} records, ${eligible.length} quality-eligible.`);
  console.log(`Catalog written to ${OUTPUT}`);
  if (failures.length) console.log(`Failures: ${failures.length} (see scripts/catalog-build-report.json)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
