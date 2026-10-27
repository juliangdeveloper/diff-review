import {
  APP_ID, APP_VERSION, AUTO_OPEN_MAX_FILES, COMMIT, DECISION, DECISION_STATUS, FILTER_ALL, HEADERS,
  LABEL, LARGE_FILE_LINES, MESSAGE_PREVIEW_CHARS, REVIEW, ROUTE, SCOPES, STATUS, STORAGE, TAB, URLS,
} from "./config.js";
import { AppError, ERROR, clearStoredToken, pickSheet, readStoredToken, revoke, signIn } from "./google.js";
import { appendReview, loadDiffs, loadSheet, updateStatus } from "./sheets.js";
import { parsePatch, renderLines } from "./diff.js";
import {
  branchSummary, commitKey, commitStats, commitStatus, filesFor, firstLine, newId, parseSheetInput,
  restLines, reviewsFor, SHORT_SHA_LENGTH, shortSha, sortCommits, sortReviews, uniqueValues,
} from "./model.js";

const TOAST_MS = 2600;
const LOCALE = "es-CO";
const ROUTE_SEPARATOR = "/";
const HASH_PREFIX = "#/";
const ROUTE_ROOTS = new Set([ROUTE.COMMITS, ROUTE.BRANCHES, ROUTE.HISTORY, ROUTE.SETTINGS]);
const TAB_ROUTE = Object.freeze({
  [ROUTE.COMMITS]: ROUTE.COMMITS,
  [ROUTE.BRANCH]: ROUTE.BRANCHES,
  [ROUTE.BRANCHES]: ROUTE.BRANCHES,
  [ROUTE.COMMIT]: ROUTE.COMMITS,
  [ROUTE.HISTORY]: ROUTE.HISTORY,
  [ROUTE.SETTINGS]: ROUTE.SETTINGS,
});
const TITLES = Object.freeze({
  [ROUTE.COMMITS]: "Commits",
  [ROUTE.BRANCHES]: "Ramas",
  [ROUTE.HISTORY]: "Historial",
  [ROUTE.SETTINGS]: "Ajustes",
});
const STATUS_FILTERS = Object.freeze([FILTER_ALL, STATUS.PENDING, STATUS.APPROVED, STATUS.REJECTED]);
const STATUS_FILTER_LABEL = Object.freeze({
  [FILTER_ALL]: "Todos",
  [STATUS.PENDING]: "Pendientes",
  [STATUS.APPROVED]: "Aprobados",
  [STATUS.REJECTED]: "Rechazados",
});
const ERROR_TEXT = Object.freeze({
  [ERROR.NO_CLIENT]: "Falta el Client ID de OAuth. Agrégalo en Ajustes.",
  [ERROR.NO_SHEET]: "Falta elegir la hoja. Hazlo en Ajustes.",
  [ERROR.AUTH]: "La sesión de Google expiró o se canceló. Vuelve a conectar.",
  [ERROR.ACCESS]: "Sin acceso a la hoja. Elígela con el selector de Drive en Ajustes para dar permiso a esta app.",
  [ERROR.SCRIPT]: "No se pudieron cargar los servicios de Google. Revisa la conexión.",
  [ERROR.PICKER]: "No se pudo abrir el selector de Drive.",
  [ERROR.TABS]: "A la hoja le faltan pestañas: ",
  [ERROR.HEADERS]: "Faltan columnas en la hoja: ",
  [ERROR.SCHEMA]: "La hoja no es compatible. En meta se espera schema_version = 1 y se encontró: ",
  [ERROR.HTTP]: "Error al hablar con Google Sheets: ",
  [ERROR.NOT_FOUND]: "No se encontró el commit en la hoja: ",
});
const CSV_FILES = Object.freeze(Object.values(TAB).map((tab) => ({ tab, href: `plantilla/${tab}.csv` })));

const state = {
  auth: readStoredToken(),
  data: null,
  diffs: null,
  diffsPromise: null,
  loading: false,
  error: null,
  filter: { repo: FILTER_ALL, branch: FILTER_ALL, status: FILTER_ALL, query: "" },
  history: { branch: FILTER_ALL, query: "" },
};

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key === "html") el.innerHTML = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key in el && typeof value !== "string") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function setting(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch (e) {
    return "";
  }
}

function saveSetting(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch (e) {
    return;
  }
}

