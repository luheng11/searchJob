const SOURCE = "https://ahjzu.ahbys.com/api/NW/Company.ashx";
const PAGE_SIZE = 1000;

const CATEGORIES = [
  { id: "10", name: "计算机/互联网/通信/电子" },
  { id: "11", name: "销售/客服/技术支持" },
  { id: "12", name: "会计/金融/银行/保险" },
  { id: "13", name: "生产/营运/采购/物流" },
  { id: "14", name: "生物/制药/医疗/护理" },
  { id: "15", name: "广告/市场/媒体/艺术" },
  { id: "16", name: "建筑/房地产" },
  { id: "17", name: "人事/行政/高级管理" },
  { id: "18", name: "咨询/法律/教育/科研" },
  { id: "19", name: "服务业/翻译" },
  { id: "20", name: "农/林/牧/渔/环保" },
];

const CATEGORY_NAME = new Map(CATEGORIES.map((item) => [item.id, item.name]));

function shanghaiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function splitCities(location) {
  const raw = String(location || "").trim();
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(/[、,，;；/|]+/)
        .map((part) => part.trim())
        .filter(Boolean)
    ),
  ];
}

function snippet(text) {
  const compact = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  return compact.length <= 96 ? compact : `${compact.slice(0, 96)}…`;
}

function normalizeJob(raw, categories = []) {
  const jid = String(raw.jid || "").trim();
  if (!/^\d+$/.test(jid)) return null;
  return {
    jid,
    cid: /^\d+$/.test(String(raw.cid || "")) ? String(raw.cid) : "",
    title: String(raw.title || "").trim(),
    company: String(raw.company || "").trim(),
    location: String(raw.location || "").trim(),
    cities: splitCities(raw.location),
    jobpost: String(raw.jobpost || "").trim(),
    industry: String(raw.industry || "").trim(),
    nature: String(raw.nature || "").trim(),
    education: String(raw.education || "").trim(),
    experience: String(raw.experience || "").trim(),
    salary: String(raw.salary || "").trim(),
    description: String(raw.description || "").trim(),
    require: String(raw.Require || raw.require || "").trim(),
    hiring: String(raw.hiring || "").trim(),
    viewCount: Number(raw.viewCount) || 0,
    publishTime: String(raw.publishTime || "").slice(0, 10),
    categories: [...new Set(categories)],
  };
}

async function fetchPage(page, category) {
  const params = new URLSearchParams({
    action: "joblistall",
    sort: "publishTime",
    education: "0",
    page: String(page),
    size: String(PAGE_SIZE),
  });
  if (category) params.set("category", category);
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

async function mapPool(items, limit, task) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function fetchAllPages(category, onPage) {
  const first = await fetchPage(1, category);
  onPage?.();
  const pages = Math.max(1, Number(first.pages) || 1);
  const rest = await mapPool(
    Array.from({ length: pages - 1 }, (_, index) => index + 2),
    4,
    async (page) => {
      const data = await fetchPage(page, category);
      onPage?.();
      return data.list || [];
    }
  );
  return [first.list || [], ...rest].flat();
}

function countBy(jobs, pick) {
  const counts = new Map();
  for (const job of jobs) {
    for (const value of pick(job)) {
      if (!value) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ahjzu-jobs", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("catalog");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readCache() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction("catalog").objectStore("catalog").get("latest");
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
      const request = db.transaction("catalog", "readwrite").objectStore("catalog").put(payload, "latest");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // 缓存写失败时仍然使用本次内存数据
  }
}

export function createCatalog() {
  let jobs = [];
  let updatedAt = null;
  let syncing = false;
  let error = null;

  function meta() {
    const today = shanghaiToday();
    return {
      updatedAt,
      syncing,
      error,
      total: jobs.length,
      sourceTotal: jobs.length,
      today: jobs.filter((job) => job.publishTime === today).length,
      cities: countBy(jobs, (job) => job.cities),
      categories: CATEGORIES.map((category) => ({
        id: category.id,
        name: category.name,
        count: jobs.filter((job) => job.categories.includes(category.id)).length,
      })),
      posts: countBy(jobs, (job) => (job.jobpost ? [job.jobpost] : [])),
    };
  }

  function query({ city = "", category = "", post = "", q = "", sort = "time", page = 1, pageSize = 12 }) {
    const needle = q.trim().toLowerCase();
    const filtered = jobs.filter((job) => {
      if (city && !job.cities.includes(city)) return false;
      if (category && !job.categories.includes(category)) return false;
      if (post && job.jobpost !== post) return false;
      if (!needle) return true;
      return [job.title, job.company, job.jobpost, job.location, job.education, job.description, job.require]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
    if (sort === "views") {
      filtered.sort((a, b) => b.viewCount - a.viewCount || (a.publishTime < b.publishTime ? 1 : -1));
    }
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const safePage = Math.min(Math.max(1, page), pages);
    const start = (safePage - 1) * pageSize;
    return {
      total: filtered.length,
      page: safePage,
      pages,
      pageSize,
      jobs: filtered.slice(start, start + pageSize).map((job) => ({
        jid: job.jid,
        cid: job.cid,
        title: job.title,
        company: job.company,
        location: job.location,
        cities: job.cities,
        jobpost: job.jobpost,
        education: job.education,
        salary: job.salary || "面议",
        hiring: job.hiring,
        viewCount: job.viewCount,
        publishTime: job.publishTime,
        categories: job.categories.map((id) => CATEGORY_NAME.get(id)).filter(Boolean),
        snippet: snippet(job.description),
      })),
    };
  }

  function job(jid) {
    const found = jobs.find((item) => item.jid === jid);
    if (!found) return null;
    return {
      ...found,
      salary: found.salary || "面议",
      categories: found.categories.map((id) => CATEGORY_NAME.get(id)).filter(Boolean),
    };
  }

  async function hydrate() {
    const cached = await readCache();
    if (!cached?.jobs?.length) return false;
    jobs = cached.jobs;
    updatedAt = cached.updatedAt || null;
    return true;
  }

  async function sync(onProgress) {
    if (syncing) return;
    syncing = true;
    error = null;
    let done = 0;
    const tick = () => {
      done += 1;
      onProgress?.(`正在从就业信息网同步职位（${done}）`);
    };
    try {
      const all = await fetchAllPages("", tick);
      const byId = new Map();
      for (const raw of all) {
        const item = normalizeJob(raw);
        if (item) byId.set(item.jid, item);
      }
      const tagged = await mapPool(CATEGORIES, 3, async (category) => ({
        id: category.id,
        list: await fetchAllPages(category.id, tick),
      }));
      for (const group of tagged) {
        for (const raw of group.list) {
          const jid = String(raw.jid || "");
          const existing = byId.get(jid);
          if (existing) {
            if (!existing.categories.includes(group.id)) existing.categories.push(group.id);
            continue;
          }
          const item = normalizeJob(raw, [group.id]);
          if (item) byId.set(item.jid, item);
        }
      }
      jobs = [...byId.values()].sort((a, b) => {
        if (a.publishTime !== b.publishTime) return a.publishTime < b.publishTime ? 1 : -1;
        return Number(b.jid) - Number(a.jid);
      });
      updatedAt = new Date().toISOString();
      await writeCache({ updatedAt, jobs });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "同步失败";
      throw cause;
    } finally {
      syncing = false;
    }
  }

  return { meta, query, job, hydrate, sync, get syncing() { return syncing; } };
}
