import { RELATION } from "./logic.js";
import { STATUS } from "./delta.js";

const normalizePath = (value) => String(value).replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");

const identity = (label) => {
  const bare = String(label).replace(/^\[[^\]]+\]\s*/, "").trim();
  const paren = bare.indexOf("(");
  return (paren >= 0 ? bare.slice(0, paren) : bare).trim().toLowerCase();
};

const viewKey = (node) => `${node.kind}:${normalizePath(node.filePath)}:${(node.className ?? "").trim().toLowerCase()}:${identity(node.label)}`;

const filterTo = (graph, ids) => ({
  nodes: graph.nodes.filter((node) => ids.has(node.id)),
  edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
});

function ancestors(graph, seeds) {
  const keep = new Set(seeds);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const id of [...seeds]) {
    let current = byId.get(id);
    while (current?.parentId) {
      if (keep.has(current.parentId)) break;
      keep.add(current.parentId);
      current = byId.get(current.parentId);
    }
  }
  return keep;
}

function neighbours(graph, seeds, relation) {
  const keep = new Set(seeds);
  for (const edge of graph.edges) {
    if (edge.relation !== relation) continue;
    if (keep.has(edge.source) || keep.has(edge.target)) {
      keep.add(edge.source);
      keep.add(edge.target);
    }
  }
  return keep;
}

function descendants(graph, seeds) {
  const keep = new Set(seeds);
  const children = new Map();
  for (const node of graph.nodes) {
    if (!node.parentId) continue;
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    children.get(node.parentId).push(node.id);
  }
  const queue = [...seeds];
  while (queue.length) {
    for (const id of children.get(queue.shift()) ?? []) {
      if (keep.has(id)) continue;
      keep.add(id);
      queue.push(id);
    }
  }
  return keep;
}

function expand(graph, seeds) {
  const groups = new Set(graph.nodes.filter((node) => seeds.has(node.id) && node.kind === "group").map((node) => node.id));
  let keep = new Set([...seeds, ...descendants(graph, groups)]);
  keep = ancestors(graph, keep);
  keep = neighbours(graph, keep, RELATION.FLOW);
  keep = neighbours(graph, keep, RELATION.INVOKE);
  return ancestors(graph, keep);
}

export function filteredOld(graph) {
  return filterTo(graph, new Set(graph.nodes.filter((node) => node.diffStatus !== STATUS.ADDED).map((node) => node.id)));
}

export function filteredNew(graph) {
  return filterTo(graph, new Set(graph.nodes.filter((node) => node.diffStatus !== STATUS.REMOVED).map((node) => node.id)));
}

export function visibleGraph(base, counterpart, changesOnly) {
  if (!changesOnly) return base;
  const changed = base.nodes.filter((node) => node.diffStatus !== STATUS.UNCHANGED).map((node) => node.id);
  const otherKeys = new Set(counterpart.nodes.filter((node) => node.diffStatus === STATUS.MODIFIED).map(viewKey));
  const matching = base.nodes.filter((node) => otherKeys.has(viewKey(node))).map((node) => node.id);
  return filterTo(base, expand(base, ancestors(base, new Set([...changed, ...matching]))));
}

export function diffStats(oldGraph, newGraph) {
  const all = [...oldGraph.nodes, ...newGraph.nodes];
  return {
    added: all.filter((node) => node.diffStatus === STATUS.ADDED).length,
    removed: all.filter((node) => node.diffStatus === STATUS.REMOVED).length,
    modified: new Set(all.filter((node) => node.diffStatus === STATUS.MODIFIED).map((node) => node.label)).size,
  };
}
