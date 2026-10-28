/* Local management screens. All data comes from /api/state. */
const SECTION_INFO = {
  videos: { title: "Видео" },
  streamers: { title: "Авторы", add: "Добавить автора", icon: "user-add", description: "Авторы, которых можно назначить на ролики." },
  products: { title: "Товары", add: "Добавить товар", icon: "shopping-bag", description: "Отели, транспорт, автомобили и туры для карточек в видео." },
  reports: { title: "Отчёты", icon: "chart-histogram", description: "Показатели локальной ленты за выбранный период." },
  settings: { title: "Настройки", icon: "settings", description: "Параметры локального прототипа." },
};
const requestedSection = new URLSearchParams(location.search).get("section") || "videos";
const currentSection = SECTION_INFO[requestedSection] ? requestedSection : "videos";
window.adminSection = currentSection;
const otherRoot = document.getElementById("other-section");
let sectionState = null;
let entityEditing = null;
let listQuery = "";
let listFilter = "all";
let listSort = "default";
let reportData = null;
let selectSequence = 0;

function sectionIcon(name, size = 16) {
  const node = document.createElement("i");
  node.className = `ui-icon icon-${name}`;
  node.style.width = `${size}px`;
  node.style.height = `${size}px`;
  node.setAttribute("aria-hidden", "true");
  return node;
}

function node(tag, className = "", text = "") {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text) item.textContent = text;
  return item;
}

function actionButton(label, iconName, handler, className = "outline-button") {
  const button = node("button", className);
  button.type = "button";
  button.append(sectionIcon(iconName), document.createTextNode(label));
  button.addEventListener("click", handler);
  return button;
}

function emptyBlock(title, detail, onAdd) {
  const wrap = node("div", "section-empty");
  wrap.append(sectionIcon(SECTION_INFO[currentSection].icon, 30), node("h2", "", title), node("p", "", detail));
  if (onAdd) wrap.append(actionButton(SECTION_INFO[currentSection].add, "plus", onAdd, "primary-button"));
  return wrap;
}

function formatPrice(item) {
  const price = item.salePrice ?? item.price;
  return price === null || price === undefined ? "—" : `${new Intl.NumberFormat("ru-RU").format(price)} ${item.currency}`;
}