function errorText(err) {
  const code = err?.code || ERROR.HTTP;
  const base = ERROR_TEXT[code] || ERROR_TEXT[ERROR.HTTP];
  const detail = err?.detail || (code === ERROR.SCHEMA ? "nada" : "");
  return base.endsWith(": ") ? base + detail : base;
}

let toastTimer = 0;
function toast(text) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, TOAST_MS);
}

function formatDate(value) {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return value || "";
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" }).format(new Date(t));
}

function parseRoute() {
  const raw = location.hash.startsWith(HASH_PREFIX) ? location.hash.slice(HASH_PREFIX.length) : "";
  const parts = raw.split(ROUTE_SEPARATOR).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch (e) {
      return part;
    }
  });
  const name = parts[0] || ROUTE.COMMITS;
  return { name: TAB_ROUTE[name] ? name : ROUTE.COMMITS, params: parts.slice(1) };
}

function hashFor(name, ...params) {
  return HASH_PREFIX + [name, ...params].map((part) => encodeURIComponent(part)).join(ROUTE_SEPARATOR);
}

function commitHash(commit) {
  return hashFor(ROUTE.COMMIT, commit[COMMIT.SHA], commit[COMMIT.BRANCH]);
}

function configured() {
  return Boolean(setting(STORAGE.CLIENT_ID) && setting(STORAGE.SHEET_ID));
}

function token() {
  const saved = readStoredToken();
  if (!saved) {
    state.auth = null;
    throw new AppError(ERROR.AUTH);
  }
  return saved.token;
}

function handleError(err) {
  if (err?.code === ERROR.AUTH) {
    clearStoredToken();
    state.auth = null;
  }
  state.error = err instanceof AppError ? err : new AppError(ERROR.HTTP, String(err?.message || ""));
}

async function connect() {
  try {
    state.auth = await signIn(setting(STORAGE.CLIENT_ID));
    state.error = null;
    await refresh();
  } catch (err) {
    handleError(err);
    toast(errorText(state.error));
    render();
  }
}

async function refresh() {
  if (!configured() || !state.auth) {
    render();
    return;
  }
  state.loading = true;
  state.error = null;
  render();
  try {
    state.data = await loadSheet(token(), setting(STORAGE.SHEET_ID));
    state.diffs = null;
    state.diffsPromise = null;
  } catch (err) {
    state.data = null;
    handleError(err);
  } finally {
    state.loading = false;
    render();
  }
}

function ensureDiffs() {
  if (state.diffs) return Promise.resolve(state.diffs);
  if (!state.diffsPromise) {
    state.diffsPromise = loadDiffs(token(), setting(STORAGE.SHEET_ID))
      .then((table) => {
        state.diffs = table;
        return table;
      })
      .catch((err) => {
        state.diffsPromise = null;
        throw err;
      });
  }
  return state.diffsPromise;
}

function badge(status, text) {
  return h("span", { class: `badge badge-${status}`, text: text || LABEL.status[status] || status });
}

function icon(name) {
  const tpl = document.getElementById(`icon-${name}`);
  return tpl ? tpl.content.cloneNode(true) : document.createTextNode("");
}

function emptyCard(title, text, ...actions) {
  return h("div", { class: "card empty" }, h("h2", { text: title }), text ? h("p", { text }) : null, ...actions);
}

function gate() {
  if (!configured()) {
    return emptyCard(
      "Conecta tu hoja",
      "Agrega el Client ID de OAuth y elige la hoja de Google Sheets en Ajustes.",
      h("a", { class: "btn primary", href: hashFor(ROUTE.SETTINGS), text: "Ir a Ajustes" }),
    );
  }
  if (!state.auth) {
    return emptyCard(
      "Inicia sesión",
      state.error ? errorText(state.error) : "Conecta tu cuenta de Google para leer la hoja.",
      h("button", { class: "btn primary", type: "button", onclick: connect, text: "Conectar con Google" }),
    );
  }
  if (state.loading && !state.data) return h("p", { class: "loading", text: "Cargando…" });
  if (state.error && !state.data) {
    return emptyCard(
      "No se pudo leer la hoja",
      errorText(state.error),
      h("button", { class: "btn primary", type: "button", onclick: refresh, text: "Reintentar" }),
      h("a", { class: "btn", href: hashFor(ROUTE.SETTINGS), text: "Ajustes" }),
    );
  }
  if (!state.data) return h("p", { class: "loading", text: "Cargando…" });
  return null;
}

