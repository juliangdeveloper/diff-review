import dagre from "../vendor/dagre/dagre.js";

export const STATUS_COLOR = Object.freeze({ added: "#15803d", removed: "#b91c1c", modified: "#ca8a04", unchanged: "#334155" });
export const STATUS_TEXT = Object.freeze({ added: "#f0fdf4", removed: "#fef2f2", modified: "#1c1917", unchanged: "#f8fafc" });
const RETURN_COLOR = Object.freeze({
  added: Object.freeze({ bg: "#86efac", text: "#14532d" }),
  unchanged: Object.freeze({ bg: "#6d28d9", text: "#f5f3ff" }),
  modified: Object.freeze({ bg: "#a78bfa", text: "#1e1b4b" }),
});
const DECISION_KINDS = new Set(["if", "elif", "switch", "ternary"]);
const PILL_KINDS = new Set(["return", "raise", "for", "while"]);
export const SHAPE = Object.freeze({ DIAMOND: "diamond", PILL: "pill", PROCESS: "process", GROUP: "group" });
export const LEAF_W = 220;
export const LEAF_H = 64;
const DIAMOND_SIZE = 220;
const PAD_X = 45;
const PAD_TOP = 72;
const PARAM_PAD = 34;
const PAD_BOTTOM = 45;
const DEPS_PAD = 34;
export const LAYOUT_MARGIN = 40;
const INNER = Object.freeze({ rankdir: "TB", nodesep: 120, ranksep: 130, marginx: LAYOUT_MARGIN, marginy: LAYOUT_MARGIN });
const OUTER = Object.freeze({ rankdir: "LR", nodesep: 60, ranksep: 100, marginx: LAYOUT_MARGIN, marginy: LAYOUT_MARGIN });
export const EDGE_STYLE = Object.freeze({
  added: "#4ade80", removed: "#f87171", invoke: "#f59e0b", true: "#22c55e", false: "#f87171", next: "#94a3b8",
});
const DASH = Object.freeze({ invoke: "6 4", next: "3 6", false: "8 5" });
const LABEL_FILL = Object.freeze({ false: "#fecaca", true: "#bbf7d0", other: "#f8fafc" });
const EDGE_LABEL = Object.freeze({ invoke: "calls", next: "next", true: "T", false: "F" });
const HANDLE = Object.freeze({ true: "right", false: "bottom", next: "left" });
const INVOKE_WIDTH = 2.5;
const FLOW_WIDTH = 1.5;

const hasParams = (node) => {
  const params = String(node.functionParams ?? "").trim();
  return params.length > 0 && params !== "()";
};

const hasDeps = (node) => {
  const deps = String(node.hookDependencies ?? "").trim();
  if (!deps) return false;
  if (deps === "[]") return true;
  const body = deps.startsWith("[") && deps.endsWith("]") ? deps.slice(1, -1).trim() : deps;
  return body.length > 0;
};

const topPad = (node) => PAD_TOP + (hasParams(node) ? PARAM_PAD : 0);
const bottomPad = (node) => PAD_BOTTOM + (hasDeps(node) ? DEPS_PAD : 0);

export const shapeOf = (node) => {
  if (node.kind === "group") return SHAPE.GROUP;
  if (DECISION_KINDS.has(node.branchType ?? "")) return SHAPE.DIAMOND;
  if (PILL_KINDS.has(node.branchType ?? "")) return SHAPE.PILL;
  return SHAPE.PROCESS;
};

function colorsOf(node) {
  const bg = STATUS_COLOR[node.diffStatus] ?? STATUS_COLOR.unchanged;
  const text = STATUS_TEXT[node.diffStatus] ?? STATUS_TEXT.unchanged;
  if (node.branchType === "return" && RETURN_COLOR[node.diffStatus]) return RETURN_COLOR[node.diffStatus];
  return { bg, text };
}

