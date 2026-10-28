const grid = document.getElementById("video-grid");
const dialog = document.getElementById("video-dialog");
const form = document.getElementById("video-form");
const search = document.getElementById("search");
const previewDialog = document.getElementById("preview-dialog");
const statusFilter = document.getElementById("filter-status");
const sourceFilter = document.getElementById("filter-source");
const categoryFilter = document.getElementById("filter-category");
const streamerFilter = document.getElementById("filter-streamer");
const productFilter = document.getElementById("filter-product");
const tagInput = document.getElementById("video-tags");
const tagChipList = document.getElementById("video-tag-chips");
const tagEditor = document.getElementById("tag-editor");
const posterInput = document.getElementById("video-poster");
const posterPreviewImage = document.getElementById("poster-preview-image");
const posterPreviewEmpty = document.getElementById("poster-preview-empty");
const posterRemoveButton = document.getElementById("poster-remove");
const clearFiltersButton = document.getElementById("clear-filters");
const activeFiltersCount = document.getElementById("filter-active-count");
let editing = null;
let state = { enabled: true, hiddenIds: [], overrides: {}, videos: [] };
let apiAvailable = false;
let toastTimer;
let modalScrollY = null;
let videoTags = [];
let posterRemoved = false;
let posterObjectUrl = null;
const LIKE_COUNTS_KEY = "tututiktok-like-counts-v1";
let reportStats = { byVideo: {} };

