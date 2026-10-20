import { createCatalog } from "./catalog.js";

const catalog = createCatalog();
let useLocal = false;

const state = {
  city: "",
  category: "",
  post: "",
  q: "",
  sort: "time",
  page: 1,
  selected: "",
  meta: null,
  jobs: [],
  today: "",
};

const els = {
  statTotal: document.querySelector("#statTotal"),
  statToday: document.querySelector("#statToday"),
  statSync: document.querySelector("#statSync"),
  refreshBtn: document.querySelector("#refreshBtn"),
  banner: document.querySelector("#statusBanner"),
  ruler: document.querySelector("#cityRuler"),
  cityInput: document.querySelector("#cityInput"),
  cityList: document.querySelector("#cityList"),
  cityClear: document.querySelector("#cityClear"),
  categorySelect: document.querySelector("#categorySelect"),
  postInput: document.querySelector("#postInput"),
  postList: document.querySelector("#postList"),
  postClear: document.querySelector("#postClear"),
  keywordInput: document.querySelector("#keywordInput"),
  clearBtn: document.querySelector("#clearBtn"),
  resultLine: document.querySelector("#resultLine"),
  jobList: document.querySelector("#jobList"),
  pager: document.querySelector("#pager"),
  detail: document.querySelector("#detail"),
};

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatSync(value) {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未同步";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function shanghaiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function readJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`请求失败 ${response.status}`);
  return response.json();
}

function renderStats() {
  const meta = state.meta;
  els.statTotal.textContent = meta ? String(meta.total) : "—";
  els.statToday.textContent = meta ? String(meta.today) : "—";
  els.statSync.textContent = meta?.syncing && !meta.updatedAt ? "同步中" : formatSync(meta?.updatedAt);
  els.refreshBtn.disabled = Boolean(meta?.syncing);
  els.refreshBtn.classList.toggle("is-syncing", Boolean(meta?.syncing));
  els.refreshBtn.textContent = meta?.syncing ? "同步中" : "同步最新";

  if (meta?.error) {
    els.banner.hidden = false;
    els.banner.textContent = `同步没有完成：${meta.error}。当前显示的是上次成功同步的职位。`;
  } else if (meta?.syncing && !meta.total) {
    els.banner.hidden = false;
    els.banner.textContent = "正在从就业信息网拉取全部职位，第一次大约需要十几秒。";
  } else {
    els.banner.hidden = true;
  }
}

function renderRuler() {
  const cities = (state.meta?.cities || []).slice(0, 12);
  const buttons = [
    `<button type="button" class="ruler-btn ${state.city ? "" : "is-active"}" data-city="">
      <strong>全部</strong><span>${esc(state.meta?.total ?? "—")}</span>
    </button>`,
    ...cities.map(
      (city) => `<button type="button" class="ruler-btn ${state.city === city.name ? "is-active" : ""}" data-city="${esc(city.name)}">
        <strong>${esc(city.name)}</strong><span>${esc(city.count)}</span>
      </button>`
    ),
  ];
  els.ruler.innerHTML = buttons.join("");
}

function renderCategoryOptions() {
  const current = state.category;
  const options = ['<option value="">全部类别</option>'].concat(
    (state.meta?.categories || []).map(
      (item) =>
        `<option value="${esc(item.id)}" ${item.id === current ? "selected" : ""}>${esc(item.name)}（${esc(item.count)}）</option>`
    )
  );
  els.categorySelect.innerHTML = options.join("");
}

function renderCombo(listEl, items, selected, query) {
  const needle = query.trim().toLowerCase();
  const matched = items
    .filter((item) => !needle || item.name.toLowerCase().includes(needle) || item.name === selected)
    .slice(0, 80);
  if (!matched.length) {
    listEl.innerHTML = `<li><button type="button" disabled>没有匹配项</button></li>`;
    return;
  }
  listEl.innerHTML = matched
    .map(
      (item) => `<li><button type="button" data-value="${esc(item.name)}" class="${item.name === selected ? "is-active" : ""}">
        <span>${esc(item.name)}</span><em>${esc(item.count)}</em>
      </button></li>`
    )
    .join("");
}

