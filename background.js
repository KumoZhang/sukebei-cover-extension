const CACHE_PREFIX = "cover:";
const SETTINGS_KEY = "dmmSettings";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const JAVDB_BASES = ["https://javdb.com", "https://www.javdb.com"];

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "FETCH_COVER") {
    return;
  }

  fetchCover(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));

  return true;
});

async function fetchCover({ code, title }) {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) {
    throw new Error("Unable to parse code from this row.");
  }

  const cacheKey = CACHE_PREFIX + normalizedCode;
  const cached = await chrome.storage.local.get(cacheKey);
  const cacheEntry = cached[cacheKey];
  const shouldBypassCache = normalizedCode.startsWith("START-");
  if (cacheEntry && !shouldBypassCache && Date.now() - cacheEntry.timestamp < CACHE_TTL_MS) {
    return cacheEntry.data;
  }

  const javdbResult = await queryJavdbFirstMatch(normalizedCode);
  const javdbItem = javdbResult?.item || null;
  const queries = buildQueries(normalizedCode, title);
  let result = null;
  if (javdbItem) {
    const usable = await isUsableCoverUrl(javdbItem.coverUrl);
    if (usable) {
      result = {
        code: normalizedCode,
        title: javdbItem.title || normalizedCode,
        coverUrl: javdbItem.coverUrl,
        itemUrl: javdbItem.itemUrl || "",
        linkLabel: "Open JavDB",
        source: "javdb"
      };
    }
  }

  if (!result) {
    const guessedCover = await guessDmmCoverFromCode(normalizedCode);
    if (guessedCover) {
      result = {
        code: normalizedCode,
        title: normalizedCode,
        coverUrl: guessedCover,
        itemUrl: "",
        linkLabel: "DMM Image",
        source: "dmm-guess"
      };
    }
  }

  if (!result) {
    const settings = await getSettings();
    if (settings.apiId && settings.affiliateId) {
      const item = await queryDmmFirstMatch(queries, settings);
      if (item) {
        const coverUrl = item.imageURL?.large || item.imageURL?.small || item.imageURL?.list;
        if (coverUrl) {
          result = {
            code: normalizedCode,
            title: item.title || normalizedCode,
            coverUrl,
            itemUrl: item.URL || item.affiliateURL || "",
            linkLabel: "Open FANZA",
            source: "dmm"
          };
        }
      }
    }
  }

  if (!result?.coverUrl) {
    const javdbReason = javdbResult?.reason ? ` JavDB: ${javdbResult.reason}` : "";
    throw new Error(`No cover found for ${normalizedCode}.${javdbReason}`);
  }

  await chrome.storage.local.set({
    [cacheKey]: {
      timestamp: Date.now(),
      data: result
    }
  });

  return result;
}

async function queryJavdbFirstMatch(code) {
  let lastReason = "";

  for (const base of JAVDB_BASES) {
    try {
      const searchUrl = `${base}/search?q=${encodeURIComponent(code)}&f=all`;
      const searchHtml = await fetchText(searchUrl);
      const candidatePaths = extractJavdbDetailPaths(searchHtml);
      if (!candidatePaths.length) {
        lastReason = "search returned no detail links (possible anti-bot or layout change)";
        continue;
      }

      let fallback = null;
      for (const path of candidatePaths.slice(0, 8)) {
        const detailUrl = toAbsoluteJavdbUrl(base, path);
        const detailHtml = await fetchText(detailUrl);
        const coverUrl = extractMetaContent(detailHtml, "og:image");
        if (!coverUrl) continue;

        const title = extractMetaContent(detailHtml, "og:title") || "";
        const titleCode = normalizeCode(extractCode(title));
        const looseTitleCode = toLooseCode(titleCode);
        const looseCode = toLooseCode(code);
        const isExact = titleCode === code || (looseTitleCode && looseTitleCode === looseCode);

        const item = {
          title: cleanupOgTitle(title) || code,
          coverUrl: toAbsoluteJavdbUrl(base, coverUrl),
          itemUrl: detailUrl
        };

        if (isExact) {
          return item;
        }

        if (!fallback) {
          fallback = item;
        }
      }

      if (fallback) {
        return { item: fallback, reason: "" };
      }
    } catch (_err) {
      lastReason = String(_err?.message || _err);
    }
  }

  return { item: null, reason: lastReason };
}

