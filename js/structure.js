import { LABEL, NODE, NODE_KIND, NODE_STATUS } from "./config.js";

export const SIDE = Object.freeze({ OLD: "old", NEW: "new" });
const OWNER_KINDS = new Set(Object.values(NODE_KIND));
const PANEL_ID = "commit-structure";
const PARTIAL_NOTE = "Estructura parcial: faltan contenidos de algunos archivos.";
const COUNTLESS_KINDS = new Set([NODE_KIND.MODULE, NODE_KIND.FILE]);
const STATUS_ORDER = Object.freeze([NODE_STATUS.ADDED, NODE_STATUS.MODIFIED, NODE_STATUS.REMOVED]);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function note(text, state) {
  const p = el("p", "graph-empty", text);
  p.id = PANEL_ID;
  p.dataset.state = state;
  return p;
}

export function buildStructure(rows) {
  const files = new Map();
  for (const row of rows || []) {
    const path = String(row[NODE.PATH] || "").trim();
    const id = String(row[NODE.ID] || "").trim();
    if (!path || !id) continue;
    if (!files.has(path)) files.set(path, { path, nodes: new Map(), roots: [] });
    const file = files.get(path);
    if (file.nodes.has(id)) continue;
    file.nodes.set(id, {
      id,
      parent: String(row[NODE.PARENT] || "").trim(),
      kind: String(row[NODE.KIND] || "").trim(),
      name: String(row[NODE.NAME] || "").trim(),
      status: String(row[NODE.STATUS] || "").trim(),
      line: Number.parseInt(row[NODE.LINE], 10) || 0,
      detail: String(row[NODE.DETAIL] || "").trim(),
      children: [],
    });
  }
  for (const file of files.values()) {
    for (const node of file.nodes.values()) {
      const parent = node.parent && file.nodes.get(node.parent);
      if (parent && parent !== node) parent.children.push(node);
      else file.roots.push(node);
    }
    file.counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
    for (const node of file.nodes.values()) {
      if (OWNER_KINDS.has(node.kind) && !COUNTLESS_KINDS.has(node.kind) && node.status in file.counts) file.counts[node.status] += 1;
    }
  }
  return [...files.values()];
}

function sideOf(node) {
  return node.status === NODE_STATUS.REMOVED ? SIDE.OLD : SIDE.NEW;
}

function statusBadge(status) {
  return el("span", `badge node-badge node-${status}`, LABEL.node[status] || status);
}

function opener(button, path, node, onOpen) {
  button.type = "button";
  button.addEventListener("click", () => onOpen?.(path, node ? node.line : 0, node ? sideOf(node) : SIDE.NEW));
}

function leafRow(path, node, onOpen) {
  const li = el("li", `struct-leaf node-${node.status}`);
  const button = el("button", "struct-leaf-btn");
  button.dataset.line = String(node.line || "");
  button.append(
    el("span", "struct-dot"),
    el("span", "struct-kind", LABEL.kind[node.kind] || node.kind),
    el("span", "struct-code", node.name),
  );
  button.title = `${LABEL.node[node.status] || node.status} · ${node.name}`;
  button.setAttribute("aria-label", `${LABEL.kind[node.kind] || node.kind} ${LABEL.node[node.status] || node.status}: ${node.name}`);
  opener(button, path, node, onOpen);
  li.append(button);
  return li;
}

function ownerNode(path, node, onOpen) {
  const li = el("li", `struct-node node-${node.status}`);
  const button = el("button", "struct-head");
  const title = el("span", "struct-title");
  title.append(el("span", "struct-name", node.name));
  if (node.detail) title.append(el("span", "struct-params", node.detail));
  button.append(el("span", "struct-kind", LABEL.kind[node.kind] || node.kind), title, statusBadge(node.status));
  button.setAttribute("aria-label", `${LABEL.kind[node.kind] || node.kind} ${node.name}: ${LABEL.node[node.status] || node.status}. Abrir diff`);
  opener(button, path, node, onOpen);
  li.append(button);
  if (node.children.length) li.append(childList(path, node.children, onOpen));
  return li;
}

function childList(path, nodes, onOpen) {
  const ul = el("ul", "struct-children");
  for (const child of nodes) ul.append(OWNER_KINDS.has(child.kind) ? ownerNode(path, child, onOpen) : leafRow(path, child, onOpen));
  return ul;
}

function fileCard(file, onOpen) {
  const card = el("div", "struct-file");
  card.dataset.path = file.path;
  const head = el("button", "struct-path");
  head.append(el("span", "struct-path-text", file.path));
  const counts = el("span", "struct-counts");
  for (const status of STATUS_ORDER) {
    if (file.counts[status]) counts.append(el("span", `struct-count node-${status}`, `${LABEL.node[status]} ${file.counts[status]}`));
  }
  head.append(counts);
  head.setAttribute("aria-label", `Abrir ${file.path}`);
  opener(head, file.path, null, onOpen);
  card.append(head, childList(file.path, file.roots, onOpen));
  return card;
}

export function structurePanel(rows, { onOpen, partial = false } = {}) {
  if (rows == null) return note("Para ver Estructura, actualiza Code.gs en tu hoja y publica una nueva versión.", "outdated");
  const files = buildStructure(rows);
  if (!files.length) return note("Este commit no tiene datos de estructura.", "empty");
  const section = el("section", "struct-card");
  section.id = PANEL_ID;
  section.dataset.state = "ready";
  section.setAttribute("aria-label", "Estructura del commit");
  if (partial) {
    section.dataset.partial = "true";
    section.append(el("p", "struct-partial", PARTIAL_NOTE));
  }
  for (const file of files) section.append(fileCard(file, onOpen));
  return section;
}