function loadLikeCounts() {
  try {
    const value = JSON.parse(localStorage.getItem(LIKE_COUNTS_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch (error) { return {}; }
}

const likeCounts = loadLikeCounts();

function likeCountFor(videoId) {
  const stored = Number(likeCounts[videoId]);
  if (Number.isInteger(stored) && stored >= 11) return stored;
  const initial = 11 + Math.floor(Math.random() * 40);
  likeCounts[videoId] = initial;
  try { localStorage.setItem(LIKE_COUNTS_KEY, JSON.stringify(likeCounts)); } catch (error) { /* storage may be unavailable */ }
  return initial;
}

function syncModalScroll() {
  if (document.querySelector("dialog[open]")) {
    if (modalScrollY !== null) return;
    modalScrollY = window.scrollY;
    document.body.style.top = `${-modalScrollY}px`;
    document.body.classList.add("modal-open");
  } else if (modalScrollY !== null) {
    const restoreY = modalScrollY;
    modalScrollY = null;
    document.body.classList.remove("modal-open");
    document.body.style.removeProperty("top");
    window.scrollTo(0, restoreY);
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Ошибка сервера: ${response.status}`);
  return data;
}

function toast(message) {
  const node = document.getElementById("toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 3500);
}

function allVideos() {
  const seeds = DEFAULT_FEED.map((item) => ({
    ...item, ...(state.overrides?.[item.id] || {}), source: "kinescope", active: !state.hiddenIds.includes(item.id), seed: true,
  }));
  return [...seeds, ...state.videos.map((item) => ({ ...item, seed: false }))];
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name) {
  const node = el("i", `ui-icon icon-${name}`);
  node.setAttribute("aria-hidden", "true");
  return node;
}

function renderTagChips() {
  tagChipList.replaceChildren(...videoTags.map((tag, index) => {
    const chip = el("span", "tag-chip");
    const remove = el("button", "tag-chip-remove");
    remove.type = "button";
    remove.setAttribute("aria-label", `Удалить тег «${tag}»`);
    remove.append(icon("cross"));
    remove.addEventListener("pointerdown", (event) => event.preventDefault());
    remove.addEventListener("click", () => {
      videoTags.splice(index, 1);
      renderTagChips();
      tagInput.focus();
    });
    chip.append(el("span", "tag-chip-label", tag), remove);
    return chip;
  }));
  tagInput.placeholder = videoTags.length ? "Ещё тег…" : "Введите тег";
}

function addVideoTags(raw) {
  const incoming = raw.split(/[,\n]+/).map((tag) => tag.trim()).filter(Boolean);
  const next = [...videoTags];
  for (const tag of incoming) {
    if (tag.length > 40) throw new Error("Тег не может быть длиннее 40 символов");
    if (next.some((existing) => existing.toLocaleLowerCase("ru") === tag.toLocaleLowerCase("ru"))) continue;
    if (next.length >= 10) throw new Error("Можно добавить до 10 тегов");
    next.push(tag);
  }
  videoTags = next;
  tagInput.value = "";
  renderTagChips();
}

function commitTagInput() {
  if (tagInput.value.trim()) addVideoTags(tagInput.value);
}

function openPreview(item) {
  if (previewDialog.open) return;
  document.getElementById("preview-title").textContent = item.title;
  const frame = el("iframe", "preview-frame");
  frame.src = `index.html?video=${encodeURIComponent(item.id)}&preview=1`;
  frame.title = `Предпросмотр: ${item.title}`;
  frame.allow = "autoplay; fullscreen; picture-in-picture";
  document.getElementById("preview-body").replaceChildren(frame);
  previewDialog.showModal();
  syncModalScroll();
}

function menuAction(label, iconName, callback, danger = false) {
  const button = el("button", danger ? "menu-action danger" : "menu-action");
  button.type = "button";
  button.append(icon(iconName), document.createTextNode(label));
  button.addEventListener("click", callback);
  return button;
}

function renderCard(item) {
  const card = el("article", "video-card" + (item.active ? "" : " is-inactive"));
  const top = el("div", "card-top");
  const posterBox = el("div", "poster-box");
  if (item.posterUrl) {
    const img = el("img"); img.src = item.posterUrl; img.alt = ""; img.loading = "lazy"; posterBox.append(img);
  } else if (item.source === "upload") {
    const video = el("video");
    video.src = item.mediaUrl;
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    posterBox.append(video);
  } else {
    const img = el("img");
    img.src = `https://kinescope.io/${item.id}/poster.jpg`;
    img.alt = "";
    img.loading = "lazy";
    posterBox.append(img);
  }
  const playMark = el("span", "play-mark");
  const playIcon = el("i", "ui-icon icon-play");
  playIcon.setAttribute("aria-hidden", "true");
  playMark.append(playIcon);
  posterBox.append(playMark);
  posterBox.setAttribute("role", "button");
  posterBox.setAttribute("tabindex", "0");
  posterBox.setAttribute("aria-label", `Смотреть ${item.title}`);
  posterBox.addEventListener("click", () => openPreview(item));
  posterBox.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPreview(item); } });
  const info = el("div", "card-info");
  const status = el("div", "status-row");
  const menu = el("details", "card-menu");
  const trigger = el("summary", "menu-trigger");
  trigger.setAttribute("aria-label", `Действия с видео ${item.title}`);
  trigger.append(icon("menu-dots-vertical"));
  const popup = el("div", "menu-popup");
  popup.append(menuAction("Предпросмотр", "eye", () => { menu.open = false; openPreview(item); }));
  const feedLink = el("a", "menu-action", "Открыть в ленте");
  feedLink.prepend(icon("link"));
  feedLink.href = `index.html?video=${encodeURIComponent(item.id)}`;
  feedLink.target = "_blank";
  feedLink.rel = "noopener";
  popup.append(feedLink);
  if (apiAvailable) {
    popup.append(menuAction("Редактировать", "edit", () => { menu.open = false; openForm(item); }));
    popup.append(menuAction(item.active ? "Скрыть" : "Опубликовать", item.active ? "eye-crossed" : "eye", async () => {
      menu.open = false;
      try {
        await api(`/api/${item.seed ? "seed" : "videos"}/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !item.active }) });
        state = await api("/api/state"); render(); toast(item.active ? "Видео скрыто" : "Видео опубликовано");
      } catch (error) { toast(error.message); }
    }));
    if (!item.seed && item.source === "upload") {
      const download = el("a", "menu-action", "Скачать файл");
      download.prepend(icon("download"));
      download.href = item.mediaUrl;
      download.download = `${item.title}.${item.mediaUrl.endsWith(".webm") ? "webm" : "mp4"}`;
      popup.append(download);
    }
  }
  menu.append(trigger, popup);
  const label = el("label", "card-switch");
  const toggle = el("input");
  toggle.type = "checkbox";
  toggle.checked = item.active;
  toggle.disabled = !apiAvailable;
  toggle.setAttribute("aria-label", `Публикация видео «${item.title}»`);
  toggle.addEventListener("change", async () => {
    toggle.disabled = true;
    try {
      await api(`/api/${item.seed ? "seed" : "videos"}/${item.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: toggle.checked }),
      });
      state = await api("/api/state");
      render();
      toast(toggle.checked ? "Видео добавлено в ленту" : "Видео скрыто из ленты");
    } catch (error) {
      toggle.checked = item.active;
      toggle.disabled = false;
      toast(error.message);
    }
  });
  label.append(toggle, el("span", "switch-track"), el("span", "status-label", item.active ? "В ленте" : "Скрыто"));
  status.append(label, menu);
  info.append(status, el("h3", "video-title", item.title));
  const rawDescription = (item.text || "").trim();
  const repeatsTitle = rawDescription.toLocaleLowerCase("ru").startsWith(item.title.toLocaleLowerCase("ru"))
    && (!rawDescription[item.title.length] || /[.。!！?？:：\s–—-]/.test(rawDescription[item.title.length]));
  const description = (repeatsTitle ? rawDescription.slice(item.title.length).replace(/^[.。!！?？:：\s–—-]+/, "") : rawDescription).trim();
  if (description) info.append(el("p", "video-text", description));
  const meta = el("div", "card-meta");
  const author = (state.streamers || []).find((person) => person.id === item.streamerId);
  if (item.tags?.length) {
    for (const tag of item.tags) meta.append(el("span", "meta-chip meta-tags", tag));
  }
  if (meta.childElementCount) info.append(meta);
  top.append(posterBox, info);
  card.append(top);

  const facts = el("dl", "video-facts");
  const factValues = [
    ["Источник", item.source === "upload" ? "Загруженный файл" : "Кинескоп"],
    ["ID", item.id],
    ["Автор", author?.name || (item.streamerId ? "Автор не найден" : "Не назначен")],
  ];
  for (const [name, value] of factValues) {
    const key = name === "Источник" ? "source" : name === "ID" ? "id" : "author";
    const fact = el("div", `video-fact video-fact-${key}`);
    const detail = el("dd", name === "Автор" && !author ? "is-empty" : "", value);
    detail.title = value;
    const factIcon = key === "source" ? "video-camera" : key === "id" ? "copy" : "user";
    const label = el("dt", "");
    label.append(icon(factIcon), document.createTextNode(name));
    fact.append(label, detail);
    facts.append(fact);
  }
  card.append(facts);

  const metrics = el("div", "video-metrics");
  const likeMetric = el("span", "video-metric");
  likeMetric.append(el("i", "like-metric-icon"), el("strong", "", String(likeCountFor(item.id))));
  likeMetric.setAttribute("aria-label", `Лайки: ${likeCountFor(item.id)}`);
  const viewCount = reportStats.byVideo?.[item.id]?.view || 0;
  const viewMetric = el("span", "video-metric");
  viewMetric.append(icon("eye"), el("strong", "", String(viewCount)));
  viewMetric.setAttribute("aria-label", `Просмотры: ${viewCount}`);
  metrics.append(likeMetric, viewMetric);
  card.append(metrics);

  const offers = el("div", "admin-offers");
  for (const offer of item.offers || []) {
    const offerCard = el(offer.href ? "a" : "div", "admin-offer");
    if (offer.href) {
      offerCard.href = offer.href;
      offerCard.target = "_blank";
      offerCard.rel = "noopener noreferrer";
    }
    offerCard.setAttribute("aria-label", offer.label || offer.title || "Оффер");
    const thumb = el("img", "admin-offer-thumb");
    thumb.src = offer.image || item.posterUrl || `https://kinescope.io/${item.id}/poster.jpg`;
    thumb.alt = "";
    thumb.loading = "lazy";
    const offerText = el("span", "admin-offer-text");
    offerText.append(el("strong", "admin-offer-title", offer.title || "Оффер"));
    if (offer.price) offerText.append(el("span", "admin-offer-price", offer.price));
    offerCard.append(thumb, offerText, el("span", "admin-offer-arrow", "›"));
    offers.append(offerCard);
  }
  if (offers.childElementCount) card.append(offers);

  const footer = el("div", "card-footer");
  const offerNote = el("span", "offer-note", item.offers?.length ? `${item.offers.length} ${item.offers.length === 1 ? "оффер" : "оффера"}` : "Без офферов");
  footer.append(offerNote);
  if (!item.seed && apiAvailable) {
    const remove = el("button", "");
    const removeIcon = el("i", "ui-icon icon-trash");
    removeIcon.setAttribute("aria-hidden", "true");
    remove.append(removeIcon, document.createTextNode("Удалить"));
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!confirm(`Удалить «${item.title}» из библиотеки?`)) return;
      try {
        await api(`/api/videos/${item.id}`, { method: "DELETE" });
        state = await api("/api/state");
        render();
        toast("Видео удалено из библиотеки");
      } catch (error) { toast(error.message); }
    });
    remove.className = "menu-action danger";
    popup.append(remove);
  }
  if (!offers.childElementCount) card.append(footer);
  return card;
}

