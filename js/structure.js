import { LABEL, NODE_STATUS } from "./config.js";
import { computeLogicLayout, LAYOUT_MARGIN, SHAPE } from "./diffgraph/layout.js";

export const SIDE = Object.freeze({ OLD: "old", NEW: "new" });
const PANEL_ID = "commit-structure";
const PARTIAL_NOTE = "Estructura parcial: faltan contenidos de algunos archivos.";
const OUTDATED_NOTE = "Para ver Estructura, actualiza Code.gs en tu hoja y publica una nueva versión.";
const EMPTY_NOTE = "Este commit no tiene datos de estructura.";
const NO_CHANGES_NOTE = "Sin nodos con cambios en este lado.";
const SVG_NS = "http://www.w3.org/2000/svg";
const SPLIT_MIN_WIDTH = 640;
const SCALE = Object.freeze({ MIN: 0.05, MAX: 2, READABLE: 0.75, COMPACT: 0.4, STEP: 1.25 });
const VIEW_PAD = 16;
const TOOLBAR_GAP = 8;
const TAP_SLOP = 8;
const CANVAS = Object.freeze({ MIN: 120, MAX: 460, VIEWPORT_SHARE: 0.55 });
const DIAMOND_HALF = 85;
const CURVATURE = 0.25;
const LABEL_PAD = Object.freeze({ X: 8, Y: 5 });
const LABEL_CHAR_W = 7.5;
const LABEL_H = 14;
const WHEEL_FACTOR = 0.0015;
const ARROW = 14;
const BEZIER = Object.freeze({ HALF: 0.5, BACKWARD: 25, END: 0.125, CONTROL: 0.375 });
const MARKER = Object.freeze({ VIEW_BOX: "-10 -10 20 20", POINTS: "-5,-4 0,0 -5,4 -5,-4" });
const LABEL_BOX = Object.freeze({ RADIUS: 6, FILL: "#020617", OPACITY: 0.92, STROKE: "#334155", STROKE_WIDTH: 1.1, FONT_SIZE: 12, FONT_WEIGHT: 800, LETTER_SPACING: 0.2 });
const SCALE_DIGITS = 3;
const PINCH_WHEEL_BOOST = 4;
let markerSeed = 0;
const SIDE_LABEL = Object.freeze({ [SIDE.OLD]: "Antes", [SIDE.NEW]: "Después" });
const STATS = Object.freeze([NODE_STATUS.ADDED, NODE_STATUS.REMOVED, NODE_STATUS.MODIFIED]);
const STAT_SIGN = Object.freeze({ [NODE_STATUS.ADDED]: "+", [NODE_STATUS.REMOVED]: "−", [NODE_STATUS.MODIFIED]: "~" });

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function note(text, state) {
  const p = el("p", "graph-empty", text);
  p.id = PANEL_ID;
  p.dataset.state = state;
  return p;
}

function splitLabel(label) {
  const index = label.indexOf("\n");
  return index < 0 ? { title: label, code: "" } : { title: label.slice(0, index), code: label.slice(index + 1) };
}

function bareName(label) {
  const bare = label.replace(/^\[[^\]]+\]\s*/, "").trim();
  const paren = bare.indexOf("(");
  return (paren >= 0 ? bare.slice(0, paren) : bare).trim();
}

function controlOffset(distance) {
  return distance >= 0 ? BEZIER.HALF * distance : CURVATURE * BEZIER.BACKWARD * Math.sqrt(-distance);
}

function anchor(node, handle) {
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  if (node.shape === SHAPE.DIAMOND) {
    if (handle === "right") return { x: cx + DIAMOND_HALF, y: cy, dir: "right" };
    if (handle === "left") return { x: cx - DIAMOND_HALF, y: cy, dir: "left" };
    if (handle === "top") return { x: cx, y: cy - DIAMOND_HALF, dir: "top" };
    return { x: cx, y: cy + DIAMOND_HALF, dir: "bottom" };
  }
  if (handle === "top") return { x: cx, y: node.y, dir: "top" };
  return { x: cx, y: node.y + node.h, dir: "bottom" };
}

