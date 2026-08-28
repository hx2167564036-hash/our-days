/* 我们的日子 · 前端逻辑 (v2) */
"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  settings: { name_a: "我", name_b: "TA", together_date: "", passcode: "" },
  who: "我",
  mood: "",
  selectedImage: null, // { filename, url }
  placeFilter: "all",
  momentFilter: "all",
  wishLevel: 3,
  currentPage: "home",
  moments: [],
  places: [],
  activities: [],
  anniversaries: [],
  geoResults: [],
};

let editingMomentId = null;
let editingPlaceId = null;
let editingActId = null;
let editingAnniId = null;

/* ---------------- API ---------------- */
async function api(path, options = {}) {
  const opts = { headers: {}, ...options };
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.need_login) {
    showLogin();
    throw new Error("需要登录");
  }
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2000);
}

/* ---------------- 登录 ---------------- */
function showLogin() {
  $("#loginOverlay").hidden = false;
  $("#loginPasscode").value = "";
  $("#loginErr").textContent = "";
  setTimeout(() => $("#loginPasscode").focus(), 100);
}
function hideLogin() { $("#loginOverlay").hidden = true; }

async function checkAuth() {
  try {
    const d = await api("/api/auth");
    if (d.need_login) showLogin();
    return !d.need_login;
  } catch (e) { return false; }
}

async function doLogin() {
  const code = $("#loginPasscode").value.trim();
  if (!code) { $("#loginErr").textContent = "请输入口令"; return; }
  try {
    await api("/api/login", { method: "POST", body: { passcode: code } });
    hideLogin();
    toast("欢迎回来 💕");
    switchPage(state.currentPage || "home");
  } catch (e) {
    $("#loginErr").textContent = e.message;
  }
}

async function doLogout() {
  try { await api("/api/logout", { method: "POST" }); } catch (e) {}
  toast("已退出登录");
  showLogin();
}

/* ---------------- 导航 ---------------- */
function switchPage(page) {
  state.currentPage = page;
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === "page-" + page));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.page === page));
  try { history.replaceState(null, "", "#" + page); } catch (e) {}
  if (page === "home") loadOverview();
  if (page === "timeline") loadMoments();
  if (page === "wishlist") loadPlaces();
  if (page === "map") loadMap();
  if (page === "outing") loadActivities();
  if (page === "settings") loadSettings();
}

$$(".tab").forEach((t) => t.addEventListener("click", () => switchPage(t.dataset.page)));
$$(".stat-card").forEach((c) => c.addEventListener("click", () => switchPage(c.dataset.nav)));

/* ---------------- 首页 ---------------- */
async function loadOverview() {
  try {
    const d = await api("/api/overview");
    state.settings = d.settings;
    applyNames();
    renderTogether(d);
    renderAnniversaries(d.anniversaries);
    $("#statMoments").textContent = d.counts.moments;
    $("#statPlaces").textContent = d.counts.places;
    $("#statDone").textContent = d.counts.places_done;
    $("#statActs").textContent = d.counts.activities;
  } catch (e) { console.error(e); }
}

function applyNames() {
  const a = state.settings.name_a || "我";
  const b = state.settings.name_b || "TA";
  $$("#whoToggle .who-option")[0].textContent = a;
  $$("#whoToggle .who-option")[1].textContent = b;
  $$("#momentFilter .chip").forEach((c) => {
    if (c.dataset.f === "a") c.textContent = a;
    if (c.dataset.f === "b") c.textContent = b;
  });
  $("#topbarSub").textContent = `${a} & ${b} 的小世界`;
}

function renderTogether(d) {
  if (d.together_days == null) {
    $("#togetherDays").textContent = "—";
    $("#togetherSince").textContent = "在「设置」里填上在一起的日子吧";
    return;
  }
  $("#togetherDays").textContent = d.together_days;
  $("#togetherSince").textContent = "从 " + d.settings.together_date + " 开始，每一天都值得记录";
}