function render() {
  const videos = allVideos();
  const previousStreamer = streamerFilter.value;
  const previousProduct = productFilter.value;
  streamerFilter.replaceChildren(new Option("Все авторы", "all"), ...(state.streamers || []).map((item) => new Option(item.name, item.id)));
  streamerFilter.value = [...streamerFilter.options].some((item) => item.value === previousStreamer) ? previousStreamer : "all";
  productFilter.replaceChildren(new Option("Все товары", "all"), ...(state.products || []).map((item) => new Option(`${item.sku} · ${item.title}`, item.id)));
  productFilter.value = [...productFilter.options].some((item) => item.value === previousProduct) ? previousProduct : "all";
  const query = search.value.trim().toLocaleLowerCase("ru");
  const filtered = videos.filter((item) => {
    const searchable = `${item.id} ${item.title} ${item.text} ${(item.tags || []).join(" ")} ${(item.offers || []).map((offer) => offer.title).join(" ")}`.toLocaleLowerCase("ru");
    return searchable.includes(query)
      && (statusFilter.value === "all" || item.active === (statusFilter.value === "active"))
      && (sourceFilter.value === "all" || item.source === sourceFilter.value)
      && (categoryFilter.value === "all" || item.category === categoryFilter.value)
      && (streamerFilter.value === "all" || item.streamerId === streamerFilter.value)
      && (productFilter.value === "all" || (item.offers || []).some((offer) => offer.productId === productFilter.value));
  });
  grid.replaceChildren(...filtered.map(renderCard));
  document.getElementById("video-count").textContent = String(videos.length);
  document.getElementById("result-count").textContent = `Показано ${filtered.length} из ${videos.length}`;
  document.getElementById("empty-state").hidden = filtered.length > 0;
  const activeFilters = [statusFilter, sourceFilter, categoryFilter, streamerFilter, productFilter].filter((control) => control.value !== "all").length
    + Number(!!query);
  activeFiltersCount.textContent = String(activeFilters);
  activeFiltersCount.hidden = activeFilters === 0;
  clearFiltersButton.disabled = activeFilters === 0;
  for (const control of [statusFilter, sourceFilter, categoryFilter, streamerFilter, productFilter]) {
    control.closest(".filter-field").classList.toggle("is-active", control.value !== "all");
  }
  document.querySelectorAll("#video-section select").forEach((select) => select.updateCustomSelect?.());
}

