import { STATUS } from "./delta.js";

const FUNCTION_KINDS = new Set(["Function", "Method", "ReactComponent", "Hook"]);
const LOGIC_KINDS = new Set([...FUNCTION_KINDS, "Branch"]);
const LOGIC_EDGES = new Set(["CALLS", "DECLARES"]);
const FLOW_TYPES = new Set(["true", "false", "next"]);
const BADGE = Object.freeze({ ReactComponent: "Component", Hook: "Hook", Function: "Fn", Method: "Method" });
const RELATION = Object.freeze({ FLOW: "flow", INVOKE: "invoke", HIERARCHY: "hierarchy" });
const PY = "py";

const fileName = (path) => String(path).replaceAll("\\", "/").split("/").pop();

const symbolName = (value) => String(value).replace(/\(\)$/g, "").replace(/\?\./g, ".").split(".").pop().trim();

function parentMapOf(graph) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const parents = new Map();
  for (const edge of graph.edges) {
    if (edge.kind !== "DECLARES") continue;
    const parent = byId.get(edge.source);
    if (parent) parents.set(edge.target, parent);
  }
  return parents;
}

function viewGraph(graph, parents, nodeStatus, edgeStatus) {
  const logicNodes = graph.nodes.filter((node) => LOGIC_KINDS.has(node.kind));
  const classNodes = graph.nodes.filter((node) => node.kind === "Class");
  const logicIds = new Set(logicNodes.map((node) => node.id));
  const functionIds = new Set(logicNodes.filter((node) => FUNCTION_KINDS.has(node.kind)).map((node) => node.id));
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const classByName = new Map(classNodes.map((node) => [`${node.filePath}:${node.name}`, node]));
  const status = (id) => nodeStatus.get(id) ?? STATUS.UNCHANGED;
  const owningClass = (node) => {
    for (let current = parents.get(node.id); current; current = parents.get(current.id)) if (current.kind === "Class") return current;
    if (node.language !== PY) return undefined;
    const colon = node.qualifiedName.indexOf(":");
    const path = colon >= 0 ? node.qualifiedName.slice(colon + 1) : node.qualifiedName;
    const dot = path.lastIndexOf(".");
    if (dot <= 0) return undefined;
    const found = classByName.get(`${node.filePath}:${path.slice(0, dot)}`);
    if (!found) return undefined;
    const start = node.startLine ?? Number.MAX_SAFE_INTEGER;
    if (start < (found.startLine ?? 0) || start > (found.endLine ?? Number.MAX_SAFE_INTEGER)) return undefined;
    return found;
  };
  const classesWithChildren = new Set();
  const functionParent = new Map();
  for (const node of logicNodes) {
    if (!FUNCTION_KINDS.has(node.kind)) continue;
    const parent = parents.get(node.id);
    if (parent && FUNCTION_KINDS.has(parent.kind) && logicIds.has(parent.id)) {
      functionParent.set(node.id, parent.id);
      continue;
    }
    const owner = owningClass(node);
    if (owner) {
      functionParent.set(node.id, owner.id);
      classesWithChildren.add(owner.id);
      continue;
    }
    functionParent.set(node.id, undefined);
  }
  const classParent = (node) => {
    for (let current = parents.get(node.id); current; current = parents.get(current.id)) {
      if (current.kind === "Class" && classesWithChildren.has(current.id)) return current.id;
    }
    return undefined;
  };
  const nodes = [];
  for (const node of classNodes) {
    if (!classesWithChildren.has(node.id)) continue;
    nodes.push({
      id: node.id, label: `[Class] ${node.name}`, kind: "group", diffStatus: status(node.id), filePath: node.filePath,
      fileName: fileName(node.filePath), className: node.name, startLine: node.startLine, endLine: node.endLine, parentId: classParent(node),
    });
  }
  for (const node of logicNodes) {
    if (!FUNCTION_KINDS.has(node.kind)) continue;
    const wrappedBy = node.metadata?.wrappedBy ?? "";
    const deps = node.metadata?.hookDependencies ?? "";
    const suffix = wrappedBy ? ` [${wrappedBy}${deps ? ` deps: ${deps}` : ""}]` : "";
    nodes.push({
      id: node.id, label: `[${BADGE[node.kind] ?? node.kind}] ${node.name}${suffix}`, kind: "group", diffStatus: status(node.id),
      filePath: node.filePath, fileName: fileName(node.filePath), className: owningClass(node)?.name, startLine: node.startLine, endLine: node.endLine,
      parentId: functionParent.get(node.id), functionParams: node.metadata?.paramsFull ?? node.metadata?.params, hookDependencies: deps,
    });
  }
  for (const node of logicNodes) {
    if (node.kind !== "Branch") continue;
    const owner = parents.get(node.id);
    const snippet = node.metadata?.codeSnippet ?? "";
    nodes.push({
      id: node.id, label: snippet ? `${node.name}\n${snippet}` : node.name, kind: "Branch", diffStatus: status(node.id),
      filePath: node.filePath, startLine: node.startLine, endLine: node.endLine,
      parentId: owner && logicIds.has(owner.id) ? owner.id : undefined, branchType: node.metadata?.branchType ?? "",
    });
  }
  const viewIds = new Set(nodes.map((node) => node.id));
  const ownerFunction = (id) => {
    for (let current = parents.get(id); current; current = parents.get(current.id)) if (functionIds.has(current.id)) return current.id;
    return undefined;
  };
  const callBranches = new Map();
  for (const node of logicNodes) {
    if (node.kind !== "Branch" || node.metadata?.branchType !== "call") continue;
    const owner = ownerFunction(node.id);
    if (!owner) continue;
    if (!callBranches.has(owner)) callBranches.set(owner, []);
    callBranches.get(owner).push(node);
  }
  const functionsByName = new Map();
  for (const node of logicNodes.filter((item) => FUNCTION_KINDS.has(item.kind))) {
    const key = symbolName(node.name);
    if (!functionsByName.has(key)) functionsByName.set(key, []);
    functionsByName.get(key).push(node);
  }
  const isFnToFn = (edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    return Boolean(source && target && FUNCTION_KINDS.has(source.kind) && FUNCTION_KINDS.has(target.kind));
  };
  const invokeEdges = graph.edges.filter((edge) => edge.kind === "CALLS" && isFnToFn(edge));
  const edges = graph.edges
    .filter((edge) => LOGIC_EDGES.has(edge.kind) && viewIds.has(edge.source) && viewIds.has(edge.target))
    .filter((edge) => edge.kind !== "CALLS" || !isFnToFn(edge))
    .map((edge) => {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      const invoke = edge.kind === "CALLS" && source?.kind === "Branch" && Boolean(target && FUNCTION_KINDS.has(target.kind));
      const relation = edge.kind === "DECLARES" ? RELATION.HIERARCHY : invoke ? RELATION.INVOKE : RELATION.FLOW;
      const flowType = FLOW_TYPES.has(edge.metadata?.flowType) ? edge.metadata.flowType : undefined;
      return { id: edge.id, source: edge.source, target: edge.target, kind: edge.kind, relation, flowType, diffStatus: edgeStatus.get(edge.id) ?? STATUS.UNCHANGED };
    });
  for (const edge of invokeEdges) {
    const target = byId.get(edge.target);
    if (!target) continue;
    const name = symbolName(target.name);
    const branch = (callBranches.get(edge.source) ?? []).find((item) => item.metadata?.callee && symbolName(item.metadata.callee) === name);
    const source = branch?.id ?? edge.source;
    if (!viewIds.has(source) || !viewIds.has(edge.target)) continue;
    edges.push({ id: `${edge.id}:i:${source}:${edge.target}`, source, target: edge.target, kind: edge.kind, relation: RELATION.INVOKE, diffStatus: edgeStatus.get(edge.id) ?? STATUS.UNCHANGED });
  }
  const invokeKeys = new Set(edges.filter((edge) => edge.relation === RELATION.INVOKE).map((edge) => `${edge.source}->${edge.target}`));
  for (const branches of callBranches.values()) {
    for (const branch of branches) {
      const callee = branch.metadata?.callee ?? "";
      if (!callee) continue;
      const candidates = functionsByName.get(symbolName(callee)) ?? [];
      if (!candidates.length) continue;
      const sameFile = candidates.filter((fn) => fn.filePath === branch.filePath);
      const chosen = sameFile.length ? sameFile : candidates.length === 1 ? candidates : [];
      for (const target of chosen) {
        if (!viewIds.has(branch.id) || !viewIds.has(target.id)) continue;
        const key = `${branch.id}->${target.id}`;
        if (invokeKeys.has(key)) continue;
        invokeKeys.add(key);
        edges.push({ id: `f:${branch.id}:${target.id}`, source: branch.id, target: target.id, kind: "CALLS", relation: RELATION.INVOKE, diffStatus: status(branch.id) });
      }
    }
  }
  return { nodes, edges };
}

export function buildLogicView(delta) {
  return {
    oldGraph: viewGraph(delta.oldGraph, parentMapOf(delta.oldGraph), delta.nodeStatus, delta.edgeStatus),
    newGraph: viewGraph(delta.newGraph, parentMapOf(delta.newGraph), delta.nodeStatus, delta.edgeStatus),
  };
}

export { RELATION };