function openCombo(listEl, input) {
  listEl.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function closeCombo(listEl, input) {
  listEl.hidden = true;
  input.setAttribute("aria-expanded", "false");
}

function syncComboInputs() {
  els.cityInput.value = state.city;
  els.postInput.value = state.post;
  els.cityClear.hidden = !state.city;
  els.postClear.hidden = !state.post;
}

function renderJobs(payload) {
  state.jobs = payload.jobs;
  const total = payload.total;
  els.resultLine.textContent = total ? `当前 ${total} 个职位` : "没有符合条件的职位";

  if (!payload.jobs.length) {
    els.jobList.innerHTML = `<div class="empty">换一个城市、类别，或清空关键词后再查。</div>`;
  } else {
    els.jobList.innerHTML = payload.jobs
      .map((job) => {
        const today = job.publishTime === state.today;
        return `<article class="job-card ${job.jid === state.selected ? "is-selected" : ""}" data-jid="${esc(job.jid)}" tabindex="0">
          <div class="job-top">
            <h2>${esc(job.title)}</h2>
            <strong class="salary">${esc(job.salary)}</strong>
          </div>
          <p class="company">${esc(job.company)}</p>
          <div class="meta">
            <span>${esc(job.location || "城市未填写")}</span>
            ${job.jobpost ? `<span>${esc(job.jobpost)}</span>` : ""}
            ${job.education ? `<span>${esc(job.education)}</span>` : ""}
            <span class="${today ? "today" : ""}">${today ? "今日" : esc(job.publishTime)}</span>
          </div>
          ${job.categories.length ? `<div class="tags">${job.categories.map((name) => `<span class="tag">${esc(name)}</span>`).join("")}</div>` : ""}
          ${job.snippet ? `<p class="snippet">${esc(job.snippet)}</p>` : ""}
        </article>`;
      })
      .join("");
  }

  renderPager(payload);
}

function renderPager(payload) {
  if (payload.pages <= 1) {
    els.pager.innerHTML = "";
    return;
  }
  const buttons = [
    `<button type="button" data-page="${payload.page - 1}" ${payload.page === 1 ? "disabled" : ""}>上一页</button>`,
  ];
  const start = Math.max(1, payload.page - 2);
  const end = Math.min(payload.pages, start + 4);
  for (let page = Math.max(1, end - 4); page <= end; page += 1) {
    buttons.push(
      `<button type="button" data-page="${page}" class="${page === payload.page ? "is-active" : ""}">${page}</button>`
    );
  }
  buttons.push(
    `<button type="button" data-page="${payload.page + 1}" ${payload.page === payload.pages ? "disabled" : ""}>下一页</button>`
  );
  els.pager.innerHTML = buttons.join("");
}

function renderDetail(job) {
  if (!job) {
    els.detail.classList.remove("is-open");
    els.detail.innerHTML = `<div class="detail-empty"><p class="detail-kicker">岗位说明</p><p>从左侧选一条职位，这里会展开岗位描述和任职要求。</p></div>`;
    return;
  }
  const original = `https://ahjzu.ahbys.com/Nw/job.html?id=${job.jid}&cid=${job.cid}`;
  const company = job.cid ? `https://ahjzu.ahbys.com/Nw/company.html?cid=${job.cid}` : "";
  els.detail.classList.add("is-open");
  els.detail.innerHTML = `
    <div class="detail-head">
      <p class="detail-kicker">岗位说明</p>
      <button type="button" class="close-detail" id="closeDetail">关闭</button>
    </div>
    <h2>${esc(job.title)}</h2>
    <p class="detail-company">${company ? `<a href="${company}" target="_blank" rel="noreferrer">${esc(job.company)}</a>` : esc(job.company)}</p>
    <p class="detail-salary">${esc(job.salary)}</p>
    <p class="detail-meta">
      ${esc(job.location || "城市未填写")}
      ${job.jobpost ? ` · ${esc(job.jobpost)}` : ""}
      ${job.education ? ` · ${esc(job.education)}` : ""}
      ${job.hiring ? ` · 招 ${esc(job.hiring)} 人` : ""}
      · 发布于 ${esc(job.publishTime || "未知")}
    </p>
    ${job.categories.length ? `<div class="tags">${job.categories.map((name) => `<span class="tag">${esc(name)}</span>`).join("")}</div>` : ""}
    <section class="detail-block">
      <p class="block-label">岗位描述</p>
      <p>${esc(job.description || "原站没有填写描述")}</p>
    </section>
    <section class="detail-block">
      <p class="block-label">任职要求</p>
      <p>${esc(job.require || "原站没有填写要求")}</p>
    </section>
    <div class="detail-actions">
      <a class="link-btn" href="${original}" target="_blank" rel="noreferrer">在原站查看</a>
    </div>
  `;
}

let seenData = "";

async function loadMeta(reloadJobs) {
  const meta = useLocal ? await readJson("/api/meta") : catalog.meta();
  const dataStamp = `${meta.updatedAt || ""}|${meta.total}`;
  state.meta = meta;
  state.today = shanghaiToday();
  renderStats();
  if (dataStamp === seenData) return false;
  seenData = dataStamp;
  renderRuler();
  renderCategoryOptions();
  if (reloadJobs) await loadJobs();
  return true;
}

async function loadJobs() {
  const params = new URLSearchParams({
    city: state.city,
    category: state.category,
    post: state.post,
    q: state.q,
    sort: state.sort,
    page: String(state.page),
  });
  const payload = useLocal
    ? await readJson(`/api/jobs?${params}`)
    : catalog.query({
        city: state.city,
        category: state.category,
        post: state.post,
        q: state.q,
        sort: state.sort,
        page: state.page,
      });
  if (payload.page !== state.page) state.page = payload.page;
  renderJobs(payload);

  const stillVisible = payload.jobs.some((job) => job.jid === state.selected);
  const desktop = window.matchMedia("(min-width: 981px)").matches;
  if (!stillVisible) {
    if (desktop && payload.jobs[0]) await openJob(payload.jobs[0].jid, false);
    else {
      state.selected = "";
      renderDetail(null);
    }
  }
}

async function openJob(jid, focusDetail) {
  state.selected = jid;
  document.querySelectorAll(".job-card").forEach((card) => {
    card.classList.toggle("is-selected", card.dataset.jid === jid);
  });
  const job = useLocal ? await readJson(`/api/jobs/${jid}`) : catalog.job(jid);
  if (!job) throw new Error("没有找到这条职位");
  renderDetail(job);
  if (focusDetail && window.matchMedia("(max-width: 980px)").matches) {
    els.detail.scrollTop = 0;
  }
}

function setCity(city) {
  state.city = city;
  state.page = 1;
  syncComboInputs();
  loadJobs().catch(showError);
  renderRuler();
}

function setPost(post) {
  state.post = post;
  state.page = 1;
  syncComboInputs();
  loadJobs().catch(showError);
}

function showError(error) {
  els.banner.hidden = false;
  els.banner.textContent = error instanceof Error ? error.message : "页面加载失败";
  els.resultLine.textContent = "职位列表暂时没有加载出来";
}

els.ruler.addEventListener("click", (event) => {
  const button = event.target.closest("[data-city]");
  if (!button) return;
  setCity(button.dataset.city || "");
});

els.categorySelect.addEventListener("change", () => {
  state.category = els.categorySelect.value;
  state.page = 1;
  loadJobs().catch(showError);
});

let keywordTimer = 0;
els.keywordInput.addEventListener("input", () => {
  window.clearTimeout(keywordTimer);
  keywordTimer = window.setTimeout(() => {
    state.q = els.keywordInput.value.trim();
    state.page = 1;
    loadJobs().catch(showError);
  }, 250);
});

els.clearBtn.addEventListener("click", () => {
  state.city = "";
  state.category = "";
  state.post = "";
  state.q = "";
  state.page = 1;
  els.keywordInput.value = "";
  els.categorySelect.value = "";
  syncComboInputs();
  renderRuler();
  loadJobs().catch(showError);
});

document.querySelectorAll(".sort-btn").forEach((button) => {
  button.addEventListener("click", () => {
    state.sort = button.dataset.sort;
    state.page = 1;
    document.querySelectorAll(".sort-btn").forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    loadJobs().catch(showError);
  });
});

els.jobList.addEventListener("click", (event) => {
  const card = event.target.closest(".job-card");
  if (card) openJob(card.dataset.jid, true).catch(showError);
});
els.jobList.addEventListener("keydown", (event) => {
  const card = event.target.closest(".job-card");
  if (card && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    openJob(card.dataset.jid, true).catch(showError);
  }
});

els.pager.addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (!button || button.disabled) return;
  state.page = Number(button.dataset.page);
  loadJobs().catch(showError);
  els.jobList.scrollIntoView({ block: "start" });
});

