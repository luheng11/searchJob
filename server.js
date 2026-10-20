import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");
const DATA_FILE = join(__dirname, "data", "jobs.json");
const PORT = Number(process.env.PORT) || 3780;
const SOURCE = "https://ahjzu.ahbys.com/api/NW/Company.ashx";
const PAGE_SIZE = 1000;
const REFRESH_MS = 10 * 60 * 1000;

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

const state = {
  jobs: [],
  updatedAt: null,
  syncing: false,
  error: null,
  sourceTotal: 0,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  if (compact.length <= 96) return compact;
  return `${compact.slice(0, 96)}…`;
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

let inFlight = 0;
const waiters = [];

function withLimit(task) {
  return new Promise((resolve, reject) => {
    const run = () => {
      inFlight += 1;
      task().then(resolve, reject).finally(() => {
        inFlight -= 1;
        const next = waiters.shift();
        if (next) next();
      });
    };
    if (inFlight < 4) run();
    else waiters.push(run);
  });
}

async function fetchPage(page, category) {
  return withLimit(async () => {
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
      const response = await fetch(`${SOURCE}?${params}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": "AHJZUJobBoard/1.0",
        },
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) throw new Error(`原站返回 ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await sleep(400 * attempt);
    }
  }
  throw lastError;
  });
}

async function fetchAllPages(category) {
  const first = await fetchPage(1, category);
  const pages = Math.max(1, Number(first.pages) || 1);
  const lists = [first.list || []];
  const rest = [];
  for (let page = 2; page <= pages; page += 1) rest.push(page);

  let cursor = 0;
  async function worker() {
    while (cursor < rest.length) {
      const page = rest[cursor];
      cursor += 1;
      const data = await fetchPage(page, category);
      lists[page - 1] = data.list || [];
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, rest.length) }, () => worker()));
  return {
    total: Number(first.total) || 0,
    list: lists.flat(),
  };
}

async function syncJobs() {
  if (state.syncing) return;
  state.syncing = true;
  state.error = null;
  try {
    const all = await fetchAllPages("");
    const byId = new Map();
    for (const raw of all.list) {
      const job = normalizeJob(raw);
      if (job) byId.set(job.jid, job);
    }

    const tagged = await Promise.all(
      CATEGORIES.map(async (category) => {
        const data = await fetchAllPages(category.id);
        return { id: category.id, list: data.list };
      })
    );

    for (const group of tagged) {
      for (const raw of group.list) {
        const jid = String(raw.jid || "");
        const existing = byId.get(jid);
        if (existing) {
          if (!existing.categories.includes(group.id)) existing.categories.push(group.id);
          continue;
        }
        const job = normalizeJob(raw, [group.id]);
        if (job) byId.set(job.jid, job);
      }
    }

    const jobs = [...byId.values()].sort((a, b) => {
      if (a.publishTime !== b.publishTime) return a.publishTime < b.publishTime ? 1 : -1;
      return Number(b.jid) - Number(a.jid);
    });

    state.jobs = jobs;
    state.sourceTotal = all.total;
    state.updatedAt = new Date().toISOString();
    await mkdir(dirname(DATA_FILE), { recursive: true });
    await writeFile(
      DATA_FILE,
      JSON.stringify({
        updatedAt: state.updatedAt,
        sourceTotal: state.sourceTotal,
        jobs,
      })
    );
    console.log(`已同步 ${jobs.length} 条职位`);
  } catch (error) {
    state.error = error instanceof Error ? error.message : "同步失败";
    console.error("同步失败", state.error);
  } finally {
    state.syncing = false;
  }
}