function control(point, other) {
  if (point.dir === "right") return { x: point.x + controlOffset(other.x - point.x), y: point.y };
  if (point.dir === "left") return { x: point.x - controlOffset(point.x - other.x), y: point.y };
  if (point.dir === "top") return { x: point.x, y: point.y - controlOffset(point.y - other.y) };
  return { x: point.x, y: point.y + controlOffset(other.y - point.y) };
}

function bezier(source, target) {
  const c1 = control(source, target);
  const c2 = control(target, source);
  const mid = {
    x: (source.x + target.x) * BEZIER.END + (c1.x + c2.x) * BEZIER.CONTROL,
    y: (source.y + target.y) * BEZIER.END + (c1.y + c2.y) * BEZIER.CONTROL,
  };
  return { d: `M${source.x},${source.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${target.x},${target.y}`, mid };
}

function edgeLayer(layout) {
  markerSeed += 1;
  const layer = svg("svg", { class: "flow-edges", width: layout.width, height: layout.height, "aria-hidden": "true" });
  const defs = svg("defs");
  const markers = new Map();
  const markerFor = (color) => {
    if (markers.has(color)) return markers.get(color);
    const id = `flow-arrow-${markerSeed}-${markers.size}`;
    const marker = svg("marker", { id, viewBox: MARKER.VIEW_BOX, markerWidth: ARROW, markerHeight: ARROW, refX: 0, refY: 0, orient: "auto-start-reverse", markerUnits: "userSpaceOnUse" });
    marker.append(svg("polyline", { points: MARKER.POINTS, fill: color, stroke: color, "stroke-linejoin": "round", "stroke-width": 1 }));
    defs.append(marker);
    markers.set(color, id);
    return id;
  };
  layer.append(defs);
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const labels = svg("g");
  for (const edge of layout.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    const { d, mid } = bezier(anchor(source, edge.handle), anchor(target, "top"));
    const path = svg("path", { d, fill: "none", stroke: edge.stroke, "stroke-width": edge.width, "marker-end": `url(#${markerFor(edge.stroke)})` });
    if (edge.dash) path.setAttribute("stroke-dasharray", edge.dash);
    if (edge.animated) path.classList.add("flow-animated");
    path.dataset.edge = edge.id;
    layer.append(path);
    if (!edge.label) continue;
    const width = edge.label.length * LABEL_CHAR_W + LABEL_PAD.X * 2;
    const height = LABEL_H + LABEL_PAD.Y * 2;
    const group = svg("g", { transform: `translate(${mid.x - width / 2},${mid.y - height / 2})` });
    group.append(
      svg("rect", { width, height, rx: LABEL_BOX.RADIUS, ry: LABEL_BOX.RADIUS, fill: LABEL_BOX.FILL, "fill-opacity": LABEL_BOX.OPACITY, stroke: LABEL_BOX.STROKE, "stroke-width": LABEL_BOX.STROKE_WIDTH }),
      svg("text", { x: width / 2, y: height / 2, fill: edge.labelFill, "font-size": LABEL_BOX.FONT_SIZE, "font-weight": LABEL_BOX.FONT_WEIGHT, "letter-spacing": LABEL_BOX.LETTER_SPACING, "text-anchor": "middle", "dominant-baseline": "central" }),
    );
    group.lastChild.textContent = edge.label;
    labels.append(group);
  }
  layer.append(labels);
  return layer;
}

