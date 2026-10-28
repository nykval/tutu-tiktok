const grid = document.getElementById("video-grid");
const dialog = document.getElementById("video-dialog");
const form = document.getElementById("video-form");
const search = document.getElementById("search");
const previewDialog = document.getElementById("preview-dialog");
const statusFilter = document.getElementById("filter-status");
const sourceFilter = document.getElementById("filter-source");
const collectionFilter = document.getElementById("filter-collection");
const categoryFilter = document.getElementById("filter-category");
const streamerFilter = document.getElementById("filter-streamer");
const productFilter = document.getElementById("filter-product");
const tagFilter = document.getElementById("filter-tag");
const sortBy = document.getElementById("sort-by");
const clearFiltersButton = document.getElementById("clear-filters");
const activeFiltersCount = document.getElementById("filter-active-count");
let editing = null;
let state = { enabled: true, hiddenIds: [], overrides: {}, videos: [] };
let apiAvailable = false;
let toastTimer;
let previewScrollY = 0;

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

function openPreview(item) {
  if (previewDialog.open) return;
  document.getElementById("preview-title").textContent = item.title;
  const frame = el("iframe", "preview-frame");
  frame.src = `index.html?video=${encodeURIComponent(item.id)}&preview=1`;
  frame.title = `Предпросмотр: ${item.title}`;
  frame.allow = "autoplay; fullscreen; picture-in-picture";
  document.getElementById("preview-body").replaceChildren(frame);
  previewScrollY = window.scrollY;
  document.body.style.setProperty("--preview-scroll-offset", `${-previewScrollY}px`);
  document.body.classList.add("preview-open");
  previewDialog.showModal();
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
  if (item.collection) meta.append(el("span", "meta-chip", item.collection));
  const author = (state.streamers || []).find((person) => person.id === item.streamerId);
  if (item.tags?.length) {
    const tags = el("span", "meta-chip meta-tags", item.tags.join(", "));
    tags.title = `Теги: ${item.tags.join(", ")}`;
    meta.append(tags);
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
    const fact = el("div", "video-fact");
    const detail = el("dd", name === "Автор" && !author ? "is-empty" : "", value);
    detail.title = value;
    fact.append(el("dt", "", name), detail);
    facts.append(fact);
  }
  card.append(facts);

  const footer = el("div", "card-footer");
  const offerNote = el("span", "offer-note", item.offers?.length ? `${item.offers.length === 1 ? "Оффер" : "Офферы"} · ${item.offers.map((offer) => offer.title).join(", ")}` : "Без офферов");
  offerNote.title = offerNote.textContent;
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
  card.append(footer);
  return card;
}

