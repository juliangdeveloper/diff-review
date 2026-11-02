import { parseText, textHash } from "../outline.js";

const FN_VALUES = new Set(["ArrowFunction", "FunctionExpression"]);
const FN_NODES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunction", "MethodDeclaration"]);
const DEEP_KINDS = new Set(["MethodDeclaration", "ArrowFunction", "FunctionExpression"]);
const FUNCTION_KINDS = new Set(["Function", "Method", "ReactComponent", "Hook"]);
const CALL_NODES = new Set(["CallExpression", "NewExpression"]);
const PROMISE_KINDS = new Set(["then", "catch", "finally"]);
const LOOPS = new Set(["ForStatement", "WhileStatement", "DoStatement"]);
const PY_CALL_HOLDERS = new Set(["ExpressionStatement", "AssignStatement", "UpdateStatement"]);
const PY_SKIP = new Set(["FunctionDefinition", "ClassDefinition", "DecoratedStatement"]);
const JSX_NAMES = new Set(["JSXElement", "JSXSelfClosingTag", "JSXFragmentTag"]);
const REACT_HINTS = Object.freeze(["return <", "React.FC", "JSX.Element"]);
const HOOK_NAME = /^use[A-Z0-9_]/;
const SNIPPET = Object.freeze({ SHORT: 60, MID: 70, LONG: 90 });
const PARAMS_MAX = 80;
const SHORT_ANON_LINES = 2;
const JSX_PREVIEW = 3;
const FLOW = Object.freeze({ TRUE: "true", FALSE: "false", NEXT: "next" });
const EDGE = Object.freeze({ CALLS: "CALLS", DECLARES: "DECLARES", USES_HOOK: "USES_HOOK" });
const ELLIPSIS = "...";
const PY_NOT = "not ";
const PY_DOUBLE_QUOTED = /"([^"\\'\n]*)"/g;
const DECLARATOR_NAMES = new Set(["VariableDefinition", "ArrayPattern", "ObjectPattern"]);
const LANGUAGE = Object.freeze({ JS: "js", PY: "py" });

function kids(node) {
  const out = [];
  for (let item = node?.firstChild; item; item = item.nextSibling) out.push(item);
  return out;
}

function child(node, ...names) {
  return kids(node).find((item) => names.includes(item.name)) || null;
}

function after(node, name) {
  const list = kids(node);
  const index = list.findIndex((item) => item.name === name);
  return index >= 0 ? list.slice(index + 1).find((item) => isStatementNode(item)) || null : null;
}

function isStatementNode(node) {
  return Boolean(node) && (node.name === "Block" || /Statement$|Declaration$/.test(node.name));
}

function squeeze(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function trimTo(text, max) {
  const single = squeeze(text);
  return single.length > max ? `${single.slice(0, max - ELLIPSIS.length)}${ELLIPSIS}` : single;
}

function signatureOf(text) {
  return textHash(String(text ?? "").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "") || "__empty__");
}

function baseName(path) {
  return String(path).split("/").pop().replace(/\.[^.]+$/, "");
}

function snapshot(snap) {
  const nodes = [];
  const edges = [];
  let seq = 0;
  const addNode = (entry) => {
    const node = { id: `${snap}${seq++}`, metadata: {}, ...entry };
    nodes.push(node);
    return node;
  };
  const addEdge = (source, target, kind, metadata = {}) => {
    const edge = { id: `${snap}e${edges.length}`, source, target, kind, metadata };
    edges.push(edge);
    return edge;
  };
  return { nodes, edges, addNode, addEdge };
}