function nodeBox(node) {
  const box = el("div", `flow-node flow-${node.shape} node-${node.diffStatus}`);
  box.dataset.node = node.id;
  box.dataset.path = node.filePath || "";
  box.dataset.line = String(node.startLine || "");
  box.tabIndex = 0;
  box.setAttribute("role", "button");
  box.style.left = `${node.x}px`;
  box.style.top = `${node.y}px`;
  box.style.width = `${node.w}px`;
  box.style.height = `${node.h}px`;
  box.style.setProperty("--bg", node.colors.bg);
  box.style.setProperty("--fg", node.colors.text);
  const status = LABEL.node[node.diffStatus] || node.diffStatus;
  if (node.shape === SHAPE.GROUP) {
    const head = el("div", "flow-head");
    const meta = [node.className ? `Clase: ${node.className}` : "", node.fileName ? `Archivo: ${node.fileName}` : ""].filter(Boolean).join("  |  ");
    head.append(el("div", "flow-title", node.label), el("div", "flow-title-compact", bareName(node.label) || node.label));
    if (meta) head.append(el("div", "flow-meta", meta));
    box.append(head);
    if (node.paramsRow) box.append(el("div", "flow-strip flow-params", String(node.functionParams).trim()));
    if (node.depsRow) box.append(el("div", "flow-strip flow-deps", `Deps: ${String(node.hookDependencies).trim()}`));
    box.setAttribute("aria-label", `${node.label}: ${status}. Abrir diff`);
    return box;
  }
  const { title, code } = splitLabel(node.label);
  const body = el("div", "flow-body");
  body.append(el("div", "flow-leaf-title", title));
  if (code) body.append(el("div", "flow-code", code));
  if (node.shape === SHAPE.DIAMOND) {
    const shape = el("div", "flow-diamond-shape");
    shape.append(body);
    box.append(shape, el("span", "flow-handle flow-handle-t", "T"), el("span", "flow-handle flow-handle-n", "N"), el("span", "flow-handle flow-handle-f", "F"));
  } else {
    box.append(body);
  }
  box.title = node.label;
  box.setAttribute("aria-label", `${title} ${code}: ${status}. Abrir diff`);
  return box;
}

function focusOf(layout) {
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const rootOf = (node) => {
    let current = node;
    while (current.parentId && byId.has(current.parentId)) current = byId.get(current.parentId);
    return current;
  };
  const roots = new Set(layout.nodes.filter((node) => node.diffStatus !== NODE_STATUS.UNCHANGED).map(rootOf));
  const list = roots.size ? [...roots] : layout.nodes.map(rootOf);
  return list.sort((a, b) => a.y - b.y || a.x - b.x)[0];
}

