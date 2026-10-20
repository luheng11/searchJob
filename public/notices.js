const SOURCE = "https://ahjzu.ahbys.com/api/NW/Company.ashx";

function shanghaiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function placeOf(location) {
  const text = String(location || "").trim();
  if (!text) return "未填写";
  const afterProvince = text.match(/(?:省|自治区)([^市]{2,12}市)/);
  if (afterProvince) return afterProvince[1];
  if (/^(北京|上海|天津|重庆)/.test(text)) return `${text.slice(0, 2)}市`;
  const city = text.match(/([\u4e00-\u9fa5]{2,12}市)/);
  if (city) return city[1];
  const county = text.match(/([\u4e00-\u9fa5]{2,12}(?:县|区|旗|州))/);
  if (county) return county[1];
  return text;
}

function readId(url, key) {
  const query = String(url || "").split("?")[1] || "";
  return new URLSearchParams(query).get(key) || "";
}

function normalize(raw) {
  const id = String(raw.id || "").trim();
  if (!/^\d+$/.test(id)) return null;
  const cid = readId(raw.detailUrl, "cid") || readId(raw.companyUrl, "cid");
  const location = String(raw.location || "").trim();
  return {
    jid: id,
    cid: /^\d+$/.test(cid) ? cid : "",
    title: String(raw.title || "").trim(),
    company: String(raw.company || "").trim(),
    location,
    place: placeOf(location),
    industry: String(raw.industry || "").trim(),
    nature: String(raw.nature || "").trim(),
    scale: String(raw.scale || "").trim(),
    publishTime: String(raw.publishDate || "").slice(0, 10),
  };
}

function countBy(items, pick) {
  const counts = new Map();
  for (const item of items) {
    const value = pick(item);
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ id: name, name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
}

async function fetchPage(page) {
  const params = new URLSearchParams({
    action: "joblist2",
    sort: "publishDate",
    page: String(page),
    pageSize: "500",
  });
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${SOURCE}?${params}`);
      if (!response.ok) throw new Error(`原站返回 ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
  throw lastError;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ahjzu-jobs", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("catalog")) {
        request.result.createObjectStore("catalog");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readCache() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction("catalog").objectStore("catalog").get("notices");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function writeCache(payload) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const request = db.transaction("catalog", "readwrite").objectStore("catalog").put(payload, "notices");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // 缓存失败时仍使用本次拉取的数据
  }
}

export function createNoticeCatalog() {
  let items = [];
  let updatedAt = null;
  let syncing = false;
  let error = null;

  function meta() {
    const today = shanghaiToday();
    const industries = countBy(items, (item) => item.industry);
    const natures = countBy(items, (item) => item.nature);
    return {
      updatedAt,
      syncing,
      error,
      total: items.length,
      today: items.filter((item) => item.publishTime === today).length,
      cities: countBy(items, (item) => item.place).map(({ name, count }) => ({ name, count })),
      categories: industries,
      posts: natures.map(({ name, count }) => ({ name, count })),
    };
  }

  function query({ city = "", category = "", post = "", q = "", page = 1, pageSize = 12 }) {
    const needle = q.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (city && item.place !== city) return false;
      if (category && item.industry !== category) return false;
      if (post && item.nature !== post) return false;
      if (!needle) return true;
      return [item.title, item.company, item.location, item.industry, item.nature]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const safePage = Math.min(Math.max(1, page), pages);
    const start = (safePage - 1) * pageSize;
    return {
      total: filtered.length,
      page: safePage,
      pages,
      pageSize,
      jobs: filtered.slice(start, start + pageSize),
    };
  }

  function item(jid) {
    return items.find((entry) => entry.jid === jid) || null;
  }

  async function hydrate() {
    const cached = await readCache();
    if (!cached?.items?.length) return false;
    items = cached.items;
    updatedAt = cached.updatedAt || null;
    return true;
  }

  async function sync(onProgress) {
    if (syncing) return;
    syncing = true;
    error = null;
    try {
      onProgress?.("正在同步招聘公告");
      const first = await fetchPage(1);
      const pages = Math.max(1, Number(first.pages) || 1);
      const lists = [first.list || []];
      for (let page = 2; page <= pages; page += 1) {
        onProgress?.(`正在同步招聘公告（${page}/${pages}）`);
        const data = await fetchPage(page);
        lists.push(data.list || []);
      }
      const byId = new Map();
      for (const raw of lists.flat()) {
        const notice = normalize(raw);
        if (notice) byId.set(notice.jid, notice);
      }
      items = [...byId.values()].sort((a, b) => {
        if (a.publishTime !== b.publishTime) return a.publishTime < b.publishTime ? 1 : -1;
        return Number(b.jid) - Number(a.jid);
      });
      updatedAt = new Date().toISOString();
      await writeCache({ updatedAt, items });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "同步失败";
      throw cause;
    } finally {
      syncing = false;
    }
  }

  return { meta, query, item, hydrate, sync, get syncing() { return syncing; } };
}

export async function fetchNoticeDetail(id, cid) {
  const params = new URLSearchParams({ action: "jobinfo2", id: String(id) });
  if (cid) params.set("cid", String(cid));
  const response = await fetch(`${SOURCE}?${params}`);
  if (!response.ok) throw new Error(`简章加载失败 ${response.status}`);
  const data = await response.json();
  if (!data || data.code !== 0) throw new Error("原站没有返回这份简章");
  return data;
}
