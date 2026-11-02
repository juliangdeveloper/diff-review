const STATUS = Object.freeze({ ADDED: "added", REMOVED: "removed", MODIFIED: "modified", UNCHANGED: "unchanged" });
const DEEP_SUFFIX = /@\d+$/;
const MISSING_SIGNATURE = "__missing_signature__";

const branchOwner = (qualifiedName) => qualifiedName.replace(/::[^:]+#\d+$/, "");

const normalizeDeep = (qualifiedName) => (qualifiedName.includes(".deep.") ? qualifiedName.replace(DEEP_SUFFIX, "") : qualifiedName);

const nodeKey = (node) => {
  if (node.kind === "Branch") {
    const branchType = node.metadata?.branchType ?? "";
    const sig = node.signatureHash ?? String(node.metadata?.codeSnippet ?? "").replace(/\s+/g, "");
    return `Branch:${normalizeDeep(branchOwner(node.qualifiedName))}:${branchType}:${sig}`;
  }
  const qualified = node.kind === "Function" ? normalizeDeep(node.qualifiedName) : node.qualifiedName;
  return `${qualified}:${node.kind}`;
};

const edgeKey = (edge) => `${edge.kind}:${edge.source}:${edge.target}:${edge.metadata?.flowType ?? ""}`;

export const sortForMatch = (nodes) => [...nodes].sort((a, b) =>
  (a.startLine ?? Number.MAX_SAFE_INTEGER) - (b.startLine ?? Number.MAX_SAFE_INTEGER)
  || (a.endLine ?? Number.MAX_SAFE_INTEGER) - (b.endLine ?? Number.MAX_SAFE_INTEGER)
  || a.id.localeCompare(b.id));

const signatureKey = (node) => node.signatureHash ?? MISSING_SIGNATURE;

const groupBy = (nodes, keyOf) => {
  const grouped = new Map();
  for (const node of nodes) {
    const key = keyOf(node);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(node);
  }
  return grouped;
};

export function buildGraphDelta(oldGraph, newGraph) {
  const nodeStatus = new Map();
  const edgeStatus = new Map();
  const oldByKey = groupBy(oldGraph.nodes, nodeKey);
  const newByKey = groupBy(newGraph.nodes, nodeKey);
  for (const key of new Set([...oldByKey.keys(), ...newByKey.keys()])) {
    const oldNodes = sortForMatch(oldByKey.get(key) ?? []);
    const newNodes = sortForMatch(newByKey.get(key) ?? []);
    if (!oldNodes.length) {
      newNodes.forEach((node) => nodeStatus.set(node.id, STATUS.ADDED));
      continue;
    }
    if (!newNodes.length) {
      oldNodes.forEach((node) => nodeStatus.set(node.id, STATUS.REMOVED));
      continue;
    }
    const matchedOld = new Set();
    const matchedNew = new Set();
    const newBySignature = groupBy(newNodes, signatureKey);
    for (const oldNode of oldNodes) {
      const bucket = newBySignature.get(signatureKey(oldNode));
      if (!bucket?.length) continue;
      const same = bucket.findIndex((item) => (item.startLine ?? -1) === (oldNode.startLine ?? -1) && (item.endLine ?? -1) === (oldNode.endLine ?? -1));
      const match = same >= 0 ? bucket.splice(same, 1)[0] : bucket.shift();
      matchedOld.add(oldNode.id);
      matchedNew.add(match.id);
      nodeStatus.set(oldNode.id, STATUS.UNCHANGED);
      nodeStatus.set(match.id, STATUS.UNCHANGED);
    }
    const unmatchedOld = oldNodes.filter((node) => !matchedOld.has(node.id));
    const unmatchedNew = newNodes.filter((node) => !matchedNew.has(node.id));
    const pairs = Math.min(unmatchedOld.length, unmatchedNew.length);
    for (let i = 0; i < pairs; i += 1) {
      nodeStatus.set(unmatchedOld[i].id, STATUS.MODIFIED);
      nodeStatus.set(unmatchedNew[i].id, STATUS.MODIFIED);
    }
    unmatchedOld.slice(pairs).forEach((node) => nodeStatus.set(node.id, STATUS.REMOVED));
    unmatchedNew.slice(pairs).forEach((node) => nodeStatus.set(node.id, STATUS.ADDED));
  }
  const oldEdges = new Map(oldGraph.edges.map((edge) => [edgeKey(edge), edge]));
  const newEdges = new Map(newGraph.edges.map((edge) => [edgeKey(edge), edge]));
  for (const [key, oldEdge] of oldEdges) {
    const newEdge = newEdges.get(key);
    if (!newEdge) {
      edgeStatus.set(oldEdge.id, STATUS.REMOVED);
      continue;
    }
    edgeStatus.set(oldEdge.id, STATUS.UNCHANGED);
    edgeStatus.set(newEdge.id, STATUS.UNCHANGED);
  }
  for (const edge of newGraph.edges) if (!oldEdges.has(edgeKey(edge))) edgeStatus.set(edge.id, STATUS.ADDED);
  return { oldGraph, newGraph, nodeStatus, edgeStatus };
}

export { STATUS };