function renderAnniversaries(list) {
  const box = $("#anniList");
  if (!list || !list.length) {
    box.innerHTML = '<div class="empty">还没有纪念日，去设置里添加吧</div>';
    return;
  }
  box.innerHTML = list
    .map((a) => {
      let count;
      if (a.days_left == null) count = "";
      else if (a.days_left === 0) count = "🎉 就是今天！";
      else if (a.days_left > 0) count = `还有 ${a.days_left} 天`;
      else count = `已过 ${-a.days_left} 天`;
      return `<div class="anni-item">
        <div>
          <div class="anni-name">${esc(a.name)}</div>
          <div class="anni-date">${a.date}${a.is_yearly ? " · 每年" : ""}</div>
        </div>
        <div class="anni-count ${a.days_left === 0 ? "today" : ""}">${count}</div>
      </div>`;
    })
    .join("");
}

/* ---------------- 时光 ---------------- */
function bindWhoToggle() {
  $$("#whoToggle .who-option").forEach((el) => {
    el.addEventListener("click", () => {
      $$("#whoToggle .who-option").forEach((x) => x.classList.remove("active"));
      el.classList.add("active");
      state.who = el.dataset.who === "TA" ? (state.settings.name_b || "TA") : (state.settings.name_a || "我");
    });
  });
}

function bindMood() {
  $$(".mood-btn").forEach((b) => {
    b.addEventListener("click", () => {
      $$(".mood-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      state.mood = b.dataset.mood;
    });
  });
}

function bindImageUpload() {
  $("#imageInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast("图片别超过 8MB 哦"); return; }
    const fd = new FormData();
    fd.append("image", file);
    try {
      const d = await api("/api/upload", { method: "POST", body: fd });
      state.selectedImage = d;
      $("#previewImg").src = d.url;
      $("#imagePreview").hidden = false;
    } catch (err) {
      toast("图片上传失败：" + err.message);
    }
    e.target.value = "";
  });
  $("#removePreview").addEventListener("click", () => {
    state.selectedImage = null;
    $("#imagePreview").hidden = true;
    $("#previewImg").src = "";
  });
}

function resetMomentComposer() {
  editingMomentId = null;
  $("#momentContent").value = "";
  state.mood = "";
  $$(".mood-btn").forEach((x) => x.classList.remove("active"));
  state.selectedImage = null;
  $("#imagePreview").hidden = true;
  $("#previewImg").src = "";
  $("#postMoment").textContent = "发布";
  $("#cancelMomentEdit").hidden = true;
}