function clearFilters() {
  search.value = "";
  statusFilter.value = "all";
  sourceFilter.value = "all";
  categoryFilter.value = "all";
  streamerFilter.value = "all";
  productFilter.value = "all";
  render();
}

function showSource() {
  const isUpload = (editing?.source || form.elements.source.value) === "upload";
  const isEditingKinescope = !!editing && !isUpload;
  document.getElementById("kinescope-field").hidden = isUpload;
  document.getElementById("upload-field").hidden = !!editing || !isUpload;
  form.elements.kinescopeUrl.readOnly = isEditingKinescope;
  document.getElementById("kinescope-required").hidden = isEditingKinescope;
  document.getElementById("kinescope-help").textContent = isEditingKinescope
    ? "Ссылка собрана из ID ролика. Чтобы заменить видео, добавьте новый ролик."
    : "Подойдёт ссылка на ролик или его короткий ID.";
  document.getElementById("kinescope-open").hidden = !isEditingKinescope;
  renderPosterPreview();
}

function kinescopeId(value) {
  const raw = value.trim();
  let id = raw;
  if (raw.startsWith("http")) {
    const url = new URL(raw);
    if (!/(^|\.)kinescope\.io$/.test(url.hostname)) throw new Error("Нужна ссылка Кинескопа");
    id = url.pathname.split("/").filter(Boolean).pop() || "";
  }
  if (!/^[A-Za-z0-9]{10,64}$/.test(id)) throw new Error("Укажите корректную ссылку или ID Кинескопа");
  return id;
}