function render() {
  const videos = allVideos();
  const previousCollection = collectionFilter.value;
  const previousStreamer = streamerFilter.value;
  const previousProduct = productFilter.value;
  const collections = [...new Set(videos.map((item) => item.collection).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
  collectionFilter.replaceChildren(new Option("Все коллекции", "all"), ...collections.map((name) => new Option(name, name)));
  collectionFilter.value = collections.includes(previousCollection) ? previousCollection : "all";
  streamerFilter.replaceChildren(new Option("Все авторы", "all"), ...(state.streamers || []).map((item) => new Option(item.name, item.id)));
  streamerFilter.value = [...streamerFilter.options].some((item) => item.value === previousStreamer) ? previousStreamer : "all";
  productFilter.replaceChildren(new Option("Все товары", "all"), ...(state.products || []).map((item) => new Option(`${item.sku} · ${item.title}`, item.id)));
  productFilter.value = [...productFilter.options].some((item) => item.value === previousProduct) ? previousProduct : "all";
  const query = search.value.trim().toLocaleLowerCase("ru");
  const tag = tagFilter.value.trim().toLocaleLowerCase("ru");
  const filtered = videos.filter((item) => {
    const searchable = `${item.id} ${item.title} ${item.text} ${item.collection || ""} ${(item.tags || []).join(" ")} ${(item.offers || []).map((offer) => offer.title).join(" ")}`.toLocaleLowerCase("ru");
    return searchable.includes(query)
      && (statusFilter.value === "all" || item.active === (statusFilter.value === "active"))
      && (sourceFilter.value === "all" || item.source === sourceFilter.value)
      && (collectionFilter.value === "all" || item.collection === collectionFilter.value)
      && (categoryFilter.value === "all" || item.category === categoryFilter.value)
      && (streamerFilter.value === "all" || item.streamerId === streamerFilter.value)
      && (productFilter.value === "all" || (item.offers || []).some((offer) => offer.productId === productFilter.value))
      && (!tag || (item.tags || []).some((value) => value.toLocaleLowerCase("ru").includes(tag)));
  });
  const sortMode = sortBy.value;
  if (sortMode === "order-reverse") filtered.reverse();
  else if (sortMode !== "order") {
    const [field, direction] = sortMode.split("-");
    const multiplier = direction === "desc" ? -1 : 1;
    filtered.sort((a, b) => String(a[field] || "").localeCompare(String(b[field] || ""), "ru") * multiplier);
  }
  grid.replaceChildren(...filtered.map(renderCard));
  document.getElementById("video-count").textContent = String(videos.length);
  document.getElementById("result-count").textContent = `Показано ${filtered.length} из ${videos.length}`;
  document.getElementById("empty-state").hidden = filtered.length > 0;
  const activeFilters = [statusFilter, sourceFilter, collectionFilter, categoryFilter, streamerFilter, productFilter].filter((control) => control.value !== "all").length
    + Number(!!tag) + Number(sortMode !== "order") + Number(!!query);
  activeFiltersCount.textContent = String(activeFilters);
  activeFiltersCount.hidden = activeFilters === 0;
  clearFiltersButton.disabled = activeFilters === 0;
  for (const control of [statusFilter, sourceFilter, collectionFilter, categoryFilter, streamerFilter, productFilter]) {
    control.closest(".filter-field").classList.toggle("is-active", control.value !== "all");
  }
  tagFilter.closest(".filter-field").classList.toggle("is-active", !!tag);
  sortBy.closest(".filter-field").classList.toggle("is-active", sortMode !== "order");
  document.querySelectorAll("#video-section select").forEach((select) => select.updateCustomSelect?.());
}

function clearFilters() {
  search.value = "";
  statusFilter.value = "all";
  sourceFilter.value = "all";
  collectionFilter.value = "all";
  categoryFilter.value = "all";
  streamerFilter.value = "all";
  productFilter.value = "all";
  tagFilter.value = "";
  sortBy.value = "order";
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

function formOffers() {
  const offers = [];
  for (const suffix of ["", "2"]) {
    const productId = form.elements[`offerProduct${suffix}`].value;
    const title = form.elements[`offerTitle${suffix}`].value.trim();
    const price = form.elements[`offerPrice${suffix}`].value.trim();
    const href = form.elements[`offerUrl${suffix}`].value.trim();
    if (!title && !price && !href) continue;
    if (!title || !href) throw new Error("Для каждого оффера укажите название и ссылку");
    let url;
    try { url = new URL(href); } catch (error) { throw new Error("Проверьте ссылку оффера"); }
    if (url.protocol !== "https:") throw new Error("Ссылка оффера должна начинаться с https://");
    offers.push({ title, price, href, ...(productId ? { productId } : {}) });
  }
  return offers;
}

function fillVideoReferences() {
  const streamer = form.elements.streamerId;
  streamer.replaceChildren(new Option("Не выбран", ""), ...(state.streamers || []).map((item) => new Option(item.name, item.id)));
  for (const suffix of ["", "2"]) {
    form.elements[`offerProduct${suffix}`].replaceChildren(new Option("Без привязки", ""), ...(state.products || []).filter((item) => item.active).map((item) => new Option(`${item.sku} · ${item.title}`, item.id)));
  }
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
  fillVideoReferences();
  document.getElementById("form-error").hidden = true;
  document.getElementById("source-tabs").hidden = !!item;
  document.getElementById("dialog-title").textContent = item ? "Редактировать видео" : "Добавить видео";
  document.getElementById("dialog-eyebrow").textContent = item ? "ПАРАМЕТРЫ ВИДЕО" : "НОВЫЙ КОНТЕНТ";
  document.getElementById("dialog-intro").textContent = item ? `ID: ${item.id} · Источник: ${item.source === "upload" ? "файл" : "Кинескоп"}` : "Добавьте ролик из Кинескопа или загрузите файл на локальный сервер.";
  document.getElementById("save-button").querySelector(".button-label").textContent = item ? "Сохранить изменения" : "Добавить в ленту";
  if (item) {
    form.querySelector(`[name="source"][value="${item.source}"]`).checked = true;
    if (item.source === "kinescope") {
      const url = `https://kinescope.io/${item.id}`;
      form.elements.kinescopeUrl.value = url;
      document.getElementById("kinescope-open").href = url;
    }
    form.elements.title.value = item.title;
    form.elements.text.value = item.text || "";
    form.elements.collection.value = item.collection || "";
    form.elements.category.value = item.category || "";
    form.elements.streamerId.value = item.streamerId || "";
    form.elements.tags.value = (item.tags || []).join(", ");
    for (let i = 0; i < Math.min(item.offers?.length || 0, 2); i++) {
      const suffix = i ? "2" : "";
      form.elements[`offerProduct${suffix}`].value = item.offers[i].productId || "";
      form.elements[`offerTitle${suffix}`].value = item.offers[i].title || "";
      form.elements[`offerPrice${suffix}`].value = item.offers[i].price || "";
      form.elements[`offerUrl${suffix}`].value = item.offers[i].href || "";
    }
    document.getElementById("second-offer").open = (item.offers?.length || 0) > 1;
  } else {
    document.getElementById("second-offer").open = false;
  }
  showSource();
  document.querySelectorAll("#video-dialog select").forEach((select) => select.updateCustomSelect?.());
  dialog.showModal();
}

form.addEventListener("change", (event) => {
  if (event.target.name === "source") showSource();
  if (event.target.name === "offerProduct") fillOfferFromProduct("");
  if (event.target.name === "offerProduct2") fillOfferFromProduct("2");
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorNode = document.getElementById("form-error");
  const save = document.getElementById("save-button");
  errorNode.hidden = true;
  save.disabled = true;
  save.querySelector(".button-label").textContent = "Сохранение…";
  try {
    const source = form.elements.source.value;
    const offers = formOffers().map((offer) => ({ ...(editing?.offers?.find((existing) => existing.href === offer.href) || {}), ...offer }));
    const video = {
      source,
      title: form.elements.title.value.trim(),
      text: form.elements.text.value.trim(),
      collection: form.elements.collection.value.trim(),
      category: form.elements.category.value,
      streamerId: form.elements.streamerId.value,
      tags: form.elements.tags.value.split(",").map((tag) => tag.trim()).filter(Boolean),
      posterUrl: editing?.posterUrl || "",
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
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: video.title, text: video.text, collection: video.collection, category: video.category, streamerId: video.streamerId, tags: video.tags, posterUrl: video.posterUrl, offers }),
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
  editing = null;
  document.getElementById("form-error").hidden = true;
});
search.addEventListener("input", render);
for (const control of [statusFilter, sourceFilter, collectionFilter, categoryFilter, streamerFilter, productFilter, sortBy]) control.addEventListener("change", render);
tagFilter.addEventListener("input", render);
clearFiltersButton.addEventListener("click", clearFilters);
document.getElementById("empty-clear").addEventListener("click", clearFilters);
document.getElementById("preview-close").addEventListener("click", () => previewDialog.close());
previewDialog.addEventListener("close", () => {
  document.getElementById("preview-body").replaceChildren();
  document.body.classList.remove("preview-open");
  document.body.style.removeProperty("--preview-scroll-offset");
  window.scrollTo(0, previewScrollY);
});
document.addEventListener("click", (event) => { document.querySelectorAll(".card-menu[open]").forEach((menu) => { if (!menu.contains(event.target)) menu.open = false; }); });
async function init() {
  try {
    state = await api("/api/state");
    apiAvailable = true;
  } catch (error) {
    document.getElementById("offline-alert").hidden = false;
    document.getElementById("add-button").disabled = true;
  }
  render();
}
init();