function commits() {
  return state.data ? sortCommits(state.data.commits.rows) : [];
}

function reviews() {
  return state.data ? state.data.reviews.rows : [];
}

function select(label, value, options, onchange) {
  return h("label", { class: "select" },
    h("span", { class: "select-label", text: label }),
    h("select", { onchange: (e) => onchange(e.target.value) },
      options.map((opt) => h("option", { value: opt.value, selected: opt.value === value, text: opt.label }))));
}

function segmented(value, counts, onchange) {
  return h("div", { class: "segmented", role: "tablist" },
    STATUS_FILTERS.map((status) => h("button", {
      type: "button",
      role: "tab",
      class: status === value ? "seg active" : "seg",
      "aria-selected": String(status === value),
      onclick: () => onchange(status),
    }, STATUS_FILTER_LABEL[status], h("span", { class: "seg-count", text: String(counts[status]) }))));
}

function commitCell(commit) {
  const status = commitStatus(commit, reviews());
  const stats = commitStats(commit);
  const title = firstLine(commit[COMMIT.MESSAGE]) || shortSha(commit);
  return h("li", {},
    h("a", { class: "cell", href: commitHash(commit) },
      h("div", { class: "cell-main" },
        h("p", { class: "cell-title", text: title.slice(0, MESSAGE_PREVIEW_CHARS) }),
        h("p", { class: "cell-sub" },
          h("span", { class: "mono", text: shortSha(commit) }),
          h("span", { class: "chip", text: commit[COMMIT.BRANCH] }),
          h("span", { text: commit[COMMIT.AUTHOR] })),
        h("p", { class: "cell-sub" },
          h("span", { text: formatDate(commit[COMMIT.DATE] || commit[COMMIT.UPLOADED]) }),
          h("span", { class: "add", text: `+${stats.additions}` }),
          h("span", { class: "del", text: `−${stats.deletions}` }))),
      badge(status)));
}

function commitList(list, emptyText) {
  if (!list.length) return emptyCard("Sin commits", emptyText);
  return h("ul", { class: "list" }, list.map(commitCell));
}

function statusCounts(list) {
  const counts = { [FILTER_ALL]: list.length, [STATUS.PENDING]: 0, [STATUS.APPROVED]: 0, [STATUS.REJECTED]: 0 };
  for (const commit of list) counts[commitStatus(commit, reviews())] += 1;
  return counts;
}

function matchesQuery(commit, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return [COMMIT.SHA, COMMIT.MESSAGE, COMMIT.AUTHOR, COMMIT.BRANCH].some((field) => commit[field].toLowerCase().includes(q));
}

function filteredCommits(base, filter) {
  return base.filter((commit) => matchesQuery(commit, filter.query));
}

function viewCommits() {
  const blocked = gate();
  if (blocked) return [blocked];
  const all = commits();
  const f = state.filter;
  const repos = uniqueValues(all, COMMIT.REPO);
  const inRepo = all.filter((commit) => !f.repo || commit[COMMIT.REPO] === f.repo);
  const branches = uniqueValues(inRepo, COMMIT.BRANCH);
  if (f.branch && !branches.includes(f.branch)) f.branch = FILTER_ALL;
  const scoped = filteredCommits(inRepo.filter((commit) => !f.branch || commit[COMMIT.BRANCH] === f.branch), f);
  const list = scoped.filter((commit) => !f.status || commitStatus(commit, reviews()) === f.status);
  const controls = h("div", { class: "filters" },
    h("div", { class: "filter-row" },
      repos.length > 1 ? select("Repo", f.repo, [{ value: FILTER_ALL, label: "Todos" }, ...repos.map((r) => ({ value: r, label: r }))], (v) => { f.repo = v; render(); }) : null,
      select("Rama", f.branch, [{ value: FILTER_ALL, label: "Todas" }, ...branches.map((b) => ({ value: b, label: b }))], (v) => { f.branch = v; render(); })),
    h("input", {
      class: "search", type: "search", placeholder: "Buscar mensaje, SHA o autor", value: f.query,
      oninput: (e) => { f.query = e.target.value; renderList(); },
    }),
    segmented(f.status, statusCounts(scoped), (v) => { f.status = v; render(); }));
  const holder = h("div", { id: "list-holder" }, commitList(list, "No hay commits con estos filtros."));
  return [controls, holder];
}