function startEditMoment(id) {
  const m = state.moments.find((x) => x.id === id);
  if (!m) return;
  editingMomentId = id;
  $("#momentContent").value = m.content || "";
  $("#momentDate").value = m.moment_date || "";
  state.mood = m.mood || "";
  $$(".mood-btn").forEach((b) => b.classList.toggle("active", b.dataset.mood === state.mood));
  const isB = m.author && m.author === (state.settings.name_b || "TA");
  const target = isB ? "TA" : "我";
  $$("#whoToggle .who-option").forEach((el) => el.classList.toggle("active", el.dataset.who === target));
  state.who = m.author || state.settings.name_a || "我";
  state.selectedImage = m.image ? { filename: m.image, url: "/uploads/" + m.image } : null;
  if (state.selectedImage) {
    $("#previewImg").src = state.selectedImage.url;
    $("#imagePreview").hidden = false;
  } else {
    $("#imagePreview").hidden = true;
  }
  $("#postMoment").textContent = "保存修改";
  $("#cancelMomentEdit").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function postMoment() {
  const content = $("#momentContent").value.trim();
  if (!content && !state.selectedImage) { toast("写点什么或传张照片吧"); return; }
  const payload = {
    author: state.who,
    content,
    mood: state.mood,
    image: state.selectedImage ? state.selectedImage.filename : "",
    moment_date: $("#momentDate").value || null,
  };
  try {
    if (editingMomentId) {
      await api("/api/moments/" + editingMomentId, { method: "PATCH", body: payload });
      toast("已保存修改 ✏️");
    } else {
      await api("/api/moments", { method: "POST", body: payload });
      toast("发布成功 💕");
    }
    resetMomentComposer();
    loadMoments();
  } catch (err) { toast(err.message); }
}

async function loadMoments() {
  try {
    const d = await api("/api/moments");
    state.moments = d.items;
    let items = d.items;
    const f = state.momentFilter;
    if (f === "a" || f === "b") {
      const name = f === "a" ? (state.settings.name_a || "我") : (state.settings.name_b || "TA");
      items = items.filter((m) => m.author === name);
    }
    const box = $("#timeline");
    if (!items.length) {
      box.innerHTML = '<div class="empty">还没有记录，写下第一条吧</div>';
      return;
    }
    let html = "";
    let curMonth = "";
    items.forEach((m) => {
      const month = (m.moment_date || "").slice(0, 7);
      if (month !== curMonth) {
        curMonth = month;
        html += `<div class="month-header">${formatMonth(month)}</div>`;
      }
      html += renderMoment(m);
    });
    box.innerHTML = html;
    bindMomentActions(box);
  } catch (e) { console.error(e); }
}

function renderMoment(m) {
  const name = m.author || "TA";
  const initial = name[0] || "?";
  const dateLabel = m.moment_date ? formatDate(m.moment_date) : "";
  const img = m.image
    ? `<img class="moment-img" src="/uploads/${esc(m.image)}" data-full="/uploads/${esc(m.image)}" alt="照片" />`
    : "";
  return `<div class="moment">
    <button class="moment-del" data-id="${m.id}" title="删除">🗑</button>
    <button class="moment-edit" data-id="${m.id}" title="编辑">✏️</button>
    <div class="moment-head">
      <div class="moment-avatar">${esc(initial)}</div>
      <div>
        <div class="moment-author">${esc(name)}</div>
        <div class="moment-time">${dateLabel}</div>
      </div>
      <div class="moment-mood">${m.mood ? esc(m.mood) : ""}</div>
    </div>
    <div class="moment-content">${esc(m.content)}</div>
    ${img}
  </div>`;
}

function bindMomentActions(box) {
  box.querySelectorAll(".moment-del").forEach((b) => {
    b.addEventListener("click", async () => {
      if (!confirm("删除这条记录？")) return;
      try {
        await api("/api/moments/" + b.dataset.id, { method: "DELETE" });
        toast("已删除");
        loadMoments();
      } catch (e) { toast(e.message); }
    });
  });
  box.querySelectorAll(".moment-edit").forEach((b) => {
    b.addEventListener("click", () => startEditMoment(Number(b.dataset.id)));
  });
  box.querySelectorAll(".moment-img").forEach((img) => {
    img.addEventListener("click", () => showLightbox(img.dataset.full));
  });
}

/* ---------------- 想去 ---------------- */
function bindPlaceUI() {
  $$("#placeFilter .chip").forEach((c) => {
    c.addEventListener("click", () => {
      $$("#placeFilter .chip").forEach((x) => x.classList.remove("active"));
      c.classList.add("active");
      state.placeFilter = c.dataset.filter;
      loadPlaces();
    });
  });
  $$("#wishLevel .star").forEach((s) => {
    s.addEventListener("click", () => {
      state.wishLevel = Number(s.dataset.v);
      renderStars();
    });
  });
}

function renderStars() {
  $$("#wishLevel .star").forEach((s) => {
    s.classList.toggle("active", Number(s.dataset.v) <= state.wishLevel);
  });
}

function resetPlaceForm() {
  editingPlaceId = null;
  $("#placeName").value = "";
  $("#placeAddress").value = "";
  $("#placeNote").value = "";
  state.wishLevel = 3;
  renderStars();
  $("#addPlace").textContent = "➕ 收藏这个地方";
  $("#cancelPlaceEdit").hidden = true;
}

function startEditPlace(id) {
  const p = state.places.find((x) => x.id === id);
  if (!p) return;
  editingPlaceId = id;
  $("#placeName").value = p.name || "";
  $("#placeCategory").value = p.category || "其他";
  $("#placeAddress").value = p.address || "";
  $("#placeNote").value = p.note || "";
  state.wishLevel = p.wish_level || 3;
  renderStars();
  $("#addPlace").textContent = "保存修改";
  $("#cancelPlaceEdit").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function addPlace() {
  const name = $("#placeName").value.trim();
  if (!name) { toast("请填写地点名称"); return; }
  const payload = {
    name,
    category: $("#placeCategory").value,
    address: $("#placeAddress").value.trim(),
    note: $("#placeNote").value.trim(),
    wish_level: state.wishLevel,
  };
  try {
    if (editingPlaceId) {
      await api("/api/places/" + editingPlaceId, { method: "PATCH", body: payload });
      toast("已保存 ✏️");
    } else {
      await api("/api/places", { method: "POST", body: { ...payload, added_by: state.who } });
      toast("收藏成功 📍");
    }
    resetPlaceForm();
    loadPlaces();
  } catch (e) { toast(e.message); }
}

async function loadPlaces() {
  try {
    const d = await api("/api/places");
    state.places = d.items;
    let items = d.items;
    if (state.placeFilter !== "all") items = items.filter((p) => p.status === state.placeFilter);
    const box = $("#placeList");
    if (!items.length) {
      box.innerHTML = '<div class="empty">这里空空如也</div>';
      return;
    }
    box.innerHTML = items.map(renderPlace).join("");
    bindPlaceActions(box);
  } catch (e) { console.error(e); }
}

function renderPlace(p) {
  const done = p.status === "已去过";
  const stars = "★".repeat(p.wish_level) + "☆".repeat(5 - p.wish_level);
  return `<div class="place-item ${done ? "done" : ""}">
    <button class="place-del" data-id="${p.id}" title="删除">🗑</button>
    <div class="place-name">
      <span>${esc(p.name)}</span>
      <span class="place-cat">${esc(p.category)}</span>
    </div>
    <div class="place-stars">${stars}</div>
    ${p.address ? `<div class="place-addr">📍 ${esc(p.address)}</div>` : ""}
    ${p.note ? `<div class="place-note">${esc(p.note)}</div>` : ""}
    <div class="place-actions">
      <button class="mini-btn" data-edit="${p.id}">✏️ 编辑</button>
      ${done
        ? `<button class="mini-btn" data-action="undo" data-id="${p.id}">↩ 还想再去</button>`
        : `<button class="mini-btn primary" data-action="done" data-id="${p.id}">✅ 已去过</button>`}
    </div>
  </div>`;
}

function bindPlaceActions(box) {
  box.querySelectorAll("[data-action]").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = b.dataset.id;
      const status = b.dataset.action === "done" ? "已去过" : "想去";
      try {
        await api("/api/places/" + id, { method: "PATCH", body: { status } });
        toast(status === "已去过" ? "一起去过啦 🎉" : "已标记为未探索");
        loadPlaces();
      } catch (e) { toast(e.message); }
    });
  });
  box.querySelectorAll("[data-edit]").forEach((b) => {
    b.addEventListener("click", () => startEditPlace(Number(b.dataset.edit)));
  });
  box.querySelectorAll(".place-del").forEach((b) => {
    b.addEventListener("click", async () => {
      if (!confirm("删除这个地方？")) return;
      try {
        await api("/api/places/" + b.dataset.id, { method: "DELETE" });
        toast("已删除");
        loadPlaces();
      } catch (e) { toast(e.message); }
    });
  });
}

