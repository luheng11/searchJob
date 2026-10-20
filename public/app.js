import { createCatalog } from "./catalog.js";
import { createNoticeCatalog, fetchNoticeDetail } from "./notices.js";

const catalog = createCatalog();
const notices = createNoticeCatalog();
let useLocal = false;

const state = {
  entry: "jobs",
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
  lede: document.querySelector("#lede"),
  statTotalLabel: document.querySelector("#statTotalLabel"),
  cityLabel: document.querySelector("#cityLabel"),
  categoryLabel: document.querySelector("#categoryLabel"),
  postLabel: document.querySelector("#postLabel"),
  entryJobs: document.querySelector("#entryJobs"),
  entryNotices: document.querySelector("#entryNotices"),
  entryJobsHint: document.querySelector("#entryJobsHint"),
  entryNoticesHint: document.querySelector("#entryNoticesHint"),
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

function isNotice() {
  return state.entry === "notices";
}

function activeCatalog() {
  return isNotice() ? notices : catalog;
}

function applyChrome() {
  document.body.classList.toggle("is-notices", isNotice());
  els.entryJobs.classList.toggle("is-active", !isNotice());
  els.entryNotices.classList.toggle("is-active", isNotice());
  els.lede.textContent = isNotice()
    ? "按单位所在地、企业行业和企业性质查看招聘公告。打开页面或点击同步，即可获取原站最新简章。"
    : "按工作城市和职位类别查看全部在招职位。打开页面或点击同步，即可获取原站最新数据。";
  els.statTotalLabel.textContent = isNotice() ? "公告" : "在招";
  els.cityLabel.textContent = isNotice() ? "所在地" : "工作城市";
  els.categoryLabel.textContent = isNotice() ? "企业行业" : "职位类别";
  els.postLabel.textContent = isNotice() ? "企业性质" : "岗位名称";
  els.cityInput.placeholder = isNotice() ? "全部地区" : "全部城市";
  els.postInput.placeholder = isNotice() ? "全部性质" : "全部岗位";
  els.keywordInput.placeholder = isNotice() ? "公告标题或公司" : "职位、公司或描述";
  els.ruler.setAttribute("aria-label", isNotice() ? "单位所在地" : "工作城市");
  document.title = isNotice() ? "招聘公告 - 建大招聘台账" : "建大招聘台账";
  const jobTotal = isNotice() ? (useLocal ? 0 : catalog.meta().total) : state.meta?.total;
  const noticeTotal = isNotice() ? state.meta?.total : notices.meta().total;
  if (jobTotal) els.entryJobsHint.textContent = `${jobTotal} 个在招职位`;
  if (noticeTotal) els.entryNoticesHint.textContent = `${noticeTotal} 份招聘简章`;
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
    els.banner.textContent = `同步没有完成：${meta.error}。当前显示的是上次成功同步的内容。`;
  } else if (meta?.syncing && !meta.total) {
    els.banner.hidden = false;
    els.banner.textContent = isNotice()
      ? "正在从就业信息网拉取招聘公告。"
      : "正在从就业信息网拉取全部职位，第一次大约需要十几秒。";
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
  const options = [`<option value="">${isNotice() ? "全部行业" : "全部类别"}</option>`].concat(
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
  els.resultLine.textContent = total
    ? isNotice()
      ? `当前 ${total} 份公告`
      : `当前 ${total} 个职位`
    : isNotice()
      ? "没有符合条件的公告"
      : "没有符合条件的职位";

  if (!payload.jobs.length) {
    els.jobList.innerHTML = `<div class="empty">${isNotice() ? "换一个地区、行业，或清空关键词后再查。" : "换一个城市、类别，或清空关键词后再查。"}</div>`;
  } else if (isNotice()) {
    els.jobList.innerHTML = payload.jobs
      .map((notice) => {
        const today = notice.publishTime === state.today;
        return `<article class="job-card ${notice.jid === state.selected ? "is-selected" : ""}" data-jid="${esc(notice.jid)}" tabindex="0">
          <div class="job-top"><h2>${esc(notice.title)}</h2></div>
          <p class="company">${esc(notice.company)}</p>
          <div class="meta">
            <span>${esc(notice.location || "地点未填写")}</span>
            ${notice.scale ? `<span>${esc(notice.scale)}</span>` : ""}
            <span class="${today ? "today" : ""}">${today ? "今日" : esc(notice.publishTime)}</span>
          </div>
          <div class="tags">
            ${notice.industry ? `<span class="tag">${esc(notice.industry)}</span>` : ""}
            ${notice.nature ? `<span class="tag">${esc(notice.nature)}</span>` : ""}
          </div>
        </article>`;
      })
      .join("");
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

function sanitizeHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  template.content.querySelectorAll("script, style, iframe, object, embed, link, meta").forEach((node) => node.remove());
  template.content.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "style" || name === "srcdoc" || name === "color" || name === "face" || name === "size" || name === "bgcolor") {
        node.removeAttribute(attr.name);
      }
      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(attr.value)) node.removeAttribute(attr.name);
    });
    if (node.tagName === "IMG") {
      const src = node.getAttribute("src") || "";
      if (src && !/^https?:/i.test(src) && !src.startsWith("data:")) {
        node.setAttribute("src", new URL(src, "https://ahjzu.ahbys.com/Nw/").href);
      }
    }
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noreferrer");
    }
  });
  return template.innerHTML;
}