export function computeLogicLayout(graph) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const groups = graph.nodes.filter((node) => node.kind === "group");
  const leaves = graph.nodes.filter((node) => node.kind !== "group");
  const children = new Map(groups.map((group) => [group.id, []]));
  for (const leaf of leaves) if (leaf.parentId && children.has(leaf.parentId)) children.get(leaf.parentId).push(leaf);
  for (const group of groups) if (group.parentId && children.has(group.parentId)) children.get(group.parentId).push(group);
  const empty = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      if (empty.has(group.id)) continue;
      const kids = children.get(group.id) ?? [];
      const hasLeaf = kids.some((kid) => kid.kind !== "group");
      const hasSub = kids.some((kid) => kid.kind === "group" && !empty.has(kid.id));
      if (!hasLeaf && !hasSub && group.diffStatus === "unchanged") {
        empty.add(group.id);
        changed = true;
      }
    }
  }
  const local = new Map();
  const size = new Map();
  const depth = new Map();
  const depthOf = (id) => {
    if (depth.has(id)) return depth.get(id);
    const node = byId.get(id);
    const value = !node?.parentId || empty.has(node.parentId) || !byId.has(node.parentId) ? 0 : depthOf(node.parentId) + 1;
    depth.set(id, value);
    return value;
  };
  const ordered = groups.filter((group) => !empty.has(group.id));
  ordered.forEach((group) => depthOf(group.id));
  ordered.sort((a, b) => depth.get(b.id) - depth.get(a.id));
  const dims = (node) => {
    if (node.kind === "group") return size.get(node.id) ?? { w: LEAF_W, h: LEAF_H };
    if (shapeOf(node) === SHAPE.DIAMOND) return { w: DIAMOND_SIZE, h: DIAMOND_SIZE };
    return { w: LEAF_W, h: LEAF_H };
  };
  for (const group of ordered) {
    const kids = (children.get(group.id) ?? []).filter((kid) => !empty.has(kid.id));
    const top = topPad(group);
    const bottom = bottomPad(group);
    if (!kids.length) {
      if (group.diffStatus === "unchanged") empty.add(group.id);
      else size.set(group.id, { w: LEAF_W + PAD_X * 2, h: LEAF_H + top + bottom });
      continue;
    }
    const inner = new dagre.graphlib.Graph();
    inner.setDefaultEdgeLabel(() => ({}));
    inner.setGraph({ ...INNER });
    for (const kid of kids) {
      const { w, h } = dims(kid);
      inner.setNode(kid.id, { width: w, height: h });
    }
    const ids = new Set(kids.map((kid) => kid.id));
    for (const edge of graph.edges) if (ids.has(edge.source) && ids.has(edge.target)) inner.setEdge(edge.source, edge.target);
    dagre.layout(inner);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const kid of kids) {
      const point = inner.node(kid.id);
      const { w, h } = dims(kid);
      const x = point.x - w / 2;
      const y = point.y - h / 2;
      local.set(kid.id, { x, y });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }
    for (const kid of kids) {
      const point = local.get(kid.id);
      local.set(kid.id, { x: point.x - minX + PAD_X, y: point.y - minY + top });
    }
    size.set(group.id, { w: maxX - minX + PAD_X * 2, h: maxY - minY + top + bottom });
  }
  const isTop = (node) => !empty.has(node.id) && (!node.parentId || empty.has(node.parentId) || !byId.has(node.parentId));
  const tops = graph.nodes.filter(isTop);
  const outer = new dagre.graphlib.Graph();
  outer.setDefaultEdgeLabel(() => ({}));
  outer.setGraph({ ...OUTER });
  for (const node of tops) {
    const fallback = node.kind === "group" ? { w: LEAF_W, h: LEAF_H + topPad(node) + bottomPad(node) } : dims(node);
    const { w, h } = size.get(node.id) ?? fallback;
    outer.setNode(node.id, { width: w, height: h });
  }
  const topIds = new Set(tops.map((node) => node.id));
  for (const edge of graph.edges) if (topIds.has(edge.source) && topIds.has(edge.target)) outer.setEdge(edge.source, edge.target);
  dagre.layout(outer);
  const absolute = new Map();
  for (const node of tops) {
    const point = outer.node(node.id);
    const { w, h } = size.get(node.id) ?? dims(node);
    absolute.set(node.id, { x: (point?.x ?? 0) - w / 2, y: (point?.y ?? 0) - h / 2 });
  }
  const place = (id) => {
    if (absolute.has(id)) return absolute.get(id);
    const node = byId.get(id);
    const parent = place(node.parentId);
    const offset = local.get(id) ?? { x: 0, y: 0 };
    const point = { x: parent.x + offset.x, y: parent.y + offset.y };
    absolute.set(id, point);
    return point;
  };
  const nodes = [];
  for (const node of graph.nodes) {
    if (empty.has(node.id)) continue;
    const { x, y } = place(node.id);
    const { w, h } = node.kind === "group" ? size.get(node.id) ?? { w: LEAF_W, h: LEAF_H + topPad(node) + bottomPad(node) } : dims(node);
    nodes.push({ ...node, shape: shapeOf(node), x, y, w, h, colors: colorsOf(node), depth: depthOf(node.id), paramsRow: node.kind === "group" && hasParams(node), depsRow: node.kind === "group" && hasDeps(node) });
  }
  nodes.sort((a, b) => (a.kind === "group" ? 0 : 1) - (b.kind === "group" ? 0 : 1) || a.depth - b.depth);
  const visible = new Map(nodes.map((node) => [node.id, node]));
  const edges = graph.edges
    .filter((edge) => {
      if (!visible.has(edge.source) || !visible.has(edge.target)) return false;
      if (edge.relation === "hierarchy") return false;
      if (visible.get(edge.source).kind === "group" || visible.get(edge.target).kind === "group") return edge.relation === "invoke";
      return true;
    })
    .map((edge) => {
      const invoke = edge.relation === "invoke";
      const flowType = edge.relation === "flow" ? edge.flowType : undefined;
      const source = visible.get(edge.source);
      const stroke = edge.diffStatus === "added" ? EDGE_STYLE.added
        : edge.diffStatus === "removed" ? EDGE_STYLE.removed
          : invoke ? EDGE_STYLE.invoke : EDGE_STYLE[flowType] ?? EDGE_STYLE.next;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        stroke,
        width: invoke ? INVOKE_WIDTH : FLOW_WIDTH,
        dash: invoke ? DASH.invoke : DASH[flowType] ?? "",
        label: invoke ? EDGE_LABEL.invoke : EDGE_LABEL[flowType] ?? "",
        labelFill: LABEL_FILL[flowType] ?? LABEL_FILL.other,
        animated: edge.diffStatus === "added" || edge.diffStatus === "removed",
        handle: source.shape === SHAPE.DIAMOND ? HANDLE[flowType] ?? "bottom" : "bottom",
      };
    });
  let width = 0;
  let height = 0;
  for (const node of nodes) {
    width = Math.max(width, node.x + node.w);
    height = Math.max(height, node.y + node.h);
  }
  return { nodes, edges, width: width + OUTER.marginx, height: height + OUTER.marginy };
}