function releasePosterPreview() {
  if (posterObjectUrl) URL.revokeObjectURL(posterObjectUrl);
  posterObjectUrl = null;
}

function renderPosterPreview() {
  const file = posterInput.files[0];
  const savedPoster = !posterRemoved && editing?.posterUrl ? editing.posterUrl : "";
  const isKinescope = (editing?.source || form.elements.source.value) === "kinescope";
  let defaultPoster = "";
  if (isKinescope) {
    try {
      const id = editing?.id || kinescopeId(form.elements.kinescopeUrl.value);
      defaultPoster = `https://kinescope.io/${id}/poster.jpg`;
    } catch (error) { /* The source link has not been entered yet. */ }
  }
  const imageUrl = (file && posterObjectUrl) || savedPoster || defaultPoster;
  posterPreviewImage.hidden = !imageUrl;
  posterPreviewEmpty.hidden = !!imageUrl;
  posterPreviewEmpty.querySelector("span").textContent = "Нет постера";
  if (imageUrl) posterPreviewImage.src = imageUrl;
  else posterPreviewImage.removeAttribute("src");
  document.getElementById("poster-choose-label").textContent = file || savedPoster ? "Заменить постер" : "Выбрать постер";
  posterRemoveButton.hidden = !file && !savedPoster;
  const status = document.getElementById("poster-status");
  const hint = document.getElementById("poster-hint");
  if (file) {
    status.textContent = "Новый постер выбран";
    hint.textContent = file.name;
  } else if (savedPoster) {
    status.textContent = "Свой постер";
    hint.textContent = "Показывается в карточке видео и ленте.";
  } else if (defaultPoster) {
    status.textContent = "Обложка Кинескопа";
    hint.textContent = posterRemoved ? "Свой постер будет убран после сохранения." : "Используется автоматически. Можно заменить своей.";
  } else {
    status.textContent = "Постер не задан";
    hint.textContent = posterRemoved ? "Постер будет убран после сохранения." : isKinescope ? "Появится после ввода ссылки на видео." : "Для загруженного видео можно выбрать свою обложку.";
  }
}

function formOffers() {
  const offers = [];
  const productId = form.elements.offerProduct.value;
  const title = form.elements.offerTitle.value.trim();
  const price = form.elements.offerPrice.value.trim();
  const href = form.elements.offerUrl.value.trim();
  if (!title && !price && !href) return offers;
  if (!title || !href) throw new Error("Для оффера укажите название и ссылку");
  let url;
  try { url = new URL(href); } catch (error) { throw new Error("Проверьте ссылку оффера"); }
  if (url.protocol !== "https:") throw new Error("Ссылка оффера должна начинаться с https://");
  offers.push({ title, price, href, ...(productId ? { productId } : {}) });
  return offers;
}

function fillVideoReferences() {
  const streamer = form.elements.streamerId;
  streamer.replaceChildren(new Option("Не выбран", ""), ...(state.streamers || []).map((item) => new Option(item.name, item.id)));
  form.elements.offerProduct.replaceChildren(new Option("Без привязки", ""), ...(state.products || []).filter((item) => item.active).map((item) => new Option(`${item.sku} · ${item.title}`, item.id)));
}

function fillOfferFromProduct(suffix) {
  const product = (state.products || []).find((item) => item.id === form.elements[`offerProduct${suffix}`].value);
  if (!product) return;
  form.elements[`offerTitle${suffix}`].value = product.title;
  form.elements[`offerPrice${suffix}`].value = `${product.salePrice ?? product.price} ${product.currency}`;
  form.elements[`offerUrl${suffix}`].value = product.url;
}

