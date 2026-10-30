import { COMMIT, DIFF, GRAPH } from "./config.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const ARROW_ID = "commit-graph-arrow";
const TARGET_SPLIT = /[|\r\n]+/;
const STEP_MS = 2000;
const TAP_MAX_MS = 450;
const TAP_SLOP_PX = 10;
const OPEN_KEYS = Object.freeze(["Enter", " "]);

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

export function buildGraph(commit, diffRows, auto = null) {
  const sha = String(commit?.[COMMIT.SHA] ?? "");
  const rule = cleanLabel(commit?.[GRAPH.RULE]);
  const groups = new Map();
  let seq = 0;
  const groupOf = (path) => {
    if (!groups.has(path)) groups.set(path, { path, label: "", order: null, tos: [], seq: seq++ });
    return groups.get(path);
  };
  for (const node of auto?.nodes || []) groupOf(node.path);
  for (const row of diffRows || []) {
    if (row?.[DIFF.SHA] !== sha) continue;
    const path = cleanLabel(row[DIFF.PATH]);
    if (!path) continue;
    const group = groupOf(path);
    if (!group.label) group.label = cleanLabel(row[GRAPH.LABEL]);
    if (group.order == null) {
      const order = parseOrder(row[GRAPH.ORDER]);
      if (order != null) group.order = order;
    }
    for (const target of splitTargets(row[GRAPH.TO])) {
      if (!group.tos.includes(target)) group.tos.push(target);
    }
  }

  const all = [...groups.values()];
  const agentEdges = all.some((group) => group.tos.length);
  const agentOrders = all.some((group) => group.order != null);
  if (auto) {
    for (const node of auto.nodes) {
      const group = groups.get(node.path);
      if (!group.label) group.label = node.label;
      if (!agentOrders && !agentEdges) group.order = node.order;
    }
  }

  const edges = [];
  const seen = new Set();
  const link = (from, to) => {
    if (from === to || !groups.has(from) || !groups.has(to)) return;
    const key = `${from}\0${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to });
  };
  if (agentEdges || !auto) {
    for (const group of all) group.tos.forEach((target) => link(group.path, target));
  } else {
    auto.edges.forEach((edge) => link(edge.from, edge.to));
  }

  const linked = new Set();
  for (const edge of edges) {
    linked.add(edge.from);
    linked.add(edge.to);
  }
  const nodes = all
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

function nodeCard(node) {
  const card = document.createElement("div");
  card.className = "graph-node";
  card.dataset.path = node.path;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  const phrase = node.label;
  card.title = phrase ? `${phrase} — ${node.path}` : node.path;
  card.setAttribute("aria-label", `Abrir ${node.path}`);
  if (phrase) {
    const phraseEl = document.createElement("span");
    phraseEl.className = "graph-phrase";
    phraseEl.textContent = phrase;
    card.append(phraseEl);
  }
  const fileEl = document.createElement("span");
  fileEl.className = phrase ? "graph-file" : "graph-phrase";
  fileEl.textContent = node.path;
  card.append(fileEl);
  return card;
}

function orderOf(node) {
  return node?.order == null ? Number.POSITIVE_INFINITY : node.order;
}

function graphFrames(graph) {
  const byPath = new Map(graph.nodes.map((node) => [node.path, node]));
  const incident = new Set();
  const frames = [];
  const edges = [...graph.edges].sort((a, b) => orderOf(byPath.get(a.from)) - orderOf(byPath.get(b.from))
    || orderOf(byPath.get(a.to)) - orderOf(byPath.get(b.to))
    || a.from.localeCompare(b.from)
    || a.to.localeCompare(b.to));
  for (const edge of edges) {
    incident.add(edge.from);
    incident.add(edge.to);
    frames.push({
      nodes: [byPath.get(edge.from), byPath.get(edge.to)],
      edges: [edge],
      sort: orderOf(byPath.get(edge.from)),
    });
  }
  for (const node of graph.nodes) {
    if (incident.has(node.path)) continue;
    frames.push({ nodes: [node], edges: [], sort: orderOf(node) });
  }
  return frames
    .map((frame, seq) => ({ ...frame, seq }))
    .sort((a, b) => a.sort - b.sort || a.seq - b.seq)
    .map((frame) => ({ nodes: frame.nodes, edges: frame.edges }));
}

function frameLabel(graph, frame) {
  const parts = [];
  if (graph.rule) parts.push(graph.rule);
  for (const node of frame.nodes) parts.push(node.label || node.path);
  return parts.join(". ");
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

const CLEAR = 6;
const RAIL = 8;
const PADS = [CLEAR, 3, 0];
const OUT = Object.freeze({
  top: Object.freeze({ x: 0, y: -1 }),
  bottom: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 }),
});

function snapBox(box) {
  const left = Math.floor(box.left);
  const top = Math.floor(box.top);
  const right = Math.ceil(box.right);
  const bottom = Math.ceil(box.bottom);
  return {
    left,
    top,
    right,
    bottom,
    cx: Math.round((left + right) / 2),
    cy: Math.round((top + bottom) / 2),
  };
}

function crosses(x1, y1, x2, y2, box) {
  if (x1 === x2) {
    if (x1 <= box.left || x1 >= box.right) return false;
    const lo = Math.min(y1, y2);
    const hi = Math.max(y1, y2);
    return hi > box.top && lo < box.bottom;
  }
  if (y1 === y2) {
    if (y1 <= box.top || y1 >= box.bottom) return false;
    const lo = Math.min(x1, x2);
    const hi = Math.max(x1, x2);
    return hi > box.left && lo < box.right;
  }
  return true;
}

function hits(x1, y1, x2, y2, boxes, pad) {
  for (let i = 0; i < boxes.length; i += 1) {
    const box = boxes[i];
    const grown = pad
      ? { left: box.left - pad, top: box.top - pad, right: box.right + pad, bottom: box.bottom + pad }
      : box;
    if (crosses(x1, y1, x2, y2, grown)) return true;
  }
  return false;
}

function approach(a, b) {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? "top" : "bottom";
  return dx >= 0 ? "left" : "right";
}

function spread(min, max, slot, slots) {
  if (!(max > min) || slots <= 1) return Math.round((min + max) / 2);
  const inset = Math.min(12, Math.floor((max - min) / 4));
  const start = min + inset;
  const end = max - inset;
  if (end <= start) return Math.round((min + max) / 2);
  return Math.round(start + ((end - start) * slot) / (slots - 1));
}

function exitSide(entry) {
  if (entry === "top") return "bottom";
  if (entry === "bottom") return "top";
  if (entry === "left") return "right";
  return "left";
}

function portOn(box, side, slot, slots) {
  if (side === "top" || side === "bottom") {
    const x = spread(box.left + 1, box.right - 1, slot, slots);
    return { x, y: side === "top" ? box.top : box.bottom };
  }
  const y = spread(box.top + 1, box.bottom - 1, slot, slots);
  return { x: side === "left" ? box.left : box.right, y };
}

function shift(point, side, dist) {
  const step = OUT[side];
  return { x: point.x + step.x * dist, y: point.y + step.y * dist };
}

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

function routeClear(start, goal, boxes, width, height, pad) {
  const q = shift(start, start.side, pad);
  const r = shift(goal, goal.side, pad);
  const xs = sortedUnique([
    -RAIL,
    width + RAIL,
    q.x,
    r.x,
    ...boxes.flatMap((box) => [box.left - pad, box.right + pad]),
  ]);
  const ys = sortedUnique([
    q.y,
    r.y,
    ...boxes.flatMap((box) => [box.top - pad, box.bottom + pad]),
  ]);
  const xAt = new Map(xs.map((value, index) => [value, index]));
  const yAt = new Map(ys.map((value, index) => [value, index]));
  if (!xAt.has(q.x) || !yAt.has(q.y) || !xAt.has(r.x) || !yAt.has(r.y)) return null;
  const key = (i, j) => i * ys.length + j;
  const startKey = key(xAt.get(q.x), yAt.get(q.y));
  const goalKey = key(xAt.get(r.x), yAt.get(r.y));
  const open = [startKey];
  const gScore = new Map([[startKey, 0]]);
  const fScore = new Map([[startKey, Math.abs(r.x - q.x) + Math.abs(r.y - q.y)]]);
  const prev = new Map();
  const seen = new Set();
  while (open.length) {
    let best = 0;
    for (let i = 1; i < open.length; i += 1) {
      if (fScore.get(open[i]) < fScore.get(open[best])) best = i;
    }
    const current = open.splice(best, 1)[0];
    if (seen.has(current)) continue;
    if (current === goalKey) {
      const keys = [current];
      while (prev.has(keys[0])) keys.unshift(prev.get(keys[0]));
      return keys.map((id) => ({ x: xs[Math.floor(id / ys.length)], y: ys[id % ys.length] }));
    }
    seen.add(current);
    const i = Math.floor(current / ys.length);
    const j = current % ys.length;
    const steps = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]];
    for (let s = 0; s < steps.length; s += 1) {
      const [ni, nj] = steps[s];
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ys.length) continue;
      const next = key(ni, nj);
      if (seen.has(next)) continue;
      if (hits(xs[i], ys[j], xs[ni], ys[nj], boxes, pad)) continue;
      const cost = gScore.get(current) + Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]);
      if (cost >= (gScore.get(next) ?? Infinity)) continue;
      gScore.set(next, cost);
      fScore.set(next, cost + Math.abs(xs[ni] - r.x) + Math.abs(ys[nj] - r.y));
      prev.set(next, current);
      open.push(next);
    }
  }
  return null;
}

function dedupe(points) {
  const out = [];
  for (const point of points) {
    const prev = out[out.length - 1];
    if (prev && prev.x === point.x && prev.y === point.y) continue;
    out.push(point);
  }
  const merged = [];
  for (const point of out) {
    const a = merged[merged.length - 2];
    const b = merged[merged.length - 1];
    if (a && b && ((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y))) merged[merged.length - 1] = point;
    else merged.push(point);
  }
  return merged;
}

export function routeAround(from, to, boxes, width, height) {
  const entry = approach(from, to);
  const leave = exitSide(entry);
  const source = portOn(from, leave, 0, 1);
  const target = portOn(to, entry, to.slot || 0, to.slots || 1);
  source.side = leave;
  target.side = entry;
  const end = shift(target, entry, 1);
  for (let p = 0; p < PADS.length; p += 1) {
    const pad = PADS[p];
    const middle = routeClear(source, target, boxes, width, height, pad);
    if (!middle) continue;
    const points = dedupe([shift(source, leave, 1), ...middle, end]);
    let blocked = false;
    for (let i = 1; i < points.length; i += 1) {
      if (hits(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, boxes, 0)) blocked = true;
    }
    if (!blocked) return points;
  }
  return null;
}

function toPath(points) {
  return points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
}

function drawEdges(flow, edges) {
  const svg = flow.querySelector(".graph-arrows");
  if (!svg) return;
  const width = flow.clientWidth;
  const height = flow.clientHeight;
  const bleed = RAIL + 4;
  svg.setAttribute("viewBox", `${-bleed} 0 ${width + bleed * 2} ${height}`);
  svg.setAttribute("width", String(width + bleed * 2));
  svg.setAttribute("height", String(height));
  svg.style.left = `${-bleed}px`;
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
  const boxes = [];
  flow.querySelectorAll(".graph-node").forEach((el) => {
    const box = snapBox(boxOf(el, flow));
    nodes.set(el.dataset.path, box);
    boxes.push(box);
  });
  const drawable = edges
    .map((edge) => ({ ...edge, a: nodes.get(edge.from), b: nodes.get(edge.to) }))
    .filter((edge) => edge.a && edge.b);
  const arrivals = new Map();
  for (const edge of drawable) {
    const side = approach(edge.a, edge.b);
    const key = `${edge.to}:${side}`;
    if (!arrivals.has(key)) arrivals.set(key, []);
    arrivals.get(key).push(edge);
  }
  for (const group of arrivals.values()) {
    group.forEach((edge, index) => {
      edge.b = { ...edge.b, slot: index, slots: group.length };
    });
  }

  for (const edge of drawable) {
    const points = routeAround(edge.a, edge.b, boxes, width, height);
    if (!points || points.length < 2) continue;
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", toPath(points));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#d2d2d7");
    path.setAttribute("stroke-width", "1.75");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("stroke-linecap", "butt");
    path.setAttribute("marker-end", `url(#${ARROW_ID})`);
    svg.append(path);
  }
}

export function graphPanel(graph, { onOpen } = {}) {
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

  const frames = graphFrames(graph);
  const flow = document.createElement("div");
  flow.className = "graph-flow";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "graph-arrows");
  svg.setAttribute("aria-hidden", "true");
  flow.append(svg);
  section.append(flow);

  let index = 0;
  let timer = 0;
  let paused = false;
  let remaining = STEP_MS;
  let mark = 0;
  let paintGen = 0;
  const held = new Set();
  const presses = new Map();

  const draw = () => {
    if (!flow.isConnected) return;
    const frame = frames[index];
    const present = [...flow.querySelectorAll(".graph-node")].map((el) => el.dataset.path);
    if (present.length !== frame.nodes.length || frame.nodes.some((node) => !present.includes(node.path))) return;
    drawEdges(flow, frame.edges);
  };

  const paint = () => {
    const gen = ++paintGen;
    const frame = frames[index];
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    flow.className = frame.edges.length ? "graph-flow" : "graph-flow solo";
    flow.dataset.paths = frame.nodes.map((node) => node.path).join("\n");
    if (!reduce) flow.classList.add("is-swap");
    flow.querySelectorAll(".graph-row").forEach((row) => row.remove());
    graphRows(frame.nodes).forEach((row) => {
      const rowEl = document.createElement("div");
      rowEl.className = "graph-row";
      for (const node of row.nodes) rowEl.append(nodeCard(node));
      flow.append(rowEl);
    });
    section.setAttribute("aria-label", frameLabel(graph, frame));
    requestAnimationFrame(() => {
      if (gen !== paintGen) return;
      draw();
      requestAnimationFrame(() => {
        if (gen !== paintGen) return;
        flow.classList.remove("is-swap");
        draw();
      });
    });
  };

  const arm = () => {
    clearTimeout(timer);
    if (paused || frames.length < 2 || !section.isConnected) return;
    mark = performance.now();
    timer = setTimeout(() => {
      if (!section.isConnected) {
        clearGraph();
        return;
      }
      index = (index + 1) % frames.length;
      remaining = STEP_MS;
      paint();
      arm();
    }, remaining);
  };

  const pause = () => {
    if (paused) return;
    paused = true;
    section.dataset.paused = "true";
    if (mark) remaining = Math.max(0, remaining - (performance.now() - mark));
    clearTimeout(timer);
  };

  const resume = () => {
    if (!paused) return;
    paused = false;
    delete section.dataset.paused;
    if (remaining <= 0 && frames.length > 1) {
      index = (index + 1) % frames.length;
      remaining = STEP_MS;
      paint();
    }
    arm();
  };

  const onDown = (event) => {
    if (!section.isConnected) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    held.add(event.pointerId);
    const node = event.target.closest?.(".graph-node");
    if (node) presses.set(event.pointerId, { path: node.dataset.path, x: event.clientX, y: event.clientY, at: performance.now() });
    pause();
  };

  const tapped = (event) => {
    const press = presses.get(event.pointerId);
    presses.delete(event.pointerId);
    if (!press || event.type !== "pointerup" || !onOpen) return null;
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    if (moved > TAP_SLOP_PX || performance.now() - press.at > TAP_MAX_MS) return null;
    return press.path;
  };

  const onUp = (event) => {
    if (!held.has(event.pointerId)) return;
    held.delete(event.pointerId);
    const path = tapped(event);
    if (!section.isConnected) {
      clearGraph();
      return;
    }
    if (!held.size) resume();
    if (path) onOpen(path);
  };

  const onKey = (event) => {
    const node = event.target.closest?.(".graph-node");
    if (!node || !onOpen || !OPEN_KEYS.includes(event.key)) return;
    event.preventDefault();
    onOpen(node.dataset.path);
  };

  const removal = new MutationObserver(() => {
    if (!section.isConnected) clearGraph();
  });

  section.addEventListener("pointerdown", onDown);
  section.addEventListener("contextmenu", (event) => event.preventDefault());
  section.addEventListener("keydown", onKey);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  const observer = new ResizeObserver(draw);
  observer.observe(flow);
  unmount = () => {
    clearTimeout(timer);
    observer.disconnect();
    removal.disconnect();
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    held.clear();
    presses.clear();
  };
  paint();
  requestAnimationFrame(() => {
    if (!section.isConnected) return;
    if (section.parentNode) removal.observe(section.parentNode, { childList: true });
    arm();
  });
  return section;
}