function canvasFor(graph, side, { onPick, height, inset = () => 0 }) {
  const layout = computeLogicLayout(graph);
  const canvas = el("div", "flow-canvas");
  canvas.dataset.side = side;
  canvas.setAttribute("aria-label", `Diagrama ${SIDE_LABEL[side]}`);
  const world = el("div", "flow-world");
  world.style.width = `${layout.width}px`;
  world.style.height = `${layout.height}px`;
  canvas.append(world);
  if (!layout.nodes.length) {
    canvas.classList.add("flow-blank");
    canvas.append(el("p", "flow-blank-note", NO_CHANGES_NOTE));
    return { canvas, layout, fit: () => {}, zoom: () => {}, reset: () => {}, size: () => CANVAS.MIN };
  }
  world.append(edgeLayer(layout));
  for (const node of layout.nodes) world.append(nodeBox(node));
  const view = { x: 0, y: 0, s: 1 };
  const apply = () => {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
    world.classList.toggle("flow-compact", view.s <= SCALE.COMPACT);
    canvas.dataset.scale = view.s.toFixed(SCALE_DIGITS);
  };
  const clamp = (value) => Math.min(SCALE.MAX, Math.max(SCALE.MIN, value));
  const zoomAt = (factor, px, py) => {
    const next = clamp(view.s * factor);
    const ratio = next / view.s;
    view.x = px - (px - view.x) * ratio;
    view.y = py - (py - view.y) * ratio;
    view.s = next;
    apply();
  };
  const box = () => ({ w: canvas.clientWidth || layout.width, h: canvas.clientHeight || height });
  const content = { w: Math.max(1, layout.width - LAYOUT_MARGIN * 2), h: Math.max(1, layout.height - LAYOUT_MARGIN * 2) };
  const fitScale = () => {
    const { w, h } = box();
    return Math.min((w - VIEW_PAD * 2) / content.w, (h - inset() - VIEW_PAD * 2) / content.h, 1);
  };
  const fit = () => {
    const { w, h } = box();
    const top = inset();
    view.s = clamp(fitScale());
    view.x = (w - content.w * view.s) / 2 - LAYOUT_MARGIN * view.s;
    view.y = top + (h - top - content.h * view.s) / 2 - LAYOUT_MARGIN * view.s;
    apply();
  };
  const reset = () => {
    if (fitScale() >= SCALE.READABLE) {
      fit();
      return;
    }
    const { w, h } = box();
    const top = inset() + VIEW_PAD;
    view.s = clamp(Math.max(SCALE.READABLE, Math.min(1, (w - VIEW_PAD * 2) / content.w)));
    const focus = focusOf(layout);
    const minX = w - (LAYOUT_MARGIN + content.w) * view.s - VIEW_PAD;
    const minY = h - (LAYOUT_MARGIN + content.h) * view.s - VIEW_PAD;
    const focusX = focus.w * view.s <= w - VIEW_PAD * 2 ? w / 2 - (focus.x + focus.w / 2) * view.s : VIEW_PAD - focus.x * view.s;
    view.x = content.w * view.s <= w - VIEW_PAD * 2 ? (w - content.w * view.s) / 2 - LAYOUT_MARGIN * view.s : Math.min(VIEW_PAD - LAYOUT_MARGIN * view.s, Math.max(minX, focusX));
    view.y = Math.min(top - LAYOUT_MARGIN * view.s, Math.max(minY, top - focus.y * view.s));
    apply();
  };
  const pointers = new Map();
  let gesture = null;
  const local = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  canvas.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".flow-controls")) return;
    const point = local(event);
    pointers.set(event.pointerId, point);
    canvas.setPointerCapture?.(event.pointerId);
    if (pointers.size === 1) {
      gesture = { start: point, last: point, moved: false, multi: false, target: event.target.closest("[data-node]") };
    } else if (gesture) {
      gesture.multi = true;
      gesture.moved = true;
      const [a, b] = [...pointers.values()];
      gesture.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    const point = local(event);
    pointers.set(event.pointerId, point);
    if (pointers.size >= 2 && gesture.pinch) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      view.x += mid.x - gesture.pinch.mid.x;
      view.y += mid.y - gesture.pinch.mid.y;
      zoomAt(dist / gesture.pinch.dist, mid.x, mid.y);
      gesture.pinch = { dist, mid };
      return;
    }
    if (!gesture.moved && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) < TAP_SLOP) return;
    gesture.moved = true;
    view.x += point.x - gesture.last.x;
    view.y += point.y - gesture.last.y;
    gesture.last = point;
    apply();
  });
  const end = (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size === 1 && gesture) {
      const [rest] = [...pointers.values()];
      gesture.last = rest;
      gesture.pinch = null;
    }
    if (pointers.size) return;
    const done = gesture;
    gesture = null;
    if (event.type === "pointerup" && done && !done.moved && !done.multi && done.target) onPick(done.target);
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const point = local(event);
    if (event.ctrlKey || event.metaKey || Math.abs(event.deltaY) >= Math.abs(event.deltaX)) zoomAt(Math.exp(-event.deltaY * WHEEL_FACTOR * (event.ctrlKey ? PINCH_WHEEL_BOOST : 1)), point.x, point.y);
    else {
      view.x -= event.deltaX;
      apply();
    }
  }, { passive: false });
  canvas.addEventListener("keydown", (event) => {
    const target = event.target.closest?.("[data-node]");
    if (target && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onPick(target);
    }
  });
  const zoom = (factor) => {
    const { w, h } = box();
    zoomAt(factor, w / 2, h / 2);
  };
  const size = () => Math.round(content.h * SCALE.READABLE + VIEW_PAD * 2 + inset());
  return { canvas, layout, fit, zoom, reset, size };
}

function chips(stats) {
  const wrap = el("div", "flow-chips");
  for (const status of STATS) {
    if (!stats[status]) continue;
    const chip = el("span", `flow-chip node-${status}`, `${STAT_SIGN[status]}${stats[status]}`);
    chip.title = `${LABEL.node[status]}: ${stats[status]}`;
    chip.setAttribute("aria-label", chip.title);
    chip.dataset.status = status;
    wrap.append(chip);
  }
  return wrap;
}

function controls(handlers) {
  const bar = el("div", "flow-controls");
  const make = (text, label, onClick) => {
    const button = el("button", "flow-control", text);
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.addEventListener("click", onClick);
    return button;
  };
  bar.append(
    make("+", "Acercar", () => handlers.zoom(SCALE.STEP)),
    make("−", "Alejar", () => handlers.zoom(1 / SCALE.STEP)),
    make("⤢", "Ver todo", () => handlers.fit()),
  );
  return bar;
}