async function loadCache() {
  try {
    const cached = JSON.parse(await readFile(DATA_FILE, "utf8"));
    if (Array.isArray(cached.jobs)) {
      state.jobs = cached.jobs;
      state.updatedAt = cached.updatedAt || null;
      state.sourceTotal = cached.sourceTotal || cached.jobs.length;
      console.log(`已读取本地缓存 ${state.jobs.length} 条`);
    }
  } catch {
    // 首次启动没有缓存
  }
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

function buildMeta() {
  const today = shanghaiToday();
  return {
    updatedAt: state.updatedAt,
    syncing: state.syncing,
    error: state.error,
    total: state.jobs.length,
    sourceTotal: state.sourceTotal,
    today: state.jobs.filter((job) => job.publishTime === today).length,
    cities: countBy(state.jobs, (job) => job.cities),
    categories: CATEGORIES.map((category) => ({
      id: category.id,
      name: category.name,
      count: state.jobs.filter((job) => job.categories.includes(category.id)).length,
    })),
    posts: countBy(state.jobs, (job) => (job.jobpost ? [job.jobpost] : [])),
  };
}

function matches(job, query) {
  if (query.city && !job.cities.includes(query.city)) return false;
  if (query.category && !job.categories.includes(query.category)) return false;
  if (query.post && job.jobpost !== query.post) return false;
  if (query.q) {
    const haystack = [
      job.title,
      job.company,
      job.jobpost,
      job.location,
      job.education,
      job.description,
      job.require,
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query.q)) return false;
  }
  return true;
}

function toSummary(job) {
  return {
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
  };
}

function queryJobs(url) {
  const city = url.searchParams.get("city")?.trim() || "";
  const category = url.searchParams.get("category")?.trim() || "";
  const post = url.searchParams.get("post")?.trim() || "";
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const sort = url.searchParams.get("sort") === "views" ? "views" : "time";
  const pageSize = Math.min(40, Math.max(1, Number(url.searchParams.get("pageSize")) || 12));
  const requestedPage = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const filtered = state.jobs.filter((job) => matches(job, { city, category, post, q }));
  if (sort === "views") {
    filtered.sort((a, b) => b.viewCount - a.viewCount || (a.publishTime < b.publishTime ? 1 : -1));
  }

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(requestedPage, pages);
  const start = (page - 1) * pageSize;

  return {
    total: filtered.length,
    page,
    pages,
    pageSize,
    jobs: filtered.slice(start, start + pageSize).map(toSummary),
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function serveStatic(res, pathname) {
  const requested = (pathname === "/" ? "index.html" : pathname).replace(/^[/\\]+/, "");
  const filePath = normalize(join(PUBLIC_DIR, requested));
  const rel = relative(PUBLIC_DIR, filePath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    sendJson(res, 403, { error: "禁止访问" });
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: "页面不存在" });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/meta" && req.method === "GET") {
    sendJson(res, 200, buildMeta());
    return;
  }

  if (url.pathname === "/api/jobs" && req.method === "GET") {
    sendJson(res, 200, queryJobs(url));
    return;
  }

  const detailMatch = url.pathname.match(/^\/api\/jobs\/(\d+)$/);
  if (detailMatch && req.method === "GET") {
    const job = state.jobs.find((item) => item.jid === detailMatch[1]);
    if (!job) {
      sendJson(res, 404, { error: "没有找到这条职位" });
      return;
    }
    sendJson(res, 200, {
      ...job,
      salary: job.salary || "面议",
      categories: job.categories.map((id) => CATEGORY_NAME.get(id)).filter(Boolean),
    });
    return;
  }

  if (url.pathname === "/api/refresh" && req.method === "POST") {
    if (!state.syncing) syncJobs();
    sendJson(res, 202, { syncing: true });
    return;
  }

  if (req.method === "GET") {
    await serveStatic(res, decodeURIComponent(url.pathname));
    return;
  }

  sendJson(res, 405, { error: "不支持的请求" });
});

await loadCache();
server.listen(PORT, () => {
  console.log(`招聘查询已打开 http://localhost:${PORT}`);
});
syncJobs();
setInterval(syncJobs, REFRESH_MS);
