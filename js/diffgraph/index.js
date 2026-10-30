import { NODE, NODE_KIND, NODE_STATUS } from "../config.js";
import { analyzeSnapshot } from "./analyze.js";
import { buildGraphDelta } from "./delta.js";
import { buildLogicView } from "./logic.js";
import { filteredNew, filteredOld, visibleGraph, diffStats } from "./visible.js";

const DECIMAL = 10;
const SNAP = Object.freeze({ OLD: "o", NEW: "n" });
const EXTRA = "x";
const OWNER_BADGE = Object.freeze({ [NODE_KIND.CLASS]: "Class", [NODE_KIND.FUNCTION]: "Fn", [NODE_KIND.METHOD]: "Method", [NODE_KIND.MODULE]: "Module" });
const ROW_BRANCH = Object.freeze({ throw: "raise", catch: "catch", try: "try", with: "with", call: "call" });

function nearest(shown, line) {
  if (!shown?.length || !line) return line;
  return shown.find((value) => value >= line) ?? shown[shown.length - 1];
}

function fileLeaf(path, status, name, line, id) {
  return { id, label: `${path.split("/").pop()}\n${name}`, kind: "Branch", branchType: "file", diffStatus: status, filePath: path, startLine: line, endLine: line };
}

function rowsToView(path, rows, prefix) {
  const oldSide = { nodes: [], edges: [] };
  const newSide = { nodes: [], edges: [] };
  const byId = new Map();
  for (const row of rows) {
    const id = String(row[NODE.ID] || "").trim();
    if (!id || byId.has(id)) continue;
    byId.set(id, row);
  }
  const ownerKinds = new Set(Object.keys(OWNER_BADGE));
  const made = new Map();
  for (const [id, row] of byId) {
    const kind = String(row[NODE.KIND] || "").trim();
    const status = String(row[NODE.STATUS] || "").trim() || NODE_STATUS.UNCHANGED;
    const name = String(row[NODE.NAME] || "").trim();
    const line = Number.parseInt(row[NODE.LINE], DECIMAL) || 0;
    const parent = String(row[NODE.PARENT] || "").trim();
    const parentId = parent && parent !== id && byId.has(parent) ? `${prefix}${parent}` : undefined;
    const base = { id: `${prefix}${id}`, diffStatus: status, filePath: path, startLine: line, endLine: line, parentId };
    let node;
    if (kind === NODE_KIND.FILE) node = { ...fileLeaf(path, status, name, line, base.id), parentId };
    else if (ownerKinds.has(kind)) {
      const detail = String(row[NODE.DETAIL] || "").trim();
      node = { ...base, kind: "group", label: `[${OWNER_BADGE[kind]}] ${name}`, fileName: path.split("/").pop(), functionParams: detail };
    } else {
      const branchType = ROW_BRANCH[kind] ?? kind;
      node = { ...base, kind: "Branch", branchType, label: `${branchType}@${line}\n${name}` };
    }
    made.set(id, node);
    if (status !== NODE_STATUS.ADDED) oldSide.nodes.push(node);
    if (status !== NODE_STATUS.REMOVED) newSide.nodes.push(node);
  }
  for (const side of [oldSide, newSide]) {
    const ids = new Set(side.nodes.map((node) => node.id));
    for (const node of side.nodes) if (node.parentId && !ids.has(node.parentId)) node.parentId = undefined;
    const siblings = new Map();
    for (const node of side.nodes) {
      if (node.kind === "group" || !node.parentId) continue;
      if (!siblings.has(node.parentId)) siblings.set(node.parentId, []);
      siblings.get(node.parentId).push(node);
    }
    for (const list of siblings.values()) {
      list.sort((a, b) => a.startLine - b.startLine);
      for (let i = 1; i < list.length; i += 1) {
        side.edges.push({ id: `${list[i - 1].id}>${list[i].id}`, source: list[i - 1].id, target: list[i].id, relation: "flow", flowType: "next", diffStatus: NODE_STATUS.UNCHANGED });
      }
    }
  }
  return { oldSide, newSide };
}