function renderList() {
  const holder = document.getElementById("list-holder");
  if (!holder) return;
  const f = state.filter;
  const list = commits().filter((commit) => (!f.repo || commit[COMMIT.REPO] === f.repo)
    && (!f.branch || commit[COMMIT.BRANCH] === f.branch)
    && (!f.status || commitStatus(commit, reviews()) === f.status)
    && matchesQuery(commit, f.query));
  holder.replaceChildren(commitList(list, "No hay commits con estos filtros."));
}

function viewBranches() {
  const blocked = gate();
  if (blocked) return [blocked];
  const summary = branchSummary(commits(), reviews());
  if (!summary.length) return [emptyCard("Sin ramas", "La hoja todavía no tiene commits.")];
  const repos = uniqueValues(summary, "repo");
  const groups = repos.length ? repos : [""];
  return groups.map((repo) => h("section", { class: "group" },
    repo ? h("h2", { class: "group-title", text: repo }) : null,
    h("ul", { class: "list" }, summary.filter((item) => item.repo === repo).map((item) => h("li", {},
      h("a", { class: "cell", href: hashFor(ROUTE.BRANCH, item.repo, item.branch) },
        h("div", { class: "cell-main" },
          h("p", { class: "cell-title mono", text: item.branch || "—" }),
          h("p", { class: "cell-sub" },
            h("span", { text: `${item.total} commits` }),
            item.latest ? h("span", { text: formatDate(new Date(item.latest).toISOString()) }) : null)),
        h("div", { class: "counts" },
          item.counts[STATUS.PENDING] ? badge(STATUS.PENDING, String(item.counts[STATUS.PENDING])) : null,
          item.counts[STATUS.APPROVED] ? badge(STATUS.APPROVED, String(item.counts[STATUS.APPROVED])) : null,
          item.counts[STATUS.REJECTED] ? badge(STATUS.REJECTED, String(item.counts[STATUS.REJECTED])) : null)))))));
}

function viewBranch(repo, branch) {
  const blocked = gate();
  if (blocked) return [blocked];
  const list = commits().filter((commit) => commit[COMMIT.REPO] === repo && commit[COMMIT.BRANCH] === branch);
  const counts = statusCounts(list);
  return [
    h("div", { class: "branch-head" },
      repo ? h("p", { class: "eyebrow", text: repo }) : null,
      h("h2", { class: "branch-name mono", text: branch || "—" }),
      h("p", { class: "cell-sub" },
        h("span", { text: `${counts[FILTER_ALL]} commits` }),
        h("span", { text: `${counts[STATUS.PENDING]} pendientes` }),
        h("span", { text: `${counts[STATUS.APPROVED]} aprobados` }),
        h("span", { text: `${counts[STATUS.REJECTED]} rechazados` }))),
    commitList(list, "Esta rama no tiene commits."),
  ];
}

function reviewItem(review, showCommit) {
  const decision = review[REVIEW.DECISION];
  const commit = showCommit ? commits().find((c) => c[COMMIT.SHA] === review[REVIEW.SHA]
    && (!review[REVIEW.BRANCH] || c[COMMIT.BRANCH] === review[REVIEW.BRANCH])) : null;
  const body = [
    h("div", { class: "review-top" },
      badge(DECISION_STATUS[decision] || decision, LABEL.decision[decision] || decision),
      h("span", { class: "muted", text: formatDate(review[REVIEW.AT]) })),
    review[REVIEW.COMMENT] ? h("p", { class: "review-comment", text: review[REVIEW.COMMENT] }) : null,
    h("p", { class: "cell-sub" },
      showCommit ? h("span", { class: "mono", text: review[REVIEW.SHA].slice(0, SHORT_SHA_LENGTH) }) : null,
      showCommit && review[REVIEW.BRANCH] ? h("span", { class: "chip", text: review[REVIEW.BRANCH] }) : null,
      review[REVIEW.REVIEWER] ? h("span", { text: review[REVIEW.REVIEWER] }) : null),
    commit ? h("p", { class: "review-msg", text: firstLine(commit[COMMIT.MESSAGE]) }) : null,
  ];
  if (commit) return h("li", {}, h("a", { class: "review", href: commitHash(commit) }, body));
  return h("li", {}, h("div", { class: "review" }, body));
}