/* ---------------- 出门 ---------------- */
function resetActForm() {
  editingActId = null;
  $("#actName").value = "";
  $("#addAct").textContent = "添加";
  $("#cancelActEdit").hidden = true;
}

function startEditAct(id) {
  const a = state.activities.find((x) => x.id === id);
  if (!a) return;
  editingActId = id;
  $("#actName").value = a.name || "";
  $("#actCategory").value = a.category || "其他";
  $("#addAct").textContent = "保存";
  $("#cancelActEdit").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function addActivity() {
  const name = $("#actName").value.trim();
  if (!name) { toast("请填写活动名称"); return; }
  try {
    if (editingActId) {
      await api("/api/activities/" + editingActId, { method: "PATCH", body: { name, category: $("#actCategory").value } });
      toast("已保存 ✏️");
    } else {
      await api("/api/activities", { method: "POST", body: { name, category: $("#actCategory").value, note: "", added_by: state.who } });
      toast("已添加 🎡");
    }
    resetActForm();
    loadActivities();
  } catch (e) { toast(e.message); }
}

async function loadActivities() {
  try {
    const d = await api("/api/activities");
    state.activities = d.items;
    const box = $("#actList");
    if (!d.items.length) {
      box.innerHTML = '<div class="empty">还没有活动点子</div>';
      return;
    }
    box.innerHTML = d.items
      .map(
        (a) => `<div class="place-item">
          <button class="place-del" data-id="${a.id}" title="删除">🗑</button>
          <div class="place-name">
            <span>${esc(a.name)}</span>
            <span class="place-cat">${esc(a.category)}</span>
          </div>
          <div class="place-actions">
            <button class="mini-btn" data-edit-act="${a.id}">✏️ 编辑</button>
          </div>
        </div>`
      )
      .join("");
    box.querySelectorAll(".place-del").forEach((b) => {
      b.addEventListener("click", async () => {
        if (!confirm("删除这个活动？")) return;
        try {
          await api("/api/activities/" + b.dataset.id, { method: "DELETE" });
          toast("已删除");
          loadActivities();
        } catch (e) { toast(e.message); }
      });
    });
    box.querySelectorAll("[data-edit-act]").forEach((b) => {
      b.addEventListener("click", () => startEditAct(Number(b.dataset.editAct)));
    });
  } catch (e) { console.error(e); }
}

/* 转盘 */
let spinning = false;

async function spinRoulette() {
  if (spinning) return;
  const useActs = $("#srcActivities").checked;
  const usePlaces = $("#srcPlaces").checked;
  if (!useActs && !usePlaces) { toast("至少勾选一种抽选范围"); return; }
  const pool = [];
  if (useActs) {
    const d = await api("/api/activities");
    pool.push(...d.items.map((a) => a.name));
  }
  if (usePlaces) {
    const d = await api("/api/places");
    pool.push(...d.items.filter((p) => p.status !== "已去过").map((p) => p.name));
  }
  doSpin([...new Set(pool)]);
}

function doSpin(pool) {
  if (!pool.length) {
    toast("还没有可选的，先去添加吧");
    return;
  }
  spinning = true;
  $("#spinBtn").disabled = true;
  $("#spinBtn").style.opacity = ".5";
  const wheel = $("#roulette");
  const rounds = 5 + Math.floor(Math.random() * 4);
  const angle = Math.floor(Math.random() * 360);
  wheel.style.transform = `rotate(${rounds * 360 + angle}deg)`;
  const picked = pool[Math.floor(Math.random() * pool.length)];

  setTimeout(() => {
    $("#rouletteResult").textContent = "🎉 " + picked;
    spinning = false;
    $("#spinBtn").disabled = false;
    $("#spinBtn").style.opacity = "1";
    toast("就决定是它啦！");
  }, 4100);
}

/* ---------------- 地图 ---------------- */
let map = null;
let mapMarkers = [];

function shortName(n) { return String(n || "").split(",")[0].trim(); }

function markerIcon(visited) {
  const color = visited ? "#3f51b5" : "#e8a05c";
  return L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -14],
  });
}