function cleanupOgTitle(title) {
  return String(title || "").replace(/\s*-\s*JavDB\s*$/i, "").trim();
}

function extractJavdbDetailPaths(html) {
  const paths = new Set();
  const re = /href=['"]((?:https?:\/\/(?:www\.)?javdb\.com)?\/v\/[a-zA-Z0-9]+)['"]/gi;
  let m = re.exec(html);
  while (m) {
    const path = m[1].replace(/^https?:\/\/(?:www\.)?javdb\.com/i, "");
    paths.add(path);
    m = re.exec(html);
  }
  return [...paths];
}

function toAbsoluteJavdbUrl(base, url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  return base.replace(/\/$/, "") + (url.startsWith("/") ? url : `/${url}`);
}

function extractMetaContent(html, propertyName) {
  const escaped = propertyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re1 = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
    "i"
  );
  const source = String(html || "");
  const m = source.match(re1) || source.match(re2);
  return m ? decodeHtmlEntities(m[1]) : "";
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function guessDmmCoverFromCode(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return "";

  const m = normalized.match(/^([A-Z]{2,7})-(\d{2,5})$/);
  if (!m) return "";

  const prefix = m[1].toLowerCase();
  const rawNum = m[2];
  const candidates = buildDmmCidCandidates(prefix, rawNum);

  const bases = [
    "https://pics.dmm.co.jp/mono/movie/adult",
    "https://pics.dmm.co.jp/digital/video",
    "https://pics.dmm.co.jp/digital/videoa"
  ];
  const suffixes = ["pl.jpg", "ps.jpg", "jp.jpg"];

  for (const cid of candidates) {
    for (const base of bases) {
      for (const suffix of suffixes) {
        const url = `${base}/${cid}/${cid}${suffix}`;
        if ((await urlExists(url)) && !(await isLikelyBlankImage(url))) {
          return url;
        }
      }
    }
  }

  return "";
}

async function urlExists(url) {
  try {
    const head = await fetch(url, { method: "HEAD" });
    if (head.ok) return true;
    if (head.status !== 405) return false;
    const get = await fetch(url, { method: "GET" });
    return get.ok;
  } catch (_err) {
    return false;
  }
}

function buildDmmCidCandidates(prefix, rawNum) {
  const numNoZero = String(Number(rawNum));
  const padded = [rawNum.padStart(3, "0"), rawNum.padStart(4, "0"), rawNum.padStart(5, "0")];

  const prefixes = [prefix];
  // Some labels (including START) commonly use "1" prefixed CIDs on DMM image CDN.
  if (!prefix.startsWith("1")) {
    if (prefix === "start") {
      prefixes.unshift(`1${prefix}`);
    } else {
      prefixes.push(`1${prefix}`);
    }
  }

  const nums = [rawNum, numNoZero, ...padded];
  const out = new Set();
  for (const p of prefixes) {
    for (const n of nums) {
      out.add(`${p}${n}`);
    }
  }
  return [...out];
}

async function isLikelyBlankImage(url) {
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return false;
    if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
      return false;
    }

    const bmp = await createImageBitmap(blob);
    const w = Math.min(64, bmp.width);
    const h = Math.min(64, bmp.height);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bmp.close();
      return false;
    }

    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();

    const pixels = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const luma = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
      sum += luma;
      sumSq += luma * luma;
      count += 1;
    }
    if (!count) return false;
    const mean = sum / count;
    const variance = sumSq / count - mean * mean;
    // Near-white and very low variance => likely placeholder/blank image.
    return mean > 246 && variance < 12;
  } catch (_err) {
    return false;
  }
}