function viewHistory() {
  const blocked = gate();
  if (blocked) return [blocked];
  const all = sortReviews(reviews());
  const f = state.history;
  const branches = uniqueValues(all, REVIEW.BRANCH);
  const draw = () => {
    const q = f.query.trim().toLowerCase();
    const list = all.filter((review) => (!f.branch || review[REVIEW.BRANCH] === f.branch)
      && (!q || review[REVIEW.SHA].toLowerCase().startsWith(q) || review[REVIEW.COMMENT].toLowerCase().includes(q)));
    return list.length
      ? h("ul", { class: "list reviews" }, list.map((review) => reviewItem(review, true)))
      : emptyCard("Sin revisiones", all.length ? "No hay revisiones con estos filtros." : "Todavía no hay revisiones.");
  };
  const holder = h("div", {}, draw());
  return [
    h("div", { class: "filters" },
      h("div", { class: "filter-row" },
        select("Rama", f.branch, [{ value: FILTER_ALL, label: "Todas" }, ...branches.map((b) => ({ value: b, label: b }))], (v) => { f.branch = v; render(); })),
      h("input", {
        class: "search", type: "search", placeholder: "Filtrar por SHA o comentario", value: f.query,
        oninput: (e) => { f.query = e.target.value; holder.replaceChildren(draw()); },
      })),
    holder,
  ];
}

function metaRow(label, value, extra) {
  if (!value && !extra) return null;
  return h("div", { class: "meta-row" }, h("dt", { text: label }), h("dd", {}, extra || value));
}

async function submitReview(commit, decision, form) {
  const textarea = form.querySelector("textarea");
  const comment = textarea.value.trim();
  if (decision === DECISION.COMMENT && !comment) {
    toast("Escribe un comentario.");
    textarea.focus();
    return;
  }
  const buttons = [...form.querySelectorAll("button")];
  buttons.forEach((b) => { b.disabled = true; });
  const review = {
    [REVIEW.ID]: newId(),
    [REVIEW.SHA]: commit[COMMIT.SHA],
    [REVIEW.BRANCH]: commit[COMMIT.BRANCH],
    [REVIEW.DECISION]: decision,
    [REVIEW.COMMENT]: comment,
    [REVIEW.REVIEWER]: state.auth?.email || "",
    [REVIEW.AT]: new Date().toISOString(),
  };
  try {
    const sheetId = setting(STORAGE.SHEET_ID);
    await appendReview(token(), sheetId, state.data.reviews, review);
    state.data.reviews.rows.push({ ...review, _row: Number.MAX_SAFE_INTEGER });
    const status = DECISION_STATUS[decision];
    if (status) {
      await updateStatus(token(), sheetId, state.data.commits, commit[COMMIT.SHA], commit[COMMIT.BRANCH], status);
      state.data.commits.rows
        .filter((c) => c[COMMIT.SHA] === commit[COMMIT.SHA] && c[COMMIT.BRANCH] === commit[COMMIT.BRANCH])
        .forEach((c) => { c[COMMIT.STATUS] = status; });
    }
    toast(status ? `${LABEL.status[status]} y guardado en la hoja.` : "Comentario guardado en la hoja.");
    textarea.value = "";
    render();
  } catch (err) {
    handleError(err);
    toast(errorText(state.error));
    state.error = state.data ? null : state.error;
    buttons.forEach((b) => { b.disabled = false; });
    if (!state.auth) render();
  }
}