els.detail.addEventListener("click", (event) => {
  if (event.target.closest("#closeDetail")) {
    state.selected = "";
    document.querySelectorAll(".job-card").forEach((card) => card.classList.remove("is-selected"));
    renderDetail(null);
  }
});

function bindCombo({ input, list, clear, items, getSelected, onSelect }) {
  input.addEventListener("focus", () => {
    renderCombo(list, items(), getSelected(), "");
    openCombo(list, input);
  });
  input.addEventListener("input", () => {
    renderCombo(list, items(), getSelected(), input.value);
    openCombo(list, input);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      input.value = getSelected();
      closeCombo(list, input);
    }
    if (event.key === "Enter") {
      const first = list.querySelector("[data-value]");
      if (first && !list.hidden) {
        event.preventDefault();
        onSelect(first.dataset.value);
        closeCombo(list, input);
      }
    }
  });
  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-value]");
    if (!button) return;
    onSelect(button.dataset.value);
    closeCombo(list, input);
  });
  clear.addEventListener("click", () => {
    onSelect("");
    closeCombo(list, input);
    input.focus();
  });
}

bindCombo({
  input: els.cityInput,
  list: els.cityList,
  clear: els.cityClear,
  items: () => state.meta?.cities || [],
  getSelected: () => state.city,
  onSelect: setCity,
});
bindCombo({
  input: els.postInput,
  list: els.postList,
  clear: els.postClear,
  items: () => state.meta?.posts || [],
  getSelected: () => state.post,
  onSelect: setPost,
});