async function isUsableCoverUrl(url) {
  if (!url) return false;
  const lowered = url.toLowerCase();
  const blockedKeywords = ["noimage", "nowprinting", "now_printing", "placeholder", "default"];
  if (blockedKeywords.some((k) => lowered.includes(k))) {
    return false;
  }
  if (!(await urlExists(url))) {
    return false;
  }
  if (await isLikelyBlankImage(url)) {
    return false;
  }
  return true;
}

function buildQueries(code, title) {
  const noDash = code.replace("-", "");
  const queries = [code, noDash];

  const titleCode = extractCode(title || "");
  if (titleCode && !queries.includes(titleCode)) {
    queries.push(titleCode);
  }

  return queries;
}

async function queryDmmFirstMatch(queries, settings) {
  const serviceFloors = [
    { service: "digital", floor: "videoa" },
    { service: "mono", floor: "dvd" }
  ];

  for (const query of queries) {
    for (const sf of serviceFloors) {
      const items = await fetchItemList({
        apiId: settings.apiId,
        affiliateId: settings.affiliateId,
        keyword: query,
        service: sf.service,
        floor: sf.floor
      });

      if (!items.length) {
        continue;
      }

      const exact = pickBestMatch(items, query);
      if (exact) {
        return exact;
      }

      return items[0];
    }
  }

  return null;
}

function pickBestMatch(items, query) {
  const normalizedQuery = normalizeCode(query);
  if (!normalizedQuery) return null;
  const looseQuery = toLooseCode(normalizedQuery);

  let best = null;
  let bestScore = -1;

  for (const item of items) {
    const titleCode = normalizeCode(extractCode(item.title || ""));
    const contentId = normalizeContentId(item.content_id || "");
    const looseTitleCode = toLooseCode(titleCode);
    const looseContentId = toLooseCode(contentId);

    let score = 0;
    if (titleCode === normalizedQuery) score += 3;
    if (contentId === normalizedQuery) score += 2;
    if (looseTitleCode && looseTitleCode === looseQuery) score += 2;
    if (looseContentId && looseContentId === looseQuery) score += 1;
    if ((item.title || "").toUpperCase().includes(normalizedQuery)) score += 1;

    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  return bestScore > 0 ? best : null;
}

function normalizeContentId(contentId) {
  if (!contentId) return "";
  const m = contentId.toUpperCase().match(/^([A-Z]+)(\d{2,5})/);
  if (!m) return "";
  return `${m[1]}-${m[2]}`;
}

async function fetchItemList({ apiId, affiliateId, keyword, service, floor }) {
  const url = new URL("https://api.dmm.com/affiliate/v3/ItemList");
  url.searchParams.set("api_id", apiId);
  url.searchParams.set("affiliate_id", affiliateId);
  url.searchParams.set("site", "FANZA");
  url.searchParams.set("service", service);
  url.searchParams.set("floor", floor);
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("hits", "20");
  url.searchParams.set("sort", "rank");
  url.searchParams.set("output", "json");

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) {
    throw new Error(`DMM API request failed: ${res.status}`);
  }

  const data = await res.json();
  const items = data?.result?.items;
  if (!Array.isArray(items)) {
    return [];
  }

  return items;
}

async function getSettings() {
  const data = await chrome.storage.sync.get(SETTINGS_KEY);
  return data[SETTINGS_KEY] || {};
}

function extractCode(text) {
  const m = String(text || "").toUpperCase().match(/\b([A-Z]{2,7})[-_ ]?(\d{2,5})\b/);
  if (!m) return "";
  return `${m[1]}-${m[2]}`;
}

function normalizeCode(code) {
  return extractCode(code || "");
}

function toLooseCode(code) {
  const m = String(code || "").toUpperCase().match(/^([A-Z]{2,7})-(\d{2,5})$/);
  if (!m) return "";
  const stripped = m[2].replace(/^0+/, "");
  return `${m[1]}-${stripped || "0"}`;
}