function fileNode(file, autoOpen) {
  const parsed = parsePatch(file.patch);
  const large = parsed.lines.length > LARGE_FILE_LINES;
  const incomplete = file.received < file.total;
  const renamed = file.oldPath && file.oldPath !== file.path;
  const details = h("details", { class: "file" });
  const tags = [];
  if (parsed.binary) tags.push("binario");
  if (large) tags.push(`${parsed.lines.length} líneas`);
  if (incomplete) tags.push(`${file.received}/${file.total} partes`);
  details.append(h("summary", {},
    h("span", { class: `change change-${file.change}`, title: LABEL.change[file.change] || file.change, text: file.change }),
    h("span", { class: "file-path" },
      renamed ? h("span", { class: "old-path", text: `${file.oldPath} → ` }) : null,
      h("span", { text: file.path })),
    h("span", { class: "file-stats" },
      tags.map((tag) => h("span", { class: "tag", text: tag })),
      parsed.additions ? h("span", { class: "add", text: `+${parsed.additions}` }) : null,
      parsed.deletions ? h("span", { class: "del", text: `−${parsed.deletions}` }) : null),
    icon("chevron")));
  const body = h("div", { class: "file-body" });
  details.append(body);
  let filled = false;
  const fill = () => {
    if (filled) return;
    filled = true;
    if (incomplete) body.append(h("p", { class: "warn", text: `Faltan partes del diff: llegaron ${file.received} de ${file.total}.` }));
    if (parsed.binary) body.append(h("p", { class: "note", text: "Archivo binario: no hay diff de texto." }));
    else if (!parsed.lines.length) body.append(h("p", { class: "note", text: renamed ? "Solo se renombró, sin cambios de contenido." : "Sin cambios de texto." }));
    else body.append(h("div", { class: "diff-scroll" }, renderLines(parsed)));
  };
  details.addEventListener("toggle", () => { if (details.open) fill(); });
  if (autoOpen && !large && !parsed.binary) {
    details.open = true;
    fill();
  }
  return details;
}

function filesSection(commit) {
  const wrap = setting(STORAGE.WRAP) !== "0";
  const section = h("section", { class: wrap ? "files wrap" : "files" });
  const list = h("div", { class: "file-list" }, h("p", { class: "loading", text: "Cargando diffs…" }));
  const wrapBtn = h("button", { class: "pill", type: "button", "aria-pressed": String(wrap), text: "Ajustar líneas" });
  wrapBtn.addEventListener("click", () => {
    const next = !section.classList.contains("wrap");
    section.classList.toggle("wrap", next);
    wrapBtn.setAttribute("aria-pressed", String(next));
    saveSetting(STORAGE.WRAP, next ? "1" : "0");
  });
  const toggleAll = (open) => list.querySelectorAll("details.file").forEach((d) => { d.open = open; });
  section.append(
    h("div", { class: "files-head" },
      h("h2", { class: "section-title", id: "files-title", text: "Archivos" }),
      h("div", { class: "pills" },
        wrapBtn,
        h("button", { class: "pill", type: "button", onclick: () => toggleAll(true), text: "Abrir" }),
        h("button", { class: "pill", type: "button", onclick: () => toggleAll(false), text: "Cerrar" }))),
    list);
  const sha = commit[COMMIT.SHA];
  ensureDiffs()
    .then((table) => {
      const files = filesFor(table.rows, sha);
      section.querySelector("#files-title").textContent = `Archivos (${files.length})`;
      const autoOpen = files.length <= AUTO_OPEN_MAX_FILES;
      list.replaceChildren(...(files.length
        ? files.map((file) => fileNode(file, autoOpen))
        : [h("p", { class: "note", text: "Este commit no tiene diffs en la hoja." })]));
    })
    .catch((err) => {
      handleError(err);
      list.replaceChildren(h("p", { class: "warn", text: errorText(state.error) }),
        h("button", { class: "btn", type: "button", onclick: () => render(), text: "Reintentar" }));
      state.error = null;
    });
  return section;
}