function renderNoticeDetail(notice, detail) {
  const original = `https://ahjzu.ahbys.com/Nw/job2.html?id=${notice.jid}${notice.cid ? `&cid=${notice.cid}` : ""}`;
  const company = notice.cid ? `https://ahjzu.ahbys.com/Nw/company.html?cid=${notice.cid}` : "";
  const contact = detail?.contact || {};
  const website = /^https?:\/\//i.test(contact.website || "") ? contact.website : "";
  els.detail.classList.add("is-open");
  els.detail.innerHTML = `
    <div class="detail-head">
      <p class="detail-kicker">招聘简章</p>
      <button type="button" class="close-detail" id="closeDetail">关闭</button>
    </div>
    <h2>${esc(detail?.title || notice.title)}</h2>
    <p class="detail-company">${company ? `<a href="${company}" target="_blank" rel="noreferrer">${esc(notice.company)}</a>` : esc(notice.company)}</p>
    <p class="detail-meta">
      ${esc(notice.location || "地点未填写")}
      ${notice.industry ? ` · ${esc(notice.industry)}` : ""}
      ${notice.nature ? ` · ${esc(notice.nature)}` : ""}
      ${notice.scale ? ` · ${esc(notice.scale)}` : ""}
      · 发布于 ${esc(notice.publishTime || "未知")}
    </p>
    ${contact.person || contact.phone || contact.email || website ? `<p class="contact-line">${[
      contact.person ? `联系人 ${esc(contact.person)}` : "",
      contact.phone ? esc(contact.phone) : "",
      contact.email ? esc(contact.email) : "",
      website ? `<a href="${esc(website)}" target="_blank" rel="noreferrer">网申入口</a>` : "",
    ].filter(Boolean).join(" · ")}</p>` : ""}
    <div class="brochure">${detail?.content ? sanitizeHtml(detail.content) : "原站没有返回简章正文。"}</div>
    <div class="detail-actions">
      <a class="link-btn" href="${original}" target="_blank" rel="noreferrer">在原站查看</a>
    </div>
  `;
}