function popupHtml(p) {
  const visited = p.status === "已去过";
  return `<div style="min-width:170px">
    <div style="font-weight:700;font-size:15px">${esc(p.name)}</div>
    <div style="font-size:12px;color:#888">${esc(p.category)}</div>
    ${p.note ? `<div style="font-size:13px;margin:6px 0;color:#444">${esc(p.note)}</div>` : ""}
    <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
      <button class="mini-btn ${visited ? "" : "primary"}" onclick="togglePlaceStatus(${p.id}, '${visited ? "想去" : "已去过"}')">${visited ? "↩ 未探索" : "✅ 已去过"}</button>
      <button class="mini-btn danger" onclick="delPlace(${p.id})">删除</button>
    </div>
  </div>`;
}

async function togglePlaceStatus(id, status) {
  try {
    await api("/api/places/" + id, { method: "PATCH", body: { status } });
    toast(status === "已去过" ? "一起去过啦 🎉" : "已标记为未探索");
    loadPlaces();
    renderMapMarkers();
  } catch (e) { toast(e.message); }
}

async function delPlace(id) {
  if (!confirm("删除这个地方？")) return;
  try {
    await api("/api/places/" + id, { method: "DELETE" });
    toast("已删除");
    loadPlaces();
    renderMapMarkers();
  } catch (e) { toast(e.message); }
}