function viewCommit(sha, branch) {
  const blocked = gate();
  if (blocked) return [blocked];
  const commit = state.data.commits.rows.find((c) => c[COMMIT.SHA] === sha && c[COMMIT.BRANCH] === (branch || ""))
    || state.data.commits.rows.find((c) => c[COMMIT.SHA] === sha);
  if (!commit) return [emptyCard("Commit no encontrado", sha)];
  const status = commitStatus(commit, reviews());
  const stats = commitStats(commit);
  const body = restLines(commit[COMMIT.MESSAGE]);
  const history = reviewsFor(reviews(), commit);
  const form = h("form", { class: "card review-form", onsubmit: (e) => e.preventDefault() });
  form.append(
    h("label", { class: "field" },
      h("span", { class: "select-label", text: "Comentario" }),
      h("textarea", { rows: 3, placeholder: "Opcional para aprobar o rechazar" })),
    h("div", { class: "actions" },
      h("button", { class: "btn approve", type: "button", onclick: () => submitReview(commit, DECISION.APPROVED, form), text: "Aprobar" }),
      h("button", { class: "btn reject", type: "button", onclick: () => submitReview(commit, DECISION.REJECTED, form), text: "Rechazar" }),
      h("button", { class: "btn", type: "button", onclick: () => submitReview(commit, DECISION.COMMENT, form), text: "Comentar" })),
    h("p", { class: "hint", text: state.auth?.email ? `Se guarda como ${state.auth.email}` : "Se guarda sin revisor." }));
  return [
    h("article", { class: "commit-head" },
      h("div", { class: "commit-badges" }, badge(status), h("span", { class: "mono muted", text: shortSha(commit) })),
      h("h2", { class: "commit-title", text: firstLine(commit[COMMIT.MESSAGE]) || shortSha(commit) }),
      body ? h("p", { class: "commit-body", text: body }) : null),
    h("dl", { class: "card meta" },
      metaRow("Repo", commit[COMMIT.REPO]),
      metaRow("Rama", commit[COMMIT.BRANCH], commit[COMMIT.BRANCH]
        ? h("a", { class: "chip", href: hashFor(ROUTE.BRANCH, commit[COMMIT.REPO], commit[COMMIT.BRANCH]), text: commit[COMMIT.BRANCH] }) : null),
      metaRow("Autor", commit[COMMIT.AUTHOR]),
      metaRow("Fecha", formatDate(commit[COMMIT.DATE])),
      metaRow("SHA", commit[COMMIT.SHA], h("span", { class: "mono break", text: commit[COMMIT.SHA] })),
      metaRow("Padre", commit[COMMIT.PARENT], h("span", { class: "mono break", text: commit[COMMIT.PARENT] })),
      metaRow("Cambios", "", h("span", { class: "stats" },
        h("span", { text: `${stats.files} archivos` }),
        h("span", { class: "add", text: `+${stats.additions}` }),
        h("span", { class: "del", text: `−${stats.deletions}` })))),
    form,
    history.length ? h("section", {},
      h("h2", { class: "section-title", text: "Revisiones" }),
      h("ul", { class: "list reviews" }, history.map((review) => reviewItem(review, false)))) : null,
    filesSection(commit),
  ];
}

function settingsInput(label, key, props = {}) {
  return h("label", { class: "field" },
    h("span", { class: "select-label", text: label }),
    h("input", {
      value: setting(key), autocomplete: "off", spellcheck: "false", ...props,
      onchange: (e) => {
        saveSetting(key, e.target.value.trim());
        toast("Guardado.");
      },
    }));
}

async function choose() {
  try {
    const clientId = setting(STORAGE.CLIENT_ID);
    if (!clientId) throw new AppError(ERROR.NO_CLIENT);
    if (!readStoredToken()) state.auth = await signIn(clientId);
    const picked = await pickSheet({ clientId, apiKey: setting(STORAGE.API_KEY), token: token() });
    if (!picked) return;
    saveSetting(STORAGE.SHEET_ID, picked.id);
    saveSetting(STORAGE.SHEET_NAME, picked.name);
    state.data = null;
    await refresh();
    toast("Hoja conectada.");
  } catch (err) {
    handleError(err);
    toast(errorText(state.error));
    render();
  }
}