function fileStatus(file) {
  const row = file.rows?.find((item) => item[NODE.KIND] === NODE_KIND.FILE);
  if (row?.[NODE.STATUS]) return row[NODE.STATUS];
  if (file.sides?.old == null && file.sides?.new != null) return NODE_STATUS.ADDED;
  if (file.sides?.new == null && file.sides?.old != null) return NODE_STATUS.REMOVED;
  return NODE_STATUS.MODIFIED;
}

function listName(file) {
  return file.rows?.find((row) => row[NODE.KIND] === NODE_KIND.FILE)?.[NODE.NAME] || file.info?.fallback || "";
}

export async function buildFlow(analysis, agentRows, SOURCE) {
  const agent = agentRows || [];
  const agentPaths = new Set(agent.map((row) => row[NODE.PATH]));
  const oldFiles = [];
  const newFiles = [];
  const extras = [];
  const flowPaths = new Map();
  let partial = false;
  const seen = new Set();
  for (const file of analysis?.files || []) {
    seen.add(file.path);
    const sides = file.sides;
    const useAgent = file.flowSource !== SOURCE.FULL && agentPaths.has(file.path);
    if (useAgent) {
      extras.push({ path: file.path, rows: agent.filter((row) => row[NODE.PATH] === file.path) });
      partial = partial || file.source !== SOURCE.FULL;
      continue;
    }
    partial = partial || file.partial;
    if (sides && (sides.old != null || sides.new != null)) {
      if (sides.old != null) oldFiles.push({ path: file.path, parsePath: sides.oldPath, text: sides.old });
      if (sides.new != null) newFiles.push({ path: file.path, text: sides.new });
      flowPaths.set(file.path, file);
      continue;
    }
    extras.push({ path: file.path, leaf: file });
  }
  for (const path of new Set(agent.map((row) => row[NODE.PATH]))) {
    if (path && !seen.has(path)) extras.push({ path, rows: agent.filter((row) => row[NODE.PATH] === path) });
  }
  const oldGraph = await analyzeSnapshot(oldFiles, SNAP.OLD);
  const newGraph = await analyzeSnapshot(newFiles, SNAP.NEW);
  const delta = buildGraphDelta(oldGraph, newGraph);
  const view = buildLogicView(delta);
  const all = { old: filteredOld(view.oldGraph), new: filteredNew(view.newGraph) };
  for (const [path, file] of flowPaths) {
    const touched = [...all.old.nodes, ...all.new.nodes].some((node) => node.filePath === path && node.diffStatus !== NODE_STATUS.UNCHANGED);
    if (touched) continue;
    extras.push({ path, leaf: file });
  }
  let count = 0;
  for (const extra of extras) {
    const prefix = `${EXTRA}${count++}:`;
    if (extra.leaf) {
      const status = fileStatus(extra.leaf);
      const line = Number.parseInt(extra.leaf.rows?.find((row) => row[NODE.KIND] === NODE_KIND.FILE)?.[NODE.LINE], DECIMAL) || 0;
      const node = fileLeaf(extra.path, status, listName(extra.leaf), line, `${prefix}file`);
      if (status !== NODE_STATUS.ADDED) all.old.nodes.push(node);
      if (status !== NODE_STATUS.REMOVED) all.new.nodes.push(node);
      continue;
    }
    const { oldSide, newSide } = rowsToView(extra.path, extra.rows, prefix);
    all.old.nodes.push(...oldSide.nodes);
    all.old.edges.push(...oldSide.edges);
    all.new.nodes.push(...newSide.nodes);
    all.new.edges.push(...newSide.edges);
  }
  const shownOf = (path, side) => flowPaths.get(path)?.sides?.[side === "old" ? "oldShown" : "newShown"] || null;
  return {
    partial,
    oldAll: all.old,
    newAll: all.new,
    visible: (changesOnly) => ({
      old: visibleGraph(all.old, all.new, changesOnly),
      new: visibleGraph(all.new, all.old, changesOnly),
    }),
    stats: diffStats(all.old, all.new),
    lineOf: (node, side) => nearest(shownOf(node.filePath, side), node.startLine || 0),
  };
}