function flowCollector(graph, owner) {
  const counter = new Map();
  const keys = new Set();
  const addFlow = (source, target, flowType) => {
    const key = `${source}:${target}:${flowType}`;
    if (keys.has(key)) return;
    keys.add(key);
    graph.addEdge(source, target, EDGE.CALLS, { flowType });
  };
  const addBranch = (kind, line, endLine, snippet, extra = {}) => {
    const idx = counter.get(kind) ?? 0;
    counter.set(kind, idx + 1);
    const node = graph.addNode({
      kind: "Branch",
      name: `${kind}@${line}`,
      qualifiedName: `${owner.qualifiedName}::${kind}#${idx}`,
      filePath: owner.filePath,
      language: owner.language,
      startLine: line,
      endLine,
      signatureHash: signatureOf(snippet),
      metadata: { branchType: kind, codeSnippet: snippet, ...extra },
    });
    graph.addEdge(owner.id, node.id, EDGE.DECLARES);
    return node;
  };
  const dedupExits = (exits) => {
    const seen = new Set();
    return exits.filter((exit) => {
      const key = `${exit.sourceId}:${exit.flowType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  return { addFlow, addBranch, dedupExits };
}

function knownBoolean(text) {
  let rest = String(text ?? "").replace(/[\s()]/g, "");
  let negate = false;
  while (rest.startsWith("!")) {
    negate = !negate;
    rest = rest.slice(1);
  }
  if (rest !== "true" && rest !== "false") return undefined;
  return (rest === "true") !== negate;
}

function jsFile(file, parsed, graph, symbols, pending) {
  const { src, tree } = parsed;
  const path = file.path;
  const base = baseName(path);
  const language = LANGUAGE.JS;
  const line = (node) => src.line(node.from);
  const endLine = (node) => src.line(Math.max(node.from, node.to - 1));
  const text = (node) => (node ? src.of(node) : "");
  const bodyOf = (fn) => child(fn, "Block");
  const paramsOf = (fn) => {
    const list = child(fn, "ParamList");
    if (!list) return "";
    const full = squeeze(text(list));
    if (full.length <= PARAMS_MAX) return full;
    return `(${kids(list).filter((item) => item.name === "VariableDefinition" || item.name === "Spread").map(text).join(", ")})`;
  };
  const isCallLike = (expr) => {
    if (!expr) return false;
    if (CALL_NODES.has(expr.name)) return true;
    if (expr.name === "AwaitExpression") return CALL_NODES.has(expr.lastChild?.name);
    return false;
  };
  const calleeOf = (expr) => {
    let target = expr;
    if (target?.name === "AwaitExpression") target = target.lastChild;
    if (!target) return null;
    if (target.name === "CallExpression") {
      const base = squeeze(text(target.firstChild)).replace(/\?\./g, ".");
      return (base.split(".").pop() ?? base).replace(/\(.*\)$/, "");
    }
    if (target.name === "NewExpression") {
      const callee = kids(target).find((item) => item.name !== "new");
      const base = squeeze(text(callee)).replace(/\?\./g, ".");
      return base.split(".").pop() ?? base;
    }
    return null;
  };
  const declarators = (decl) => {
    const out = [];
    const list = kids(decl);
    for (let i = 0; i < list.length; i += 1) {
      if (!DECLARATOR_NAMES.has(list[i].name)) continue;
      let j = i + 1;
      if (list[j]?.name === "TypeAnnotation") j += 1;
      const value = list[j]?.name === "Equals" ? list[j + 1] || null : null;
      out.push({ nameNode: list[i], name: text(list[i]), value });
    }
    return out;
  };
  const callLikeOf = (stmt) => {
    if (stmt.name === "ExpressionStatement") return isCallLike(stmt.firstChild) ? stmt.firstChild : null;
    if (stmt.name === "VariableDeclaration") {
      for (const item of declarators(stmt)) if (item.value && isCallLike(item.value)) return item.value;
    }
    return null;
  };
  const callOf = (expr) => (expr?.name === "AwaitExpression" ? expr.lastChild : expr);
  const hookOf = (expr) => {
    const call = callOf(expr);
    if (!call || call.name !== "CallExpression") return null;
    const hookName = calleeOf(call);
    if (!hookName || !HOOK_NAME.test(hookName)) return null;
    const args = kids(child(call, "ArgList")).filter((item) => !["(", ")", ","].includes(item.name));
    const deps = args[1] ? squeeze(text(args[1])) : "";
    return deps ? { hookName, hookDependencies: deps } : { hookName };
  };
  const jsxTags = (node) => {
    const tags = [];
    const seen = new Set();
    node.toTree?.();
    const cursor = node.cursor();
    do {
      if (cursor.name === "JSXOpenTag" || cursor.name === "JSXSelfClosingTag") {
        const nameNode = child(cursor.node, "JSXIdentifier", "JSXBuiltin", "JSXMemberExpression", "JSXNamespacedName");
        const tag = nameNode ? text(nameNode) : "";
        if (tag && !seen.has(tag)) {
          seen.add(tag);
          tags.push(tag);
        }
      }
    } while (cursor.next() && cursor.from < node.to);
    return tags;
  };
  const branchKindOf = (stmt) => {
    const map = {
      IfStatement: "if", SwitchStatement: "switch", ForStatement: "for", WhileStatement: "while", DoStatement: "while",
      ConditionalExpression: "ternary", TryStatement: "try", CatchClause: "catch", ReturnStatement: "return", ThrowStatement: "throw",
    };
    if (map[stmt.name]) return map[stmt.name];
    const callLike = callLikeOf(stmt);
    if (!callLike) return null;
    const callee = calleeOf(callLike);
    if (!callee) return "call";
    return PROMISE_KINDS.has(callee) ? callee : "call";
  };
  const snippetOf = (stmt, kind) => {
    if (kind === "return" && stmt.name === "ReturnStatement") {
      const expr = kids(stmt).find((item) => item.name !== "return" && item.name !== ";");
      if (!expr) return "return (void)";
      const tags = jsxTags(expr);
      if (tags.length) {
        const preview = tags.slice(0, JSX_PREVIEW).map((tag) => `<${tag}>`).join(", ");
        return trimTo(`return JSX ${preview}${tags.length > JSX_PREVIEW ? ", ..." : ""}`, SNIPPET.LONG);
      }
      return trimTo(`return ${text(expr)}`, SNIPPET.SHORT);
    }
    if (kind === "call") {
      const hook = hookOf(callLikeOf(stmt));
      if (hook) {
        const suffix = hook.hookDependencies ? `, ${hook.hookDependencies}` : "";
        if (stmt.name === "VariableDeclaration") {
          const first = declarators(stmt)[0];
          if (first) return trimTo(`${first.name} = ${hook.hookName}(...${suffix})`, SNIPPET.LONG);
        }
        return trimTo(`${hook.hookName}(...${suffix})`, SNIPPET.LONG);
      }
    }
    if (kind === "if" || kind === "elif") {
      const cond = child(stmt, "ParenthesizedExpression");
      return trimTo(`if (${text(cond).replace(/^\(|\)$/g, "")})`, SNIPPET.MID);
    }
    if (kind === "for" || kind === "while") return trimTo(text(stmt).replace(/\s*\{[\s\S]*$/, ""), SNIPPET.MID);
    if (kind === "switch") return trimTo(`switch (${text(child(stmt, "ParenthesizedExpression")).replace(/^\(|\)$/g, "")})`, SNIPPET.SHORT);
    if (kind === "try") return "try";
    if (kind === "catch") {
      const variable = child(stmt, "VariableDefinition");
      return variable ? trimTo(`catch (${text(variable)})`, SNIPPET.SHORT) : "catch";
    }
    if (kind === "finally") return "finally";
    return trimTo(text(stmt), SNIPPET.SHORT);
  };
  const statementsOf = (node) => {
    if (!node) return [];
    if (node.name === "Block") return kids(node).filter(isStatementNode);
    if (FN_NODES.has(node.name)) return node.name === "ArrowFunction" && !bodyOf(node) ? [] : statementsOf(bodyOf(node));
    return [node];
  };
  const switchClauses = (stmt) => {
    const clauses = [];
    for (const item of kids(child(stmt, "SwitchBody"))) {
      if (item.name === "CaseLabel" || item.name === "DefaultLabel") clauses.push([]);
      else if (isStatementNode(item) && clauses.length) clauses[clauses.length - 1].push(item);
    }
    return clauses;
  };
  const collectControlFlow = (root, owner) => {
    const { addFlow, addBranch, dedupExits } = flowCollector(graph, owner);
    const makeBranch = (node, forced) => {
      let kind = forced ?? branchKindOf(node) ?? "unknown";
      if (kind === "if" && node.parent?.name === "IfStatement" && node.prevSibling?.name === "else") kind = "elif";
      const callLike = kind === "call" ? callLikeOf(node) : null;
      const callee = callLike ? calleeOf(callLike) : null;
      const hook = kind === "call" ? hookOf(callLike) : null;
      const extra = {};
      if (callee) extra.callee = callee;
      if (hook?.hookName) extra.hookName = hook.hookName;
      if (hook?.hookDependencies) extra.hookDependencies = hook.hookDependencies;
      return addBranch(kind, line(node), endLine(node), snippetOf(node, kind === "elif" ? "if" : kind), extra);
    };
    const statementFalls = (stmt) => {
      if (stmt.name === "ReturnStatement" || stmt.name === "ThrowStatement") return false;
      if (stmt.name === "IfStatement") {
        const known = knownBoolean(text(child(stmt, "ParenthesizedExpression")));
        const thenFalls = blockFalls(after(stmt, "ParenthesizedExpression"));
        const elseStmt = after(stmt, "else");
        const elseFalls = elseStmt ? blockFalls(elseStmt) : true;
        if (known === true) return thenFalls;
        if (known === false) return elseFalls;
        return thenFalls || elseFalls;
      }
      return true;
    };
    const blockFalls = (block) => {
      let open = true;
      for (const stmt of statementsOf(block)) {
        if (!open) break;
        open = statementFalls(stmt);
      }
      return open;
    };
    const collectList = (statements, fallsThrough) => {
      let entryId = null;
      let pendingExits = [];
      for (const stmt of statements) {
        const result = collectStatement(stmt);
        if (result.entryId) {
          if (!entryId) entryId = result.entryId;
          for (const exit of pendingExits) addFlow(exit.sourceId, result.entryId, exit.flowType);
          pendingExits = result.exits;
        } else if (!result.fallsThrough) {
          pendingExits = [];
        }
      }
      return { entryId, exits: pendingExits, fallsThrough };
    };
    const collectBlock = (block) => collectList(statementsOf(block), blockFalls(block));
    const collectStatement = (stmt) => {
      if (stmt.name === "TryStatement") {
        const tryNode = makeBranch(stmt);
        const tryResult = collectBlock(child(stmt, "Block"));
        if (tryResult.entryId) addFlow(tryNode.id, tryResult.entryId, FLOW.NEXT);
        let exits = [];
        if (tryResult.entryId) exits.push(...tryResult.exits);
        else if (tryResult.fallsThrough) exits.push({ sourceId: tryNode.id, flowType: FLOW.NEXT });
        const clause = child(stmt, "CatchClause");
        if (clause) {
          const catchNode = makeBranch(clause);
          addFlow(tryNode.id, catchNode.id, FLOW.FALSE);
          const catchResult = collectBlock(child(clause, "Block"));
          if (catchResult.entryId) {
            addFlow(catchNode.id, catchResult.entryId, FLOW.NEXT);
            exits.push(...catchResult.exits);
          } else if (catchResult.fallsThrough) {
            exits.push({ sourceId: catchNode.id, flowType: FLOW.NEXT });
          }
        }
        const finallyBlock = child(child(stmt, "FinallyClause"), "Block");
        if (finallyBlock) {
          const finallyNode = makeBranch(finallyBlock, "finally");
          const unique = dedupExits(exits);
          if (unique.length) unique.forEach((exit) => addFlow(exit.sourceId, finallyNode.id, exit.flowType));
          else addFlow(tryNode.id, finallyNode.id, FLOW.NEXT);
          const finalResult = collectBlock(finallyBlock);
          if (finalResult.entryId) {
            addFlow(finallyNode.id, finalResult.entryId, FLOW.NEXT);
            exits = [...finalResult.exits];
          } else if (finalResult.fallsThrough) {
            exits = [{ sourceId: finallyNode.id, flowType: FLOW.NEXT }];
          } else {
            exits = [];
          }
        }
        const deduped = dedupExits(exits);
        return { entryId: tryNode.id, exits: deduped, fallsThrough: deduped.length > 0 };
      }
      const kind = branchKindOf(stmt);
      if (!kind) {
        if (stmt.name === "Block") return collectBlock(stmt);
        return { entryId: null, exits: [], fallsThrough: statementFalls(stmt) };
      }
      const node = makeBranch(stmt);
      if (kind === "return" || kind === "throw") return { entryId: node.id, exits: [], fallsThrough: false };
      if (stmt.name === "IfStatement") {
        const known = knownBoolean(text(child(stmt, "ParenthesizedExpression")));
        const thenReachable = known !== false;
        const elseReachable = known !== true;
        const thenResult = collectBlock(after(stmt, "ParenthesizedExpression"));
        const elseStmt = after(stmt, "else");
        const elseResult = elseStmt ? collectBlock(elseStmt) : { entryId: null, exits: [], fallsThrough: true };
        if (thenResult.entryId && thenReachable) addFlow(node.id, thenResult.entryId, FLOW.TRUE);
        if (elseResult.entryId && elseReachable) addFlow(node.id, elseResult.entryId, FLOW.FALSE);
        if (!elseStmt) {
          if (known === false || thenResult.fallsThrough) return { entryId: node.id, exits: [{ sourceId: node.id, flowType: FLOW.NEXT }], fallsThrough: true };
          return { entryId: node.id, exits: [{ sourceId: node.id, flowType: FLOW.FALSE }], fallsThrough: true };
        }
        const exits = [];
        if (thenReachable) {
          exits.push(...thenResult.exits);
          if (!thenResult.entryId && thenResult.fallsThrough) exits.push({ sourceId: node.id, flowType: FLOW.TRUE });
        }
        if (elseReachable) {
          exits.push(...elseResult.exits);
          if (!elseResult.entryId && elseResult.fallsThrough) exits.push({ sourceId: node.id, flowType: FLOW.FALSE });
        }
        const fallsThrough = (thenReachable && thenResult.fallsThrough) || (elseReachable && elseResult.fallsThrough);
        return { entryId: node.id, exits: dedupExits(exits), fallsThrough };
      }
      if (LOOPS.has(stmt.name)) {
        const body = stmt.name === "DoStatement" ? after(stmt, "do") : kids(stmt).filter(isStatementNode).pop();
        if (body) {
          const bodyResult = collectBlock(body);
          if (bodyResult.entryId) addFlow(node.id, bodyResult.entryId, FLOW.TRUE);
        }
        return { entryId: node.id, exits: [{ sourceId: node.id, flowType: FLOW.NEXT }], fallsThrough: true };
      }
      if (stmt.name === "SwitchStatement") {
        for (const clause of switchClauses(stmt)) {
          const result = collectList(clause, true);
          if (result.entryId) addFlow(node.id, result.entryId, FLOW.TRUE);
        }
      }
      return { entryId: node.id, exits: [{ sourceId: node.id, flowType: FLOW.NEXT }], fallsThrough: true };
    };
    const rootResult = collectBlock(root.name === "Block" ? root : FN_NODES.has(root.name) ? root : root);
    if (rootResult.entryId) addFlow(owner.id, rootResult.entryId, FLOW.NEXT);
  };
  const symbolNode = (kind, name, qualifiedName, node, metadata = {}) => graph.addNode({
    kind, name, qualifiedName, filePath: path, language, startLine: line(node), endLine: endLine(node),
    signatureHash: src.sig(node), metadata,
  });
  const fnMeta = (fn) => ({ params: paramsOf(fn), paramsFull: squeeze(text(child(fn, "ParamList"))) });
  const looksReact = (node) => REACT_HINTS.some((hint) => text(node).includes(hint));
  const topItems = [];
  for (const item of kids(tree.topNode)) {
    if (item.name === "ExportDeclaration") topItems.push(...kids(item));
    else topItems.push(item);
  }
  const fileNodes = [];
  for (const cls of topItems.filter((item) => item.name === "ClassDeclaration")) {
    const id = child(cls, "VariableDefinition");
    const name = id ? text(id) : "AnonymousClass";
    const classNode = symbolNode("Class", name, `${base}.${name}`, cls);
    fileNodes.push(classNode);
    symbols.set(name, classNode.id);
    for (const member of kids(child(cls, "ClassBody")).filter((item) => item.name === "MethodDeclaration" && bodyOf(item))) {
      const prop = child(member, "PropertyDefinition", "PrivatePropertyDefinition", "PropertyName");
      const memberName = prop ? text(prop) : "";
      const memberNode = symbolNode("Method", memberName, `${classNode.qualifiedName}.${memberName}`, member, fnMeta(member));
      fileNodes.push(memberNode);
      symbols.set(memberName, memberNode.id);
      graph.addEdge(classNode.id, memberNode.id, EDGE.DECLARES);
      collectControlFlow(member, memberNode);
    }
  }
  for (const fn of topItems.filter((item) => item.name === "FunctionDeclaration" && bodyOf(item))) {
    const id = child(fn, "VariableDefinition");
    const name = id ? text(id) : "anonymous";
    const kind = looksReact(fn) ? "ReactComponent" : name.startsWith("use") ? "Hook" : "Function";
    const fnNode = symbolNode(kind, name, `${base}.${name}`, fn, fnMeta(fn));
    fileNodes.push(fnNode);
    symbols.set(name, fnNode.id);
    collectControlFlow(fn, fnNode);
  }
  for (const decl of topItems.filter((item) => item.name === "VariableDeclaration")) {
    for (const item of declarators(decl)) {
      if (!item.value || !FN_VALUES.has(item.value.name)) continue;
      const kind = looksReact(decl) ? "ReactComponent" : item.name.startsWith("use") ? "Hook" : "Function";
      const span = { from: item.nameNode.from, to: item.value.to };
      const fnNode = graph.addNode({
        kind, name: item.name, qualifiedName: `${base}.${item.name}`, filePath: path, language,
        startLine: src.line(span.from), endLine: src.line(Math.max(span.from, span.to - 1)),
        signatureHash: src.sig(span), metadata: fnMeta(item.value),
      });
      fileNodes.push(fnNode);
      symbols.set(item.name, fnNode.id);
      collectControlFlow(item.value, fnNode);
    }
  }
  const covered = new Set(fileNodes.filter((node) => FUNCTION_KINDS.has(node.kind)).map((node) => `${node.startLine}:${node.endLine}`));
  const deepName = (node) => {
    const parent = node.parent;
    if (parent?.name === "Property") {
      const prop = child(parent, "PropertyDefinition");
      if (prop) return { name: text(prop), register: true };
    }
    if (parent?.name === "VariableDeclaration") {
      const own = declarators(parent).find((item) => item.value && item.value.from === node.from);
      if (own) return { name: own.name, register: true };
    }
    if (node.name === "MethodDeclaration") {
      const prop = child(node, "PropertyDefinition", "PrivatePropertyDefinition", "PropertyName");
      return { name: prop ? text(prop) : "anonymous", register: true };
    }
    if (parent?.name === "ArgList" && parent.parent?.name === "CallExpression") {
      const call = parent.parent;
      const wrappedBy = calleeOf(call) ?? squeeze(text(call.firstChild));
      const hook = hookOf(call);
      let scope = call.parent;
      while (scope && scope.name !== "VariableDeclaration") scope = scope.parent;
      if (scope?.name === "VariableDeclaration") {
        const owner = declarators(scope).filter((item) => item.nameNode.from < call.from).pop();
        if (owner) return { name: owner.name, wrappedBy, hookDependencies: hook?.hookDependencies, register: true };
      }
      return { name: `${wrappedBy || "callback"}Callback@${line(node)}`, wrappedBy, hookDependencies: hook?.hookDependencies, register: false };
    }
    return { name: "anonymous", register: false };
  };
  const deepNodes = [];
  tree.iterate({
    enter(ref) {
      if (DEEP_KINDS.has(ref.name)) deepNodes.push(ref.node);
    },
  });
  for (const node of deepNodes) {
    const start = line(node);
    const end = endLine(node);
    const key = `${start}:${end}`;
    if (covered.has(key)) continue;
    const resolved = deepName(node);
    if (resolved.name === "anonymous" && end - start < SHORT_ANON_LINES) continue;
    covered.add(key);
    const metadata = { ...fnMeta(node) };
    if (resolved.wrappedBy) metadata.wrappedBy = resolved.wrappedBy;
    if (resolved.hookDependencies) metadata.hookDependencies = resolved.hookDependencies;
    const fnNode = graph.addNode({
      kind: "Function", name: resolved.name, qualifiedName: `${base}.deep.${resolved.name}`, filePath: path, language,
      startLine: start, endLine: end, signatureHash: src.sig(node), metadata,
    });
    if (resolved.register) symbols.set(resolved.name, fnNode.id);
    let parentNode = null;
    for (const existing of graph.nodes) {
      if (existing.id !== fnNode.id && existing.kind !== "Branch" && existing.filePath === path && existing.startLine <= start && existing.endLine >= end) parentNode = existing;
    }
    if (parentNode) {
      graph.addEdge(parentNode.id, fnNode.id, EDGE.DECLARES);
      let ret = node.parent;
      while (ret && ret.name !== "ReturnStatement" && !FN_NODES.has(ret.name)) ret = ret.parent;
      if (ret?.name === "ReturnStatement" && jsxTags(ret).length) {
        const retLine = line(ret);
        const branch = graph.nodes.find((existing) => existing.kind === "Branch" && existing.filePath === path && existing.startLine === retLine
          && existing.metadata.branchType === "return" && graph.edges.some((edge) => edge.kind === EDGE.DECLARES && edge.source === parentNode.id && edge.target === existing.id));
        if (branch) graph.addEdge(branch.id, fnNode.id, EDGE.CALLS, { jsxReturnAttachment: true });
      }
    }
    collectControlFlow(node, fnNode);
  }
  pending.push(() => {
    const callerOf = (node) => {
      let fnDecl = null;
      let varDecl = null;
      for (let scope = node.parent; scope; scope = scope.parent) {
        if (!fnDecl && scope.name === "FunctionDeclaration" && child(scope, "VariableDefinition")) fnDecl = scope;
        if (!varDecl && scope.name === "VariableDeclaration") varDecl = { scope, at: node.from };
      }
      if (fnDecl) return text(child(fnDecl, "VariableDefinition"));
      if (varDecl) return declarators(varDecl.scope).filter((item) => item.nameNode.from < varDecl.at).pop()?.name ?? null;
      return null;
    };
    tree.iterate({
      enter(ref) {
        if (ref.name !== "CallExpression") return;
        const node = ref.node;
        const callee = calleeOf(node) ?? squeeze(text(node.firstChild));
        const caller = callerOf(node);
        if (!caller) return;
        const source = symbols.get(caller);
        const target = symbols.get(callee.replace("()", ""));
        if (!source || !target) return;
        graph.addEdge(source, target, HOOK_NAME.test(callee) ? EDGE.USES_HOOK : EDGE.CALLS);
      },
    });
  });
}

function pyFile(file, parsed, graph, symbols, pending) {
  const { src, tree } = parsed;
  const path = file.path;
  const language = LANGUAGE.PY;
  const line = (node) => src.line(node.from);
  const endLine = (node) => src.line(Math.max(node.from, node.to - 1));
  const text = (node) => (node ? src.of(node) : "");
  const compact = (value) => trimTo(String(value).replace(PY_DOUBLE_QUOTED, "'$1'"), SNIPPET.MID);
  const byQualified = new Map();
  const calls = [];
  const statementsOf = (body) => kids(body).filter((item) => /Statement$|Definition$/.test(item.name));
  const headOf = (list, index, endIndex) => {
    const stop = list.slice(index).find((item, i) => i > 0 && (item.name === "Body" || (endIndex != null && i + index >= endIndex)));
    return squeeze(src.span(list[index].from, stop ? stop.from : list[list.length - 1].to));
  };
  const callIn = (stmt) => {
    if (!PY_CALL_HOLDERS.has(stmt.name)) return null;
    let value = stmt.name === "ExpressionStatement" ? stmt.firstChild : stmt.lastChild;
    if (value?.name === "AwaitExpression") value = value.lastChild;
    return value?.name === "CallExpression" ? value : null;
  };
  const callName = (call) => {
    const callee = call.firstChild;
    if (callee?.name === "VariableName") return text(callee);
    if (callee?.name === "MemberExpression") return text(callee.lastChild);
    return "call";
  };
  const knownTruth = (testText) => {
    let rest = squeeze(testText);
    let negate = false;
    while (rest.startsWith(PY_NOT)) {
      negate = !negate;
      rest = rest.slice(PY_NOT.length).trim();
    }
    rest = rest.replace(/^\((.*)\)$/, "$1").trim();
    let value;
    if (rest === "True") value = true;
    else if (rest === "False" || rest === "None") value = false;
    else return undefined;
    return value !== negate;
  };
  const ifSegments = (stmt) => {
    const list = kids(stmt);
    const segments = [];
    let elseBody = null;
    list.forEach((item, index) => {
      if (item.name === "if" || item.name === "elif") {
        const body = list.slice(index).find((entry) => entry.name === "Body");
        segments.push({ keyword: item, test: squeeze(src.span(item.to, body ? body.from : item.to)), body });
      }
      if (item.name === "else") elseBody = list.slice(index).find((entry) => entry.name === "Body");
    });
    return { segments, elseBody };
  };
  const tryParts = (stmt) => {
    const list = kids(stmt);
    const parts = { body: null, handlers: [], orelse: null, finalbody: null };
    let mode = "";
    for (const item of list) {
      if (["try", "except", "else", "finally"].includes(item.name)) mode = item.name;
      else if (item.name === "Body") {
        if (mode === "try") parts.body = item;
        else if (mode === "except") parts.handlers.push(item);
        else if (mode === "else") parts.orelse = item;
        else if (mode === "finally") parts.finalbody = item;
      }
    }
    return parts;
  };
  const visitScope = (body, scope) => {
    for (const stmt of statementsOf(body)) {
      const target = stmt.name === "DecoratedStatement" ? child(stmt, "FunctionDefinition", "ClassDefinition") : stmt;
      if (!target) continue;
      if (target.name === "ClassDefinition") {
        const name = text(child(target, "VariableName"));
        const classNode = graph.addNode({
          kind: "Class", name, qualifiedName: `${path}:${name}`, filePath: path, language,
          startLine: line(target), endLine: endLine(target), signatureHash: src.sig(target), metadata: {},
        });
        symbols.set(name, classNode.id);
        visitScope(child(target, "Body"), name);
        continue;
      }
      if (target.name === "FunctionDefinition") {
        defineFunction(target, scope);
        continue;
      }
      scanCalls(stmt, scope);
    }
  };
  const scanCalls = (node, scope) => {
    const cursor = node.cursor();
    do {
      if (cursor.from >= node.to) break;
      if (cursor.name === "FunctionDefinition" || cursor.name === "ClassDefinition") {
        if (!cursor.next(false)) break;
        continue;
      }
      if (cursor.name === "CallExpression" && cursor.node.firstChild?.name === "VariableName") {
        calls.push({ caller: scope, callee: text(cursor.node.firstChild) });
      }
    } while (cursor.next());
  };
  const defineFunction = (fn, scope) => {
    const name = text(child(fn, "VariableName"));
    const qualified = scope !== "module" ? `${scope}.${name}` : name;
    const params = squeeze(text(child(fn, "ParamList"))) || "()";
    const fnNode = graph.addNode({
      kind: "Function", name, qualifiedName: `${path}:${qualified}`, filePath: path, language,
      startLine: line(fn), endLine: endLine(fn), signatureHash: src.sig(fn),
      metadata: { params, paramsFull: params },
    });
    symbols.set(name, fnNode.id);
    byQualified.set(qualified, fnNode);
    collectFlow(fnNode, child(fn, "Body"));
    visitScope(child(fn, "Body"), qualified);
  };
  const collectFlow = (owner, body) => {
    const { addFlow, addBranch, dedupExits } = flowCollector(graph, owner);
    const stmtFalls = (stmt) => {
      if (stmt.name === "ReturnStatement" || stmt.name === "RaiseStatement") return false;
      if (stmt.name === "IfStatement") return ifFalls(ifSegments(stmt), 0);
      if (stmt.name === "WithStatement") return blockFalls(child(stmt, "Body"));
      if (stmt.name === "TryStatement") {
        const parts = tryParts(stmt);
        const bodyFalls = blockFalls(parts.body);
        const elseFalls = parts.orelse ? blockFalls(parts.orelse) : true;
        const handlersFall = parts.handlers.length ? parts.handlers.some(blockFalls) : false;
        const pre = (bodyFalls && elseFalls) || handlersFall;
        return parts.finalbody ? blockFalls(parts.finalbody) : pre;
      }
      return true;
    };
    const ifFalls = (info, index) => {
      const thenFalls = blockFalls(info.segments[index].body);
      const hasElse = index + 1 < info.segments.length || info.elseBody;
      const elseFalls = !hasElse ? true : index + 1 < info.segments.length ? ifFalls(info, index + 1) : blockFalls(info.elseBody);
      return thenFalls || elseFalls;
    };
    const blockFalls = (block) => {
      let open = true;
      for (const stmt of statementsOf(block)) {
        if (!open) break;
        open = stmtFalls(stmt);
      }
      return open;
    };
    const collectList = (items, fallsThrough) => {
      let entryId = null;
      let pendingExits = [];
      for (const item of items) {
        const result = item.ifInfo ? collectIf(item.ifInfo, item.index) : collectStmt(item);
        if (result.entryId) {
          if (!entryId) entryId = result.entryId;
          for (const exit of pendingExits) addFlow(exit.sourceId, result.entryId, exit.flowType);
          pendingExits = result.exits;
        } else if (!result.fallsThrough) {
          pendingExits = [];
        }
      }
      return { entryId, exits: pendingExits, fallsThrough };
    };
    const collectBlock = (block) => collectList(statementsOf(block), blockFalls(block));
    const collectIf = (info, index) => {
      const segment = info.segments[index];
      const snippet = compact(`if ${segment.test}:`) || "if ...:";
      const endNode = info.elseBody || info.segments[info.segments.length - 1].body || segment.body;
      const cond = addBranch("if", line(segment.keyword), endLine(endNode), snippet);
      const known = knownTruth(segment.test);
      const thenReachable = known !== false;
      const elseReachable = known !== true;
      const thenResult = collectBlock(segment.body);
      const hasElif = index + 1 < info.segments.length;
      const hasElse = hasElif || Boolean(info.elseBody);
      let elseResult = { entryId: null, exits: [], fallsThrough: true };
      if (hasElif) elseResult = collectList([{ ifInfo: info, index: index + 1 }], ifFalls(info, index + 1));
      else if (info.elseBody) elseResult = collectBlock(info.elseBody);
      if (thenResult.entryId && thenReachable) addFlow(cond.id, thenResult.entryId, FLOW.TRUE);
      if (elseResult.entryId && elseReachable) addFlow(cond.id, elseResult.entryId, FLOW.FALSE);
      let exits = [];
      if (thenReachable) exits.push(...thenResult.exits);
      if (elseReachable) exits.push(...elseResult.exits);
      if (!thenResult.entryId && thenResult.fallsThrough && thenReachable) exits.push({ sourceId: cond.id, flowType: FLOW.TRUE });
      if (!elseResult.entryId && elseResult.fallsThrough && elseReachable) {
        if (!hasElse && thenReachable && thenResult.fallsThrough) exits.push({ sourceId: cond.id, flowType: FLOW.NEXT });
        else exits.push({ sourceId: cond.id, flowType: FLOW.FALSE });
      }
      if (!hasElse) {
        exits = [{ sourceId: cond.id, flowType: thenResult.fallsThrough ? FLOW.NEXT : FLOW.FALSE }];
        return { entryId: cond.id, exits, fallsThrough: true };
      }
      return { entryId: cond.id, exits: dedupExits(exits), fallsThrough: (thenReachable && thenResult.fallsThrough) || (elseReachable && elseResult.fallsThrough) };
    };
    const collectStmt = (stmt) => {
      if (PY_SKIP.has(stmt.name)) return { entryId: null, exits: [], fallsThrough: true };
      const list = kids(stmt);
      if (stmt.name === "IfStatement") return collectIf(ifSegments(stmt), 0);
      if (stmt.name === "ReturnStatement") {
        const node = addBranch("return", line(stmt), endLine(stmt), compact(text(stmt)) || "return ...");
        return { entryId: node.id, exits: [], fallsThrough: false };
      }
      if (stmt.name === "RaiseStatement") {
        const node = addBranch("raise", line(stmt), endLine(stmt), compact(text(stmt)) || "raise ...");
        return { entryId: node.id, exits: [], fallsThrough: false };
      }
      const call = callIn(stmt);
      if (call) {
        const callee = callName(call);
        const node = addBranch("call", line(stmt), endLine(stmt), compact(text(stmt)) || `${callee}(...)`, { callee });
        return { entryId: node.id, exits: [{ sourceId: node.id, flowType: FLOW.NEXT }], fallsThrough: true };
      }
      if (stmt.name === "ForStatement" || stmt.name === "WhileStatement") {
        const kind = stmt.name === "ForStatement" ? "for" : "while";
        const index = list.findIndex((item) => item.name === kind);
        const node = addBranch(kind, line(stmt), endLine(stmt), compact(`${headOf(list, Math.max(0, index))}:`));
        const bodies = list.filter((item) => item.name === "Body");
        const bodyResult = collectBlock(bodies[0]);
        if (bodyResult.entryId) addFlow(node.id, bodyResult.entryId, FLOW.TRUE);
        if (bodies[1]) {
          const elseResult = collectBlock(bodies[1]);
          if (elseResult.entryId) addFlow(node.id, elseResult.entryId, FLOW.NEXT);
        }
        return { entryId: node.id, exits: [{ sourceId: node.id, flowType: FLOW.NEXT }], fallsThrough: true };
      }
      if (stmt.name === "TryStatement") {
        const parts = tryParts(stmt);
        const node = addBranch("try", line(stmt), endLine(stmt), "try:");
        const bodyResult = collectBlock(parts.body);
        if (bodyResult.entryId) addFlow(node.id, bodyResult.entryId, FLOW.NEXT);
        let normalExits = [...bodyResult.exits];
        if (!bodyResult.entryId && bodyResult.fallsThrough) normalExits.push({ sourceId: node.id, flowType: FLOW.NEXT });
        const handlerExits = [];
        for (const handler of parts.handlers) {
          const result = collectBlock(handler);
          if (result.entryId) {
            addFlow(node.id, result.entryId, FLOW.NEXT);
            handlerExits.push(...result.exits);
          } else if (result.fallsThrough) {
            handlerExits.push({ sourceId: node.id, flowType: FLOW.NEXT });
          }
        }
        if (parts.orelse) {
          const result = collectBlock(parts.orelse);
          if (result.entryId) {
            dedupExits(normalExits).forEach((exit) => addFlow(exit.sourceId, result.entryId, exit.flowType));
            normalExits = [...result.exits];
          } else if (!result.fallsThrough) {
            normalExits = [];
          }
        }
        let exits = [...normalExits, ...handlerExits];
        if (parts.finalbody) {
          const result = collectBlock(parts.finalbody);
          if (result.entryId) {
            const unique = dedupExits(exits);
            if (unique.length) unique.forEach((exit) => addFlow(exit.sourceId, result.entryId, exit.flowType));
            else addFlow(node.id, result.entryId, FLOW.NEXT);
            exits = [...result.exits];
          } else if (!result.fallsThrough) {
            exits = [];
          }
        }
        const deduped = dedupExits(exits);
        return { entryId: node.id, exits: deduped, fallsThrough: deduped.length > 0 };
      }
      if (stmt.name === "WithStatement") {
        const node = addBranch("with", line(stmt), endLine(stmt), compact(`${headOf(list, 0)}:`));
        const result = collectBlock(child(stmt, "Body"));
        if (result.entryId) {
          addFlow(node.id, result.entryId, FLOW.NEXT);
          return { entryId: node.id, exits: dedupExits(result.exits), fallsThrough: result.fallsThrough };
        }
        if (result.fallsThrough) return { entryId: node.id, exits: [{ sourceId: node.id, flowType: FLOW.NEXT }], fallsThrough: true };
        return { entryId: node.id, exits: [], fallsThrough: false };
      }
      return { entryId: null, exits: [], fallsThrough: stmtFalls(stmt) };
    };
    const result = collectBlock(body);
    if (result.entryId) addFlow(owner.id, result.entryId, FLOW.NEXT);
  };
  visitScope(tree.topNode, "module");
  const local = new Map([...byQualified.values()].map((node) => [node.name, node.id]));
  pending.push(() => {
    for (const call of calls) {
      const callerName = call.caller.split(".").pop() ?? "";
      const source = local.get(callerName) ?? symbols.get(callerName);
      const target = symbols.get(call.callee);
      if (source && target) graph.addEdge(source, target, EDGE.CALLS);
    }
  });
}

export async function analyzeSnapshot(files, snap) {
  const graph = snapshot(snap);
  const symbols = new Map();
  const pending = [];
  for (const file of files) {
    if (file.text == null) continue;
    const parsed = await parseText(file.text, file.parsePath || file.path);
    if (!parsed) continue;
    if (parsed.lang === LANGUAGE.PY) pyFile(file, parsed, graph, symbols, pending);
    else jsFile(file, parsed, graph, symbols, pending);
  }
  pending.forEach((run) => run());
  return { nodes: graph.nodes, edges: graph.edges };
}