document.addEventListener("click", (event) => {
  if (!event.target.closest('[data-combo="city"]')) {
    els.cityInput.value = state.city;
    closeCombo(els.cityList, els.cityInput);
  }
  if (!event.target.closest('[data-combo="post"]')) {
    els.postInput.value = state.post;
    closeCombo(els.postList, els.postInput);
  }
});

async function refreshRemote() {
  els.banner.hidden = false;
  els.banner.textContent = "正在从就业信息网同步职位";
  await catalog.sync((message) => {
    els.banner.hidden = false;
    els.banner.textContent = message;
  });
  seenData = "";
  await loadMeta(true);
}

els.refreshBtn.addEventListener("click", async () => {
  els.refreshBtn.disabled = true;
  els.refreshBtn.classList.add("is-syncing");
  els.refreshBtn.textContent = "同步中";
  try {
    if (useLocal) await readJson("/api/refresh", { method: "POST" });
    else await refreshRemote();
  } catch (error) {
    showError(error);
    els.refreshBtn.disabled = false;
    els.refreshBtn.classList.remove("is-syncing");
    els.refreshBtn.textContent = "同步最新";
  }
});

async function boot() {
  try {
    const probe = await fetch("/api/meta");
    useLocal = probe.ok && (probe.headers.get("content-type") || "").includes("json");
    if (!useLocal) {
      const cached = await catalog.hydrate();
      if (cached) await loadMeta(true);
      await refreshRemote();
      return;
    }
    await loadMeta(true);
  } catch (error) {
    if (!useLocal && catalog.meta().total) {
      els.banner.hidden = false;
      els.banner.textContent = "没能完成这次同步，当前显示的是上次保存的职位。";
      return;
    }
    showError(error);
  }
}

boot();
setInterval(() => {
  if (useLocal) loadMeta(true).catch(() => {});
}, 4000);
setInterval(() => {
  if (!useLocal && catalog.meta().total && !catalog.syncing) refreshRemote().catch(() => {});
}, 10 * 60 * 1000);