function openForm(item = null) {
  editing = item;
  form.reset();
  releasePosterPreview();
  posterRemoved = false;
  videoTags = [...(item?.tags || [])];
  renderTagChips();
  fillVideoReferences();
  document.getElementById("form-error").hidden = true;
  document.getElementById("source-tabs").hidden = !!item;
  document.getElementById("dialog-title").textContent = item ? "Редактировать видео" : "Добавить видео";
  document.getElementById("dialog-eyebrow").textContent = item ? "ПАРАМЕТРЫ ВИДЕО" : "НОВЫЙ КОНТЕНТ";
  document.getElementById("dialog-intro").textContent = item ? `ID: ${item.id} · Источник: ${item.source === "upload" ? "файл" : "Кинескоп"}` : "Добавьте ролик из Кинескопа или загрузите файл на локальный сервер.";
  const saveButton = document.getElementById("save-button");
  saveButton.querySelector(".button-label").textContent = item ? "Сохранить изменения" : "Добавить в ленту";
  saveButton.querySelector(".icon-plus").hidden = !!item;
  if (item) {
    form.querySelector(`[name="source"][value="${item.source}"]`).checked = true;
    if (item.source === "kinescope") {
      const url = `https://kinescope.io/${item.id}`;
      form.elements.kinescopeUrl.value = url;
      document.getElementById("kinescope-open").href = url;
    }
    form.elements.title.value = item.title;
    form.elements.text.value = item.text || "";
    form.elements.category.value = item.category || "";
    form.elements.streamerId.value = item.streamerId || "";
    const offer = item.offers?.[0];
    if (offer) {
      form.elements.offerProduct.value = offer.productId || "";
      form.elements.offerTitle.value = offer.title || "";
      form.elements.offerPrice.value = offer.price || "";
      form.elements.offerUrl.value = offer.href || "";
    }
  }
  showSource();
  document.querySelectorAll("#video-dialog select").forEach((select) => select.updateCustomSelect?.());
  dialog.showModal();
  dialog.querySelector(".dialog-body").scrollTop = 0;
  syncModalScroll();
}