function renderDetail(job) {
  if (!job) {
    els.detail.classList.remove("is-open");
    els.detail.innerHTML = `<div class="detail-empty"><p class="detail-kicker">${isNotice() ? "招聘简章" : "岗位说明"}</p><p>${isNotice() ? "从左侧选一份公告，这里会展开简章正文。" : "从左侧选一条职位，这里会展开岗位描述和任职要求。"}</p></div>`;
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
  const meta = isNotice() ? notices.meta() : useLocal ? await readJson("/api/meta") : catalog.meta();
  const dataStamp = `${meta.updatedAt || ""}|${meta.total}`;
  state.meta = meta;
  state.today = shanghaiToday();
  renderStats();
  if (dataStamp === seenData) return false;
  seenData = dataStamp;
  renderRuler();
  renderCategoryOptions();
  applyChrome();
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
  const payload = isNotice()
    ? notices.query({
        city: state.city,
        category: state.category,
        post: state.post,
        q: state.q,
        page: state.page,
      })
    : useLocal
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
  if (isNotice()) {
    const notice = notices.item(jid);
    if (!notice) throw new Error("没有找到这份公告");
    els.detail.classList.add("is-open");
    els.detail.innerHTML = `<div class="detail-empty"><p class="detail-kicker">招聘简章</p><p>正在读取简章…</p></div>`;
    const detail = await fetchNoticeDetail(notice.jid, notice.cid);
    if (state.selected !== jid) return;
    renderNoticeDetail(notice, detail);
  } else {
    const job = useLocal ? await readJson(`/api/jobs/${jid}`) : catalog.job(jid);
    if (!job) throw new Error("没有找到这条职位");
    renderDetail(job);
  }
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
  const source = activeCatalog();
  els.banner.hidden = false;
  els.banner.textContent = isNotice() ? "正在同步招聘公告" : "正在从就业信息网同步职位";
  await source.sync((message) => {
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

function readEntry() {
  return new URLSearchParams(location.search).get("entry") === "notices" ? "notices" : "jobs";
}

async function setEntry(entry) {
  if (state.entry === entry) return;
  state.entry = entry;
  state.city = "";
  state.category = "";
  state.post = "";
  state.q = "";
  state.page = 1;
  state.selected = "";
  state.sort = "time";
  seenData = "";
  els.keywordInput.value = "";
  els.categorySelect.value = "";
  document.querySelectorAll(".sort-btn").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.sort === "time");
  });
  const url = new URL(location.href);
  if (entry === "notices") url.searchParams.set("entry", "notices");
  else url.searchParams.delete("entry");
  history.pushState({ entry }, "", url);
  applyChrome();
  syncComboInputs();
  renderDetail(null);
  await showEntry();
}

async function showEntry() {
  const source = activeCatalog();
  if (isNotice() || !useLocal) {
    if (!source.meta().total) {
      const cached = await source.hydrate();
      if (cached) await loadMeta(true);
    }
    if (!source.meta().updatedAt || Date.now() - new Date(source.meta().updatedAt).getTime() > 10 * 60 * 1000) {
      await refreshRemote();
    } else {
      await loadMeta(true);
    }
    return;
  }
  await loadMeta(true);
}

async function boot() {
  try {
    useLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    state.entry = readEntry();
    applyChrome();
    await showEntry();
  } catch (error) {
    if (activeCatalog().meta().total) {
      els.banner.hidden = false;
      els.banner.textContent = "没能完成这次同步，当前显示的是上次保存的内容。";
      return;
    }
    showError(error);
  }
}

document.querySelector(".entries").addEventListener("click", (event) => {
  const button = event.target.closest("[data-entry]");
  if (!button) return;
  setEntry(button.dataset.entry).catch(showError);
});

window.addEventListener("popstate", () => {
  const entry = readEntry();
  if (entry === state.entry) return;
  state.entry = entry;
  state.page = 1;
  state.selected = "";
  seenData = "";
  applyChrome();
  renderDetail(null);
  showEntry().catch(showError);
});

boot();
setInterval(() => {
  if (useLocal && !isNotice()) loadMeta(true).catch(() => {});
}, 4000);
setInterval(() => {
  const source = activeCatalog();
  if ((isNotice() || !useLocal) && source.meta().total && !source.syncing) refreshRemote().catch(() => {});
}, 10 * 60 * 1000);