function localDate(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function entityTitle(item) { return item.title || item.name || item.sku || "Запись"; }

function sectionHeader(count) {
  const panel = node("div", "section-panel");
  const top = node("div", "section-panel-top");
  const title = node("h2", "", SECTION_INFO[currentSection].title);
  if (count !== "") title.append(node("span", "count", String(count)));
  top.append(title, node("div", "section-panel-actions"));
  panel.append(top);
  return panel;
}

function filterSelect(title, options, value, onChange) {
  const label = node("label", "section-filter-field");
  label.append(node("span", "", title));
  const select = node("select");
  select.setAttribute("aria-label", title);
  options.forEach(([optionValue, optionTitle]) => select.add(new Option(optionTitle, optionValue)));
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  label.append(select);
  enhanceSelect(select);
  return label;
}

function listControls(panel) {
  const actions = panel.querySelector(".section-panel-actions");
  const searchLabel = node("label", "search");
  searchLabel.append(sectionIcon("search"));
  const searchInput = node("input");
  searchInput.type = "search";
  searchInput.placeholder = currentSection === "streamers" ? "Имя, e-mail или описание" : "Название, артикул или описание";
  searchInput.setAttribute("aria-label", "Поиск в разделе");
  searchInput.value = listQuery;
  searchInput.addEventListener("input", () => {
    listQuery = searchInput.value;
    renderSection();
    const replacement = otherRoot.querySelector('.section-panel-actions input[type="search"]');
    replacement?.focus();
    replacement?.setSelectionRange(replacement.value.length, replacement.value.length);
  });
  searchLabel.append(searchInput);
  actions.append(searchLabel, actionButton(SECTION_INFO[currentSection].add, "plus", () => openEntityForm(currentSection), "primary-button"));
  const filters = node("div", "section-panel-filters entity-filters");
  if (currentSection === "products") {
    filters.append(filterSelect("Тип товара", [["all", "Все товары"], ["hotel", "Отели"], ["transport", "Транспорт"], ["car", "Автомобили"], ["tour", "Туры"], ["other", "Другое"]], listFilter, (value) => { listFilter = value; renderSection(); }));
  }
  filters.append(filterSelect("Сортировка", [["default", "По порядку"], ["name", "По названию"], ["newest", "Сначала новые"], ["oldest", "Сначала старые"]], listSort, (value) => { listSort = value; renderSection(); }));
  panel.append(filters);
  return panel;
}

function filteredEntities(items) {
  const query = listQuery.trim().toLocaleLowerCase("ru");
  const filtered = items.filter((item) => {
    const matches = Object.values(item).filter((value) => typeof value === "string").join(" ").toLocaleLowerCase("ru").includes(query);
    const status = listFilter === "all" || (currentSection === "products" && item.type === listFilter);
    return matches && status;
  });
  if (listSort === "name") filtered.sort((a, b) => entityTitle(a).localeCompare(entityTitle(b), "ru"));
  if (listSort === "newest" || listSort === "oldest") filtered.sort((a, b) => ((Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)) * (listSort === "newest" ? -1 : 1));
  return filtered;
}

function entityMenu(kind, item) {
  const menu = node("details", "card-menu");
  const summary = node("summary", "menu-trigger");
  summary.setAttribute("aria-label", `Действия: ${entityTitle(item)}`);
  summary.append(sectionIcon("menu-dots-vertical"));
  const popup = node("div", "menu-popup");
  const edit = actionButton("Редактировать", "edit", () => { menu.open = false; openEntityForm(kind, item); }, "menu-action");
  const remove = actionButton("Удалить", "trash", async () => {
    menu.open = false;
    if (!confirm(`Удалить «${entityTitle(item)}»?`)) return;
    try {
      await api(`/api/${kind}/${item.id}`, { method: "DELETE" });
      await refreshSection(); toast("Запись удалена");
    } catch (error) { toast(error.message); }
  }, "menu-action danger");
  popup.append(edit);
  if (kind === "products" || kind === "recordings") {
    popup.append(actionButton(item.active ? "Скрыть" : "Опубликовать", item.active ? "eye-crossed" : "eye", async () => {
      menu.open = false;
      try { await api(`/api/${kind}/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !item.active }) }); await refreshSection(); }
      catch (error) { toast(error.message); }
    }, "menu-action"));
  }
  popup.append(remove);
  menu.append(summary, popup);
  return menu;
}

function renderEntities() {
  const kind = currentSection;
  const items = sectionState[kind] || [];
  otherRoot.replaceChildren(listControls(sectionHeader(items.length)));
  const filtered = filteredEntities(items);
  otherRoot.append(node("p", "result-count", `Показано ${filtered.length} из ${items.length}`));
  if (!filtered.length) {
    otherRoot.append(emptyBlock(items.length ? "Ничего не найдено" : `Пока нет записей в разделе «${SECTION_INFO[kind].title}»`, items.length ? "Измените поиск или фильтр." : SECTION_INFO[kind].description, items.length ? null : () => openEntityForm(kind)));
    return;
  }
  if (kind === "products") {
    const table = node("div", "product-table");
    const header = node("div", "product-row product-head");
    ["Артикул", "Товар", "Тип", "Цена", "Статус", ""].forEach((text) => header.append(node("span", "", text)));
    table.append(header);
    filtered.forEach((item) => {
      const row = node("div", "product-row");
      row.append(node("span", "product-sku", item.sku));
      const title = node("button", "product-name", item.title);
      title.type = "button";
      title.addEventListener("click", () => openEntityForm(kind, item));
      const titleCell = node("span", "product-title-cell");
      if (item.imageUrl) { const image = node("img", "product-thumb"); image.src = item.imageUrl; image.alt = ""; titleCell.append(image); }
      titleCell.append(title);
      row.append(titleCell, node("span", "", ({ hotel: "Отель", transport: "Транспорт", car: "Автомобиль", tour: "Тур", other: "Другое" })[item.type]), node("span", "product-price", formatPrice(item)), node("span", item.active ? "tag-live" : "tag-muted", item.active ? "Активен" : "Скрыт"), entityMenu(kind, item));
      table.append(row);
    });
    otherRoot.append(table);
  } else {
    const list = node("div", kind === "streamers" ? "streamer-grid" : "entity-list");
    filtered.forEach((item) => {
      const card = node("article", "entity-card");
      const top = node("div", "entity-card-top");
      const identity = node("div", "entity-identity");
      if (kind === "streamers") {
        const avatar = item.avatarUrl ? node("img", "entity-avatar") : node("span", "entity-avatar avatar-fallback", item.name.slice(0, 1).toUpperCase());
        if (item.avatarUrl) { avatar.src = item.avatarUrl; avatar.alt = ""; }
        identity.append(avatar);
      } else identity.append(sectionIcon(SECTION_INFO[kind].icon, 22));
      const text = node("div");
      text.append(node("h3", "", entityTitle(item)));
      text.append(node("p", "entity-subtitle", kind === "streamers" ? item.email : item.description || "Без описания"));
      identity.append(text);
      top.append(identity, entityMenu(kind, item));
      card.append(top);
      if (kind === "streamers") {
        card.append(node("p", "entity-description", item.description || "Описание пока не добавлено"));
        card.append(node("p", "entity-detail", item.phone || item.profileUrl || "Контакт: e-mail"));
      } else {
        card.append(node("span", item.active ? "tag-live" : "tag-muted", item.active ? "Опубликована" : "Скрыта"));
        const link = node("a", "entity-link", "Смотреть запись ↗"); link.href = item.videoUrl; link.target = "_blank"; link.rel = "noopener"; card.append(link);
      }
      list.append(card);
    });
    otherRoot.append(list);
  }
}

const FORM_FIELDS = {
  streamers: [
    ["name", "Имя автора", "text", true], ["email", "E-mail", "email", true], ["phone", "Телефон", "tel"], ["description", "Описание", "textarea"],
    ["avatarUrl", "Ссылка на аватар", "text"], ["imageFile", "Или загрузить аватар", "image"], ["externalId", "Внешний ID", "text"], ["profileUrl", "Ссылка на профиль", "url"],
  ],
  products: [
    ["sku", "Артикул", "text", true], ["title", "Название", "text", true], ["type", "Тип", "select", true, [["hotel", "Отель"], ["transport", "Транспорт"], ["car", "Автомобиль"], ["tour", "Тур"], ["other", "Другое"]]],
    ["currency", "Валюта", "select", true, [["RUB", "RUB · ₽"], ["USD", "USD · $"], ["EUR", "EUR · €"]]], ["price", "Цена", "number", true], ["salePrice", "Цена со скидкой", "number"],
    ["url", "Ссылка на страницу товара", "url", true], ["imageUrl", "Ссылка на изображение", "text"], ["imageFile", "Или загрузить изображение", "image"],
    ["description", "Описание", "textarea"], ["brand", "О бренде", "textarea"], ["usage", "Применение", "textarea"], ["active", "Активен", "checkbox"],
  ],
  recordings: [
    ["title", "Название записи", "text", true], ["description", "Описание", "textarea"], ["videoUrl", "Ссылка на видео", "text"], ["videoFile", "Или загрузить видео", "video"],
    ["active", "Опубликована", "checkbox"],
  ],
};

const entityDialog = node("dialog", "entity-dialog");
entityDialog.id = "entity-dialog";
entityDialog.innerHTML = '<form id="entity-form"><div class="dialog-head"><div><h2 id="entity-dialog-title"></h2></div><button class="icon-close" type="button" id="entity-close" aria-label="Закрыть"><i class="ui-icon icon-cross" aria-hidden="true"></i></button></div><p class="dialog-intro" id="entity-intro"></p><div id="entity-fields"></div><p class="form-error" id="entity-error" role="alert" hidden></p><div class="dialog-actions"><button type="button" class="text-button" id="entity-cancel">Отмена</button><button type="submit" class="primary-button" id="entity-save"><i class="ui-icon icon-check" aria-hidden="true"></i>Сохранить</button></div></form>';
document.body.append(entityDialog);
const entityForm = document.getElementById("entity-form");
document.getElementById("entity-close").addEventListener("click", () => entityDialog.close());
document.getElementById("entity-cancel").addEventListener("click", () => entityDialog.close());
entityDialog.addEventListener("close", () => window.syncModalScroll());

function openEntityForm(kind, item = null) {
  entityEditing = item;
  entityForm.dataset.kind = kind;
  entityForm.reset();
  document.getElementById("entity-error").hidden = true;
  document.getElementById("entity-dialog-title").textContent = item ? `Редактировать: ${entityTitle(item)}` : SECTION_INFO[kind].add;
  document.getElementById("entity-intro").textContent = item ? "Изменения сохраняются в локальном хранилище проекта." : SECTION_INFO[kind].description;
  const container = document.getElementById("entity-fields");
  container.replaceChildren();
  for (const [key, title, type, required, choices] of FORM_FIELDS[kind]) {
    const field = node("div", type === "checkbox" ? "form-check" : "field");
    const label = node("label", "", title + (required ? " *" : ""));
    label.htmlFor = `entity-${key}`;
    let control;
    if (type === "textarea") { control = node("textarea"); control.rows = 3; }
    else if (["select", "streamers"].includes(type)) {
      control = node("select");
      const options = choices || [["", "Не выбран"]].concat((sectionState[type] || []).map((entity) => [entity.id, entity.name || entity.title]));
      options.forEach(([value, labelText]) => control.add(new Option(labelText, value)));
    } else {
      control = node("input");
      control.type = type === "image" || type === "video" ? "file" : type;
      if (type === "image") control.accept = "image/png,image/jpeg,image/webp";
      if (type === "video") control.accept = "video/mp4,video/webm";
      if (type === "number") { control.min = "0"; control.step = "0.01"; }
    }
    control.name = key;
    control.id = `entity-${key}`;
    control.required = !!required;
    if (type === "checkbox") { field.append(control, label); control.checked = item ? !!item[key] : true; }
    else { field.append(label, control); if (item && type !== "image" && type !== "video") control.value = item[key] ?? ""; }
    container.append(field);
    if (control.tagName === "SELECT") enhanceSelect(control);
  }
  entityDialog.showModal();
  window.syncModalScroll();
}

entityForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const kind = entityForm.dataset.kind;
  const error = document.getElementById("entity-error");
  const save = document.getElementById("entity-save");
  error.hidden = true;
  save.disabled = true;
  try {
    const data = {};
    for (const [key, , type] of FORM_FIELDS[kind]) {
      const control = entityForm.elements[key];
      if (type === "image" || type === "video") continue;
      data[key] = type === "checkbox" ? control.checked : control.value.trim();
    }
    const image = entityForm.elements.imageFile?.files[0];
    const video = entityForm.elements.videoFile?.files[0];
    if (image) {
      const result = await api(`/api/image-upload?filename=${encodeURIComponent(image.name)}`, { method: "POST", headers: { "Content-Type": image.type || "application/octet-stream" }, body: image });
      data[kind === "streamers" ? "avatarUrl" : "imageUrl"] = result.mediaUrl;
    }
    if (video) {
      const result = await api(`/api/upload?filename=${encodeURIComponent(video.name)}`, { method: "POST", headers: { "Content-Type": video.type || "application/octet-stream" }, body: video });
      data.videoUrl = result.mediaUrl;
    }
    await api(`/api/${kind}${entityEditing ? `/${entityEditing.id}` : ""}`, { method: entityEditing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    entityDialog.close();
    await refreshSection();
    toast(entityEditing ? "Изменения сохранены" : "Запись добавлена");
  } catch (problem) { error.textContent = problem.message; error.hidden = false; }
  finally { save.disabled = false; }
});

async function loadReport(from, to) {
  try { reportData = await api(`/api/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); renderReport(); }
  catch (error) { toast(error.message); }
}

function renderReport() {
  otherRoot.replaceChildren();
  const toolbar = sectionHeader("");
  otherRoot.append(toolbar);
  const panel = node("div", "report-panel");
  const controls = node("div", "report-controls");
  controls.innerHTML = '<label>С даты<input id="report-from" type="date"></label><label>По дату<input id="report-to" type="date"></label>';
  const first = new Date(); first.setDate(1);
  const start = reportData?.from || localDate(first);
  const end = reportData?.to || localDate(new Date());
  controls.querySelector("#report-from").value = start;
  controls.querySelector("#report-to").value = end;
  controls.append(actionButton("Показать", "filter", () => loadReport(controls.querySelector("#report-from").value, controls.querySelector("#report-to").value), "primary-button"));
  controls.append(actionButton("Скачать CSV", "download", () => {
    if (!reportData) return;
    const rows = [["Видео", "Просмотры", "Лайки", "Клики по офферам"]];
    for (const [id, values] of Object.entries(reportData.byVideo)) {
      const video = [...DEFAULT_FEED, ...sectionState.videos].find((item) => item.id === id);
      rows.push([video?.title || id, values.view, values.like, values.offer_click]);
    }
    const csv = "\uFEFF" + rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `tututiktok-report-${reportData.from}-${reportData.to}.csv`;
    link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, "outline-button"));
  toolbar.append(controls);
  const note = node("p", "report-note", "Локальные события этой ленты. Данные Streamerce и заказы сюда не передаются.");
  note.prepend(sectionIcon("info"));
  panel.append(note);
  if (reportData) {
    const stats = node("div", "report-stats");
    [["Всего видео", reportData.totalVideos], ["Опубликовано", reportData.publishedVideos], ["Просмотры", reportData.views], ["Лайки", reportData.likes], ["Клики по офферам", reportData.offerClicks], ["Минуты просмотра", Math.round(reportData.watchSeconds / 60)]].forEach(([label, value]) => {
      const card = node("div", "stat-card"); card.append(node("span", "", label), node("strong", "", String(value))); stats.append(card);
    });
    panel.append(stats);
    const breakdown = node("div", "report-breakdown");
    breakdown.append(node("h3", "", "По видео"));
    const entries = Object.entries(reportData.byVideo).sort((a, b) => b[1].view - a[1].view);
    if (!entries.length) breakdown.append(node("p", "entity-subtitle", "За выбранный период событий пока нет."));
    entries.forEach(([id, values]) => {
      const video = [...DEFAULT_FEED, ...sectionState.videos].find((item) => item.id === id);
      const row = node("div", "report-row");
      row.append(node("strong", "", video?.title || id), node("span", "", `${values.view} просмотров`), node("span", "", `${values.like} лайков`), node("span", "", `${values.offer_click} кликов`));
      breakdown.append(row);
    });
    panel.append(breakdown);
  }
  otherRoot.append(panel);
}

function renderSettings() {
  otherRoot.replaceChildren(sectionHeader(""));
  const panel = node("div", "settings-panel");
  const head = node("div"); head.append(node("h2", "", "Доступность ленты"), node("p", "section-description", "Включение влияет на локальную ленту для просмотра."));
  const switchLabel = node("label", "feed-switch");
  const input = node("input"); input.type = "checkbox"; input.checked = !!sectionState.enabled;
  const track = node("span", "switch-track"); track.setAttribute("aria-hidden", "true");
  switchLabel.append(node("strong", "", input.checked ? "Включена" : "Выключена"), input, track);
  input.addEventListener("change", async () => {
    input.disabled = true;
    try { await api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: input.checked }) }); await refreshSection(); toast("Настройка сохранена"); }
    catch (error) { toast(error.message); input.checked = !input.checked; input.disabled = false; }
  });
  const row = node("div", "settings-row"); row.append(head, switchLabel); panel.append(row);
  const local = node("div", "settings-row");
  const text = node("div"); text.append(node("h2", "", "Локальное хранилище"), node("p", "section-description", "Данные админки хранятся в .local-data/ на этом компьютере. Публичная версия на GitHub Pages их не получает."));
  local.append(text); panel.append(local);
  otherRoot.append(panel);
}

function renderSection() {
  if (!sectionState || window.adminSection === "videos") return;
  if (currentSection === "reports") renderReport();
  else if (currentSection === "settings") renderSettings();
  else renderEntities();
}

async function refreshSection() {
  sectionState = await api("/api/state");
  renderSection();
}

function enhanceSelect(select) {
  if (select.dataset.enhanced) return;
  select.dataset.enhanced = "true";
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  const shell = node("div", "custom-select");
  select.parentNode.insertBefore(shell, select);
  shell.append(select);
  const button = node("button", "select-button"); button.type = "button"; button.setAttribute("aria-haspopup", "listbox"); button.setAttribute("aria-expanded", "false");
  button.id = `custom-select-${++selectSequence}`;
  const externalLabel = select.id ? document.querySelector(`label[for="${select.id}"]`) : null;
  const label = externalLabel || shell.closest("label");
  if (label) label.htmlFor = button.id;
  button.setAttribute("aria-label", select.getAttribute("aria-label") || label?.childNodes[0]?.textContent?.trim() || "Выбрать значение");
  button.append(node("span", "select-value"), sectionIcon("angle-down"));
  const list = node("div", "select-options"); list.setAttribute("role", "listbox"); list.hidden = true;
  shell.append(button, list);
  const sync = () => {
    button.querySelector(".select-value").textContent = select.selectedOptions[0]?.textContent || "Выбрать";
    list.replaceChildren();
    [...select.options].forEach((option) => {
      const choice = node("button", "select-option", option.textContent); choice.type = "button"; choice.setAttribute("role", "option"); choice.setAttribute("aria-selected", String(select.value === option.value));
      choice.addEventListener("click", () => { select.value = option.value; select.dispatchEvent(new Event("change", { bubbles: true })); close(); button.focus(); });
      list.append(choice);
    });
  };
  const close = () => { list.hidden = true; button.setAttribute("aria-expanded", "false"); shell.classList.remove("is-open"); };
  button.addEventListener("click", () => {
    document.querySelectorAll(".custom-select.is-open").forEach((other) => { if (other !== shell) { other.querySelector(".select-options").hidden = true; other.querySelector(".select-button").setAttribute("aria-expanded", "false"); other.classList.remove("is-open"); } });
    list.hidden = !list.hidden; button.setAttribute("aria-expanded", String(!list.hidden)); shell.classList.toggle("is-open", !list.hidden);
  });
  shell.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { close(); button.focus(); }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && document.activeElement === button) { event.preventDefault(); list.hidden = false; shell.classList.add("is-open"); button.setAttribute("aria-expanded", "true"); (event.key === "ArrowDown" ? list.firstElementChild : list.lastElementChild)?.focus(); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const options = [...list.children]; const index = options.indexOf(document.activeElement); options[Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus(); }
  });
  select.addEventListener("change", sync);
  select.updateCustomSelect = sync;
  new MutationObserver(sync).observe(select, { childList: true, subtree: true });
  sync();
}

document.addEventListener("click", (event) => { document.querySelectorAll(".custom-select.is-open").forEach((shell) => { if (!shell.contains(event.target)) { shell.querySelector(".select-options").hidden = true; shell.querySelector(".select-button").setAttribute("aria-expanded", "false"); shell.classList.remove("is-open"); } }); });

async function startSections() {
  const active = window.adminSection;
  document.querySelectorAll(".sidebar [data-section]").forEach((link) => {
    const selected = link.dataset.section === active;
    link.classList.toggle("selected", selected);
    if (selected) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.querySelectorAll("#video-section select").forEach(enhanceSelect);
  document.querySelectorAll("#video-dialog select").forEach(enhanceSelect);
  if (active === "videos") return;
  document.getElementById("video-section").hidden = true;
  otherRoot.hidden = false;
  try {
    await refreshSection();
    if (active === "reports") {
      const today = localDate(new Date());
      await loadReport(today.slice(0, 8) + "01", today);
    }
  } catch (error) { otherRoot.replaceChildren(emptyBlock("Сервер недоступен", "Запустите python3 dev_server.py в папке проекта.")); }
}
startSections();