export function structurePanel(flow, { onOpen } = {}) {
  if (flow == null) return note(OUTDATED_NOTE, "outdated");
  if (!flow.oldAll.nodes.length && !flow.newAll.nodes.length) return note(EMPTY_NOTE, "empty");
  const section = el("section", "flow-card");
  section.id = PANEL_ID;
  section.dataset.state = "ready";
  section.setAttribute("aria-label", "Estructura del commit");
  if (flow.partial) {
    section.dataset.partial = "true";
    section.append(el("p", "struct-partial", PARTIAL_NOTE));
  }
  const toolbar = el("div", "flow-toolbar");
  const changesBtn = el("button", "pill", "Solo cambios");
  changesBtn.type = "button";
  changesBtn.id = "flow-changes";
  const sideBar = el("div", "flow-sides");
  sideBar.setAttribute("role", "group");
  sideBar.setAttribute("aria-label", "Lado");
  const sideButtons = {};
  for (const side of [SIDE.OLD, SIDE.NEW]) {
    const button = el("button", "pill", SIDE_LABEL[side]);
    button.type = "button";
    button.dataset.side = side;
    sideButtons[side] = button;
    sideBar.append(button);
  }
  toolbar.append(sideBar, changesBtn);
  const stage = el("div", "flow-stage");
  const frame = el("div", "flow-frame");
  frame.append(stage, toolbar, chips(flow.stats));
  section.append(frame);
  const inset = () => toolbar.offsetHeight + TOOLBAR_GAP;
  const state = { changesOnly: true, side: SIDE.NEW, split: false, canvases: {} };
  const pick = (side) => (target) => {
    section.querySelectorAll(".flow-node.selected").forEach((node) => node.classList.remove("selected"));
    target.classList.add("selected");
    const graph = state.graphs[side];
    const node = graph.nodes.find((item) => item.id === target.dataset.node);
    if (!node?.filePath) return;
    onOpen?.(node.filePath, flow.lineOf(node, side), side === SIDE.OLD ? SIDE.OLD : SIDE.NEW);
  };
  const draw = () => {
    state.graphs = flow.visible(state.changesOnly);
    if (!state.graphs.new.nodes.length && state.graphs.old.nodes.length && !state.touchedSide) state.side = SIDE.OLD;
    state.split = (section.clientWidth || stage.clientWidth || window.innerWidth) >= SPLIT_MIN_WIDTH;
    section.dataset.split = String(state.split);
    changesBtn.setAttribute("aria-pressed", String(state.changesOnly));
    sideBar.hidden = state.split;
    for (const [side, button] of Object.entries(sideButtons)) button.setAttribute("aria-pressed", String(side === state.side));
    const sides = state.split ? [SIDE.OLD, SIDE.NEW] : [state.side];
    stage.replaceChildren();
    state.canvases = {};
    const panes = [];
    for (const side of sides) {
      const pane = el("div", "flow-pane");
      pane.dataset.side = side;
      const made = canvasFor(state.graphs[side], side, { onPick: pick(side), height: CANVAS.MIN, inset });
      pane.append(made.canvas);
      if (state.split) made.canvas.append(el("div", "flow-pane-title", SIDE_LABEL[side]));
      if (made.layout.nodes.length) made.canvas.append(controls(made));
      stage.append(pane);
      state.canvases[side] = made;
      panes.push(made);
    }
    const cap = Math.min(CANVAS.MAX, Math.round(window.innerHeight * CANVAS.VIEWPORT_SHARE));
    const want = Math.max(...panes.map((made) => made.size()));
    stage.style.setProperty("--flow-h", `${Math.max(CANVAS.MIN, Math.min(cap, want))}px`);
    panes.forEach((made) => made.reset());
  };
  changesBtn.addEventListener("click", () => {
    state.changesOnly = !state.changesOnly;
    draw();
  });
  for (const [side, button] of Object.entries(sideButtons)) {
    button.addEventListener("click", () => {
      if (state.side === side) return;
      state.side = side;
      state.touchedSide = true;
      draw();
    });
  }
  let width = 0;
  const observer = new ResizeObserver(() => {
    const next = section.clientWidth;
    if (!next || next === width) return;
    const crossed = width && (width >= SPLIT_MIN_WIDTH) !== (next >= SPLIT_MIN_WIDTH);
    width = next;
    if (!state.graphs || crossed) draw();
  });
  observer.observe(section);
  return section;
}