function ensureMap() {
  if (map) return;
  map = L.map("map").setView([35, 105], 4);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);
}

function loadMap() {
  ensureMap();
  setTimeout(() => { if (map) map.invalidateSize(); }, 150);
  renderMapMarkers();
}

async function renderMapMarkers() {
  if (!map) return;
  mapMarkers.forEach((m) => map.removeLayer(m));
  mapMarkers = [];
  try {
    const d = await api("/api/places");
    state.places = d.items;
    const withCoords = d.items.filter((p) => p.lat != null && p.lng != null);
    const bounds = [];
    withCoords.forEach((p) => {
      const marker = L.marker([p.lat, p.lng], { icon: markerIcon(p.status === "已去过") }).addTo(map);
      marker.bindPopup(popupHtml(p));
      mapMarkers.push(marker);
      bounds.push([p.lat, p.lng]);
    });
    if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    renderUnlocated(d.items.filter((p) => p.lat == null || p.lng == null));
  } catch (e) { console.error(e); }
}

function renderUnlocated(items) {
  const box = $("#unlocatedList");
  if (!items || !items.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="section-title">📍 待定位的地点（点「定位」放到地图上）</div>` +
    items.map((p) =>
      `<div class="geo-item">
        <div class="geo-name">${esc(p.name)}</div>
        <button class="mini-btn primary" data-geolocate="${p.id}">定位</button>
      </div>`).join("");
  box.querySelectorAll("[data-geolocate]").forEach((b) => {
    b.addEventListener("click", () => geolocatePlace(Number(b.dataset.geolocate)));
  });
}

async function geolocatePlace(id) {
  const p = state.places.find((x) => x.id === id);
  if (!p) return;
  const q = ((p.address ? p.address + " " : "") + p.name).trim();
  try {
    const d = await api("/api/geocode?q=" + encodeURIComponent(q));
    if (!d.items.length) { toast("没找到这个地点的坐标"); return; }
    const r = d.items[0];
    await api("/api/places/" + id, { method: "PATCH", body: { lat: r.lat, lng: r.lng } });
    toast("已定位 📍");
    renderMapMarkers();
  } catch (e) { toast(e.message); }
}

async function searchMap() {
  const q = $("#mapSearch").value.trim();
  if (!q) { toast("输入要搜索的地点"); return; }
  const box = $("#mapSearchResults");
  box.innerHTML = '<div class="empty">搜索中…</div>';
  try {
    const d = await api("/api/geocode?q=" + encodeURIComponent(q));
    if (!d.items.length) { box.innerHTML = '<div class="empty">没找到，换个关键词试试</div>'; return; }
    state.geoResults = d.items;
    box.innerHTML = d.items.map((it, i) =>
      `<div class="geo-item" data-addgeo="${i}">
        <div class="geo-name">${esc(shortName(it.name))}</div>
        <span style="font-size:12px;color:#888">＋ 收藏</span>
      </div>`).join("");
    box.querySelectorAll("[data-addgeo]").forEach((el) => {
      el.addEventListener("click", () => addGeoPlace(Number(el.dataset.addgeo)));
    });
  } catch (e) {
    box.innerHTML = `<div class="empty">搜索失败：${esc(e.message)}</div>`;
  }
}

async function addGeoPlace(idx) {
  const r = state.geoResults[idx];
  if (!r) return;
  try {
    await api("/api/places", {
      method: "POST",
      body: { name: shortName(r.name), category: "其他", address: r.name, lat: r.lat, lng: r.lng },
    });
    toast("已收藏 📍");
    $("#mapSearch").value = "";
    $("#mapSearchResults").innerHTML = "";
    state.geoResults = [];
    renderMapMarkers();
  } catch (e) { toast(e.message); }
}

/* ---------------- 设置 ---------------- */
async function loadSettings() {
  try {
    const d = await api("/api/settings");
    state.settings = d.settings;
    $("#setNameA").value = d.settings.name_a;
    $("#setNameB").value = d.settings.name_b;
    $("#setTogether").value = d.settings.together_date;
    $("#setPasscode").value = d.settings.passcode || "";
    loadAnniversaryManage();
  } catch (e) { console.error(e); }
}

async function saveBasic() {
  try {
    await api("/api/settings", {
      method: "POST",
      body: {
        name_a: $("#setNameA").value.trim() || "我",
        name_b: $("#setNameB").value.trim() || "TA",
        together_date: $("#setTogether").value,
      },
    });
    toast("保存成功 💕");
    applyNames();
    loadOverview();
  } catch (e) { toast(e.message); }
}

async function savePasscode() {
  const code = $("#setPasscode").value.trim();
  try {
    await api("/api/settings", { method: "POST", body: { passcode: code } });
    if (code) {
      await api("/api/login", { method: "POST", body: { passcode: code } }).catch(() => {});
      toast("口令已开启 🔒");
    } else {
      toast("口令已关闭");
    }
  } catch (e) { toast(e.message); }
}

async function exportData() {
  try {
    const res = await fetch("/api/export");
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || "导出失败");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "our-days-backup.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("已导出 💾");
  } catch (e) { toast(e.message); }
}

function resetAnniForm() {
  editingAnniId = null;
  $("#anniName").value = "";
  $("#anniDate").value = "";
  $("#anniYearly").checked = true;
  $("#addAnni").textContent = "添加纪念日";
  $("#cancelAnniEdit").hidden = true;
}

function startEditAnni(id) {
  const a = state.anniversaries.find((x) => x.id === id);
  if (!a) return;
  editingAnniId = id;
  $("#anniName").value = a.name || "";
  $("#anniDate").value = a.date || "";
  $("#anniYearly").checked = !!a.is_yearly;
  $("#addAnni").textContent = "保存修改";
  $("#cancelAnniEdit").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function addAnniversary() {
  const name = $("#anniName").value.trim();
  const date = $("#anniDate").value;
  if (!name || !date) { toast("请填写名称和日期"); return; }
  try {
    if (editingAnniId) {
      await api("/api/anniversaries/" + editingAnniId, {
        method: "PATCH",
        body: { name, date, is_yearly: $("#anniYearly").checked },
      });
      toast("已保存 ✏️");
    } else {
      await api("/api/anniversaries", {
        method: "POST",
        body: { name, date, is_yearly: $("#anniYearly").checked },
      });
      toast("添加成功 🗓");
    }
    resetAnniForm();
    loadAnniversaryManage();
  } catch (e) { toast(e.message); }
}

async function loadAnniversaryManage() {
  try {
    const d = await api("/api/anniversaries");
    state.anniversaries = d.items;
    const box = $("#anniManageList");
    if (!d.items.length) {
      box.innerHTML = '<div class="empty">还没有纪念日</div>';
      return;
    }
    box.innerHTML = d.items
      .map(
        (a) => `<div class="anni-item">
          <div>
            <div class="anni-name">${esc(a.name)}</div>
            <div class="anni-date">${a.date}${a.is_yearly ? " · 每年" : ""}</div>
          </div>
          <div class="place-actions">
            <button class="mini-btn" data-edit-anni="${a.id}">编辑</button>
            <button class="mini-btn danger" data-del-anni="${a.id}">删除</button>
          </div>
        </div>`
      )
      .join("");
    box.querySelectorAll("[data-del-anni]").forEach((b) => {
      b.addEventListener("click", async () => {
        if (!confirm("删除这个纪念日？")) return;
        try {
          await api("/api/anniversaries/" + b.dataset.delAnni, { method: "DELETE" });
          toast("已删除");
          loadAnniversaryManage();
        } catch (e) { toast(e.message); }
      });
    });
    box.querySelectorAll("[data-edit-anni]").forEach((b) => {
      b.addEventListener("click", () => startEditAnni(Number(b.dataset.editAnni)));
    });
  } catch (e) { console.error(e); }
}

/* ---------------- 工具 ---------------- */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(s) {
  const d = new Date(s + "T00:00:00");
  if (isNaN(d)) return s;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today - that) / 86400000);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  if (diff === -1) return "明天";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatMonth(ym) {
  if (!ym) return "更早";
  const [y, m] = ym.split("-");
  return `${y}年${Number(m)}月`;
}

function showLightbox(src) {
  const lb = document.createElement("div");
  lb.className = "lightbox";
  lb.innerHTML = `<img src="${src}" alt="大图" />`;
  lb.addEventListener("click", () => lb.remove());
  document.body.appendChild(lb);
}

/* ---------------- 初始化 ---------------- */
function bindEvents() {
  bindWhoToggle();
  bindMood();
  bindImageUpload();
  bindPlaceUI();

  $$("#momentFilter .chip").forEach((c) => {
    c.addEventListener("click", () => {
      $$("#momentFilter .chip").forEach((x) => x.classList.remove("active"));
      c.classList.add("active");
      state.momentFilter = c.dataset.f;
      loadMoments();
    });
  });

  $("#postMoment").addEventListener("click", postMoment);
  $("#cancelMomentEdit").addEventListener("click", resetMomentComposer);
  $("#addPlace").addEventListener("click", addPlace);
  $("#cancelPlaceEdit").addEventListener("click", resetPlaceForm);
  $("#addAct").addEventListener("click", addActivity);
  $("#cancelActEdit").addEventListener("click", resetActForm);
  $("#saveBasic").addEventListener("click", saveBasic);
  $("#savePasscode").addEventListener("click", savePasscode);
  $("#logoutBtn").addEventListener("click", doLogout);
  $("#exportBtn").addEventListener("click", exportData);
  $("#addAnni").addEventListener("click", addAnniversary);
  $("#cancelAnniEdit").addEventListener("click", resetAnniForm);
  $("#loginBtn").addEventListener("click", doLogin);
  $("#loginPasscode").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  $("#spinBtn").addEventListener("click", spinRoulette);
  $("#roulette").addEventListener("click", spinRoulette);
  $("#mapSearchBtn").addEventListener("click", searchMap);
  $("#mapSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") searchMap(); });
  $("#momentDate").value = new Date().toISOString().slice(0, 10);
}

async function init() {
  bindEvents();
  renderStars();
  const initial = (location.hash || "").replace("#", "");
  state.currentPage = initial && document.getElementById("page-" + initial) ? initial : "home";
  const ok = await checkAuth();
  if (ok) switchPage(state.currentPage);
}

document.addEventListener("DOMContentLoaded", init);
