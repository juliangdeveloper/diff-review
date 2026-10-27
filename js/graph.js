import { COMMIT, DIFF, GRAPH } from "./config.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const ARROW_ID = "commit-graph-arrow";
const TARGET_SPLIT = /[|\r\n]+/;
const HEAD = 7;

let unmount = () => {};

function parseOrder(value) {
  const text = String(value ?? "").trim();
  if (!/^-?\d+$/.test(text)) return null;
  const order = Number(text);
  return Number.isSafeInteger(order) ? order : null;
}

function splitTargets(value) {
  return String(value ?? "").split(TARGET_SPLIT).map((part) => part.trim()).filter(Boolean);
}

function cleanLabel(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function buildGraph(commit, diffRows) {
  const sha = String(commit?.[COMMIT.SHA] ?? "");
  const rule = cleanLabel(commit?.[GRAPH.RULE]);
  const groups = new Map();
  let seq = 0;
  for (const row of diffRows || []) {
    if (row?.[DIFF.SHA] !== sha) continue;
    const path = cleanLabel(row[DIFF.PATH]);
    if (!path) continue;
    if (!groups.has(path)) {
      groups.set(path, { path, label: "", order: null, tos: [], seq: seq++ });
    }
    const group = groups.get(path);
    if (!group.label) group.label = cleanLabel(row[GRAPH.LABEL]);
    if (group.order == null) {
      const order = parseOrder(row[GRAPH.ORDER]);
      if (order != null) group.order = order;
    }
    for (const target of splitTargets(row[GRAPH.TO])) {
      if (!group.tos.includes(target)) group.tos.push(target);
    }
  }

  const edges = [];
  const seen = new Set();
  for (const group of groups.values()) {
    for (const target of group.tos) {
      if (target === group.path || !groups.has(target)) continue;
      const key = `${group.path}\0${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: group.path, to: target });
    }
  }

  const linked = new Set();
  for (const edge of edges) {
    linked.add(edge.from);
    linked.add(edge.to);
  }
  const nodes = [...groups.values()]
    .filter((group) => group.label || group.order != null || linked.has(group.path))
    .sort((a, b) => {
      const ao = a.order == null ? Number.POSITIVE_INFINITY : a.order;
      const bo = b.order == null ? Number.POSITIVE_INFINITY : b.order;
      return ao - bo || a.seq - b.seq;
    })
    .map((group) => ({ path: group.path, label: group.label, order: group.order }));

  if (!rule && !nodes.length) return null;
  return { rule, nodes, edges };
}

export function graphRows(nodes) {
  const rows = [];
  let current = null;
  for (const node of nodes) {
    const sameOrder = node.order != null && current && current.order === node.order;
    if (!sameOrder) {
      current = { order: node.order, nodes: [node] };
      rows.push(current);
    } else current.nodes.push(node);
  }
  return rows;
}

export function clearGraph() {
  unmount();
  unmount = () => {};
}

function nodeButton(node, rowIndex, onSelect) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "graph-node";
  button.dataset.path = node.path;
  button.dataset.row = String(rowIndex);
  const phrase = node.label;
  button.setAttribute("aria-label", phrase
    ? `${phrase}. ${node.path}. Abre el diff de este archivo.`
    : `${node.path}. Abre el diff de este archivo.`);
  button.title = phrase ? `${phrase} — ${node.path}` : node.path;
  if (phrase) {
    const phraseEl = document.createElement("span");
    phraseEl.className = "graph-phrase";
    phraseEl.textContent = phrase;
    button.append(phraseEl);
  }
  const fileEl = document.createElement("span");
  fileEl.className = phrase ? "graph-file" : "graph-phrase";
  fileEl.textContent = node.path;
  button.append(fileEl);
  button.addEventListener("click", () => onSelect(node.path));
  return button;
}

function boxOf(el, root) {
  const rect = el.getBoundingClientRect();
  const origin = root.getBoundingClientRect();
  return {
    left: rect.left - origin.left,
    right: rect.right - origin.left,
    top: rect.top - origin.top,
    bottom: rect.bottom - origin.top,
    cx: rect.left - origin.left + rect.width / 2,
    cy: rect.top - origin.top + rect.height / 2,
    width: rect.width,
    height: rect.height,
  };
}

function slotX(box, slot, slots) {
  if (slots <= 1) return box.cx;
  const inset = Math.min(28, box.width * 0.22);
  const start = box.left + inset;
  const end = box.right - inset;
  return start + ((end - start) * slot) / (slots - 1);
}

function sideRoute(a, b) {
  const forward = b.cx >= a.cx;
  const x1 = forward ? a.right : a.left;
  const x2 = (forward ? b.left : b.right) + (forward ? -HEAD : HEAD);
  if (Math.abs(a.cy - b.cy) < 8) return `M ${x1} ${a.cy} L ${x2} ${b.cy}`;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${a.cy} L ${mid} ${a.cy} L ${mid} ${b.cy} L ${x2} ${b.cy}`;
}

function verticalRoute(edge) {
  const { a, b } = edge;
  const down = b.cy >= a.cy;
  const x1 = a.cx;
  const x2 = slotX(b, edge.slot, edge.slots);
  const y1 = down ? a.bottom : a.top;
  const y2 = (down ? b.top : b.bottom) + (down ? -HEAD : HEAD);
  if (Math.abs(x1 - x2) < 10) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const mid = (y1 + y2) / 2;
  return `M ${x1} ${y1} L ${x1} ${mid} L ${x2} ${mid} L ${x2} ${y2}`;
}

function routeEdge(edge) {
  const { a, b } = edge;
  const below = b.top - a.bottom;
  const above = a.top - b.bottom;
  if ((below > 6 || above > 6) && Math.abs(a.row - b.row) > 1 && Math.max(below, above) > 80) {
    return { rail: true };
  }
  if (below > 6 || above > 6) return { rail: false, d: verticalRoute(edge) };
  if (b.left - a.right > 4 || a.left - b.right > 4) return { rail: false, d: sideRoute(a, b) };
  return { rail: false, d: verticalRoute(edge) };
}

function railRoute(edge, lane, width) {
  const { a, b } = edge;
  const x = Math.min(width - 6, Math.max(a.right, b.right) + 14 + lane * 12);
  const x2 = b.right + HEAD;
  return `M ${a.right} ${a.cy} L ${x} ${a.cy} L ${x} ${b.cy} L ${x2} ${b.cy}`;
}

function drawEdges(flow, edges) {
  const svg = flow.querySelector(".graph-arrows");
  if (!svg) return;
  const width = flow.clientWidth;
  const height = flow.clientHeight;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.replaceChildren();
  if (!edges.length || width < 2 || height < 2) return;

  const defs = document.createElementNS(SVG_NS, "defs");
  const marker = document.createElementNS(SVG_NS, "marker");
  marker.setAttribute("id", ARROW_ID);
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "9");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", "7");
  marker.setAttribute("markerHeight", "7");
  marker.setAttribute("orient", "auto");
  const head = document.createElementNS(SVG_NS, "path");
  head.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  head.setAttribute("fill", "#d2d2d7");
  marker.append(head);
  defs.append(marker);
  svg.append(defs);

  const nodes = new Map();
  flow.querySelectorAll(".graph-node").forEach((el) => {
    nodes.set(el.dataset.path, { ...boxOf(el, flow), row: Number(el.dataset.row) });
  });
  const drawable = edges
    .map((edge) => ({ ...edge, a: nodes.get(edge.from), b: nodes.get(edge.to) }))
    .filter((edge) => edge.a && edge.b);
  const arrivals = new Map();
  for (const edge of drawable) {
    const side = edge.b.row > edge.a.row ? "top" : "bottom";
    const key = `${edge.to}:${side}`;
    if (!arrivals.has(key)) arrivals.set(key, []);
    arrivals.get(key).push(edge);
  }
  for (const group of arrivals.values()) {
    group.forEach((edge, index) => {
      edge.slot = index;
      edge.slots = group.length;
    });
  }

  let lane = 0;
  for (const edge of drawable) {
    const path = document.createElementNS(SVG_NS, "path");
    const route = routeEdge(edge);
    path.setAttribute("d", route.rail ? railRoute(edge, lane++, width) : route.d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#d2d2d7");
    path.setAttribute("stroke-width", "1.75");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("marker-end", `url(#${ARROW_ID})`);
    svg.append(path);
  }
}

export function graphPanel(graph, onSelect) {
  clearGraph();
  if (!graph) {
    const note = document.createElement("p");
    note.className = "graph-empty";
    note.id = "commit-graph";
    note.dataset.state = "empty";
    note.textContent = "Este commit no tiene datos de grafo.";
    return note;
  }

  const section = document.createElement("section");
  section.className = "graph-card";
  section.id = "commit-graph";
  section.dataset.state = graph.nodes.length ? "ready" : "rule";
  section.setAttribute("aria-label", graph.rule || "Grafo del commit");
  if (graph.rule) {
    const title = document.createElement("h3");
    title.className = "graph-rule";
    title.textContent = graph.rule;
    section.append(title);
  }
  if (!graph.nodes.length) {
    const note = document.createElement("p");
    note.className = "graph-note";
    note.textContent = "La hoja trae la regla, pero ningún archivo tiene frase ni conexión.";
    section.append(note);
    return section;
  }

  const flow = document.createElement("div");
  flow.className = graph.edges.length ? "graph-flow" : "graph-flow solo";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "graph-arrows");
  svg.setAttribute("aria-hidden", "true");
  flow.append(svg);
  graphRows(graph.nodes).forEach((row, index) => {
    const rowEl = document.createElement("div");
    rowEl.className = "graph-row";
    for (const node of row.nodes) rowEl.append(nodeButton(node, index, onSelect));
    flow.append(rowEl);
  });
  section.append(flow);

  const draw = () => {
    if (!flow.isConnected) return;
    drawEdges(flow, graph.edges);
  };
  const observer = new ResizeObserver(draw);
  observer.observe(flow);
  unmount = () => observer.disconnect();
  requestAnimationFrame(() => {
    draw();
    requestAnimationFrame(draw);
  });
  return section;
}