function viewSettings() {
  const sheetId = setting(STORAGE.SHEET_ID);
  const sheetName = state.data?.title || setting(STORAGE.SHEET_NAME);
  const pasted = h("input", { placeholder: "ID o URL de la hoja", autocomplete: "off", spellcheck: "false" });
  const savePasted = () => {
    const id = parseSheetInput(pasted.value);
    if (!id) {
      toast("No parece un ID o URL de Google Sheets.");
      return;
    }
    saveSetting(STORAGE.SHEET_ID, id);
    saveSetting(STORAGE.SHEET_NAME, "");
    state.data = null;
    pasted.value = "";
    toast("Hoja guardada.");
    refresh();
  };
  return [
    h("section", { class: "group" },
      h("h2", { class: "group-title", text: "Google" }),
      h("div", { class: "card form" },
        settingsInput("Client ID de OAuth", STORAGE.CLIENT_ID, { placeholder: "…apps.googleusercontent.com" }),
        settingsInput("API key (opcional, para el selector)", STORAGE.API_KEY, { placeholder: "Opcional" }),
        h("p", { class: "hint" }, "Origen autorizado: ", h("span", { class: "mono break", text: location.origin })),
        h("p", { class: "hint" }, "Permisos: ", h("span", { class: "mono break", text: SCOPES.join(" ") })))),
    h("section", { class: "group" },
      h("h2", { class: "group-title", text: "Hoja" }),
      h("div", { class: "card form" },
        h("p", { class: "sheet-current" }, sheetId
          ? [h("strong", { text: sheetName || "Hoja guardada" }), h("span", { class: "mono break muted", text: sheetId })]
          : h("span", { class: "muted", text: "Ninguna hoja elegida." })),
        h("button", { class: "btn primary", type: "button", onclick: choose, text: "Elegir en Drive" }),
        h("label", { class: "field" }, h("span", { class: "select-label", text: "O pega el ID o la URL" }), pasted),
        h("button", { class: "btn", type: "button", onclick: savePasted, text: "Guardar ID" }),
        h("p", { class: "hint", text: "Con un ID pegado, la app solo tiene acceso si la hoja ya se eligió antes en el selector." }))),
    h("section", { class: "group" },
      h("h2", { class: "group-title", text: "Sesión" }),
      h("div", { class: "card form" },
        h("p", { class: "muted", text: state.auth ? `Conectado${state.auth.email ? ` como ${state.auth.email}` : ""}.` : "Sin conectar." }),
        state.auth
          ? h("button", { class: "btn", type: "button", onclick: () => { revoke(state.auth?.token); state.auth = null; state.data = null; render(); }, text: "Cerrar sesión" })
          : h("button", { class: "btn primary", type: "button", onclick: connect, text: "Conectar con Google" }),
        state.auth ? h("button", { class: "btn", type: "button", onclick: refresh, text: "Recargar hoja" }) : null)),
    h("section", { class: "group" },
      h("h2", { class: "group-title", text: "Plantilla" }),
      h("div", { class: "card form" },
        h("p", { class: "hint", text: "Súbela a Drive y ábrela como Hojas de cálculo de Google, o importa un CSV por pestaña." }),
        h("a", { class: "btn primary", href: URLS.TEMPLATE_XLSX, download: "", text: "Descargar plantilla .xlsx" }),
        h("div", { class: "pills" }, CSV_FILES.map((csv) => h("a", { class: "pill", href: csv.href, download: "", text: `${csv.tab}.csv` }))),
        h("p", { class: "hint" }, "Columnas: ", Object.entries(HEADERS).map(([tab, cols]) => h("span", { class: "mono block", text: `${tab}: ${cols.join(", ")}` }))))),
    h("p", { class: "version", text: `${APP_ID} v${APP_VERSION}` }),
  ];
}

function render() {
  const { name, params } = parseRoute();
  const tab = TAB_ROUTE[name];
  document.querySelectorAll(".tabbar a").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === tab);
    if (a.dataset.route === tab) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  const root = ROUTE_ROOTS.has(name);
  const back = document.getElementById("back");
  back.hidden = root;
  back.href = name === ROUTE.BRANCH ? hashFor(ROUTE.BRANCHES) : hashFor(ROUTE.COMMITS);
  document.getElementById("bar-title").textContent = root ? "" : name === ROUTE.BRANCH ? "Rama" : "Commit";
  document.getElementById("refresh").hidden = !(state.auth && configured());
  document.getElementById("refresh").classList.toggle("spin", state.loading);
  const view = document.getElementById("view");
  const parts = [];
  if (root) parts.push(h("h1", { class: "large-title", text: TITLES[name] }));
  if (root && state.data?.title && name !== ROUTE.SETTINGS) parts.push(h("p", { class: "subtitle", text: state.data.title }));
  if (name === ROUTE.COMMITS) parts.push(...viewCommits());
  else if (name === ROUTE.BRANCHES) parts.push(...viewBranches());
  else if (name === ROUTE.BRANCH) parts.push(...viewBranch(params[0] || "", params[1] || ""));
  else if (name === ROUTE.COMMIT) parts.push(...viewCommit(params[0] || "", params[1] || ""));
  else if (name === ROUTE.HISTORY) parts.push(...viewHistory());
  else parts.push(...viewSettings());
  view.replaceChildren(...parts.filter(Boolean));
}

let lastRoute = "";
window.addEventListener("hashchange", () => {
  const current = parseRoute().name;
  render();
  if (current !== lastRoute || current === ROUTE.COMMIT) window.scrollTo(0, 0);
  lastRoute = current;
});
document.getElementById("refresh").addEventListener("click", refresh);
lastRoute = parseRoute().name;
render();
if (state.auth && configured()) refresh();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