form.addEventListener("change", (event) => {
  if (event.target.name === "source") showSource();
  if (event.target.name === "offerProduct") fillOfferFromProduct("");
});
document.getElementById("poster-choose").addEventListener("click", () => posterInput.click());
posterInput.addEventListener("change", () => {
  const file = posterInput.files[0];
  releasePosterPreview();
  if (file) {
    if (!/\.(png|jpe?g|webp)$/i.test(file.name)) {
      posterInput.value = "";
      toast("Поддерживаются PNG, JPEG и WebP");
    } else if (file.size > 10 * 1024 * 1024) {
      posterInput.value = "";
      toast("Изображение должно быть меньше 10 МБ");
    } else {
      posterRemoved = false;
      posterObjectUrl = URL.createObjectURL(file);
    }
  }
  renderPosterPreview();
});
posterRemoveButton.addEventListener("click", () => {
  posterInput.value = "";
  releasePosterPreview();
  posterRemoved = true;
  renderPosterPreview();
});
form.elements.kinescopeUrl.addEventListener("input", () => {
  if (!editing && !posterInput.files.length) renderPosterPreview();
});
posterPreviewImage.addEventListener("error", () => {
  posterPreviewImage.hidden = true;
  posterPreviewEmpty.hidden = false;
  posterPreviewEmpty.querySelector("span").textContent = "Нет предпросмотра";
});
tagInput.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (event.key === "Enter" || event.key === ",") {
    event.preventDefault();
    try { commitTagInput(); } catch (error) { toast(error.message); }
  } else if (event.key === "Backspace" && !tagInput.value && videoTags.length) {
    videoTags.pop();
    renderTagChips();
  }
});
tagInput.addEventListener("input", (event) => {
  if (event.isComposing || !tagInput.value.includes(",")) return;
  try { addVideoTags(tagInput.value); } catch (error) { toast(error.message); }
});
tagInput.addEventListener("paste", (event) => {
  const pasted = event.clipboardData?.getData("text") || "";
  if (!/[,\n]/.test(pasted)) return;
  event.preventDefault();
  try { addVideoTags(`${tagInput.value}${pasted}`); } catch (error) { toast(error.message); }
});
tagEditor.addEventListener("click", (event) => {
  if (event.target === tagEditor || event.target === tagChipList) tagInput.focus();
});
tagInput.addEventListener("blur", (event) => {
  if (event.relatedTarget && tagEditor.contains(event.relatedTarget)) return;
  try { commitTagInput(); } catch (error) { toast(error.message); }
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorNode = document.getElementById("form-error");
  const save = document.getElementById("save-button");
  errorNode.hidden = true;
  save.disabled = true;
  save.querySelector(".button-label").textContent = "Сохранение…";
  try {
    commitTagInput();
    const source = form.elements.source.value;
    const offers = formOffers().map((offer) => ({ ...(editing?.offers?.find((existing) => existing.href === offer.href) || {}), ...offer }));
    const video = {
      source,
      title: form.elements.title.value.trim(),
      text: form.elements.text.value.trim(),
      category: form.elements.category.value,
      streamerId: form.elements.streamerId.value,
      tags: [...videoTags],
      posterUrl: posterRemoved ? "" : editing?.posterUrl || "",
      offers,
    };
    if (!video.title) throw new Error("Укажите название видео");
    if (video.tags.length > 10) throw new Error("Можно добавить до 10 тегов");
    const poster = form.elements.posterFile.files[0];
    if (poster) {
      const uploaded = await api(`/api/image-upload?filename=${encodeURIComponent(poster.name)}`, {
        method: "POST", headers: { "Content-Type": poster.type || "application/octet-stream" }, body: poster,
      });
      video.posterUrl = uploaded.mediaUrl;
    }
    if (editing) {
      await api(`/api/${editing.seed ? "seed" : "videos"}/${editing.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: video.title, text: video.text, category: video.category, streamerId: video.streamerId, tags: video.tags, posterUrl: video.posterUrl, offers }),
      });
    } else if (source === "kinescope") {
      video.id = kinescopeId(form.elements.kinescopeUrl.value);
      if (allVideos().some((item) => item.id === video.id)) throw new Error("Это видео уже есть в библиотеке");
    } else {
      const file = form.elements.videoFile.files[0];
      if (!file) throw new Error("Выберите видеофайл");
      if (file.size > 150 * 1024 * 1024) throw new Error("Размер файла больше 150 МБ");
      const upload = await api(`/api/upload?filename=${encodeURIComponent(file.name)}`, {
        method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file,
      });
      video.mediaUrl = upload.mediaUrl;
    }
    if (!editing) await api("/api/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(video) });
    const wasEditing = !!editing;
    state = await api("/api/state");
    render();
    dialog.close();
    form.reset();
    showSource();
    toast(wasEditing ? "Изменения сохранены" : "Видео добавлено в ленту");
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
  } finally {
    save.disabled = false;
    save.querySelector(".button-label").textContent = editing ? "Сохранить изменения" : "Добавить в ленту";
  }
});

document.getElementById("add-button").addEventListener("click", () => { if (!window.adminSection || window.adminSection === "videos") openForm(); });
document.getElementById("dialog-close").addEventListener("click", () => dialog.close());
document.getElementById("dialog-cancel").addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => {
  form.reset();
  releasePosterPreview();
  posterRemoved = false;
  videoTags = [];
  renderTagChips();
  editing = null;
  document.getElementById("form-error").hidden = true;
  syncModalScroll();
});
search.addEventListener("input", render);
for (const control of [statusFilter, sourceFilter, categoryFilter, streamerFilter, productFilter]) control.addEventListener("change", render);
clearFiltersButton.addEventListener("click", clearFilters);
document.getElementById("empty-clear").addEventListener("click", clearFilters);
document.getElementById("preview-close").addEventListener("click", () => previewDialog.close());
previewDialog.addEventListener("close", () => {
  document.getElementById("preview-body").replaceChildren();
  syncModalScroll();
});
document.addEventListener("click", (event) => { document.querySelectorAll(".card-menu[open]").forEach((menu) => { if (!menu.contains(event.target)) menu.open = false; }); });
async function init() {
  try {
    state = await api("/api/state");
    apiAvailable = true;
    try { reportStats = await api("/api/reports"); } catch (error) { reportStats = { byVideo: {} }; }
  } catch (error) {
    document.getElementById("offline-alert").hidden = false;
    document.getElementById("add-button").disabled = true;
  }
  render();
}
init();
