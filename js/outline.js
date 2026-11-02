import { CHANGE, LABEL, NODE, NODE_KIND, NODE_STATUS } from "./config.js";
import { LINE, parsePatch } from "./diff.js";
import { diffTexts } from "./linediff.js";

const KIND = Object.freeze({ ...NODE_KIND, BRANCH: "branch", CALL: "call" });
const OWNER_KINDS = new Set(Object.values(NODE_KIND));
const TOP_KINDS = new Set([NODE_KIND.FUNCTION, NODE_KIND.CLASS]);
const LANG = Object.freeze({ JS: "js", PY: "py" });
const EXTENSIONS = Object.freeze({
  ".js": ["js", "jsx"], ".mjs": ["js", "jsx"], ".cjs": ["js", "jsx"], ".jsx": ["js", "jsx"],
  ".ts": ["js", "ts"], ".mts": ["js", "ts"], ".cts": ["js", "ts"], ".tsx": ["js", "ts jsx"],
  ".gs": ["js", "jsx"],
  ".py": ["py", ""],
});
const LOADERS = Object.freeze({
  [LANG.JS]: () => import("./vendor/lezer/javascript.js"),
  [LANG.PY]: () => import("./vendor/lezer/python.js"),
});
const JS_RESOLVE = Object.freeze([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
const JS_SWAP = Object.freeze({ ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] });
const COMMENTS = new Set(["LineComment", "BlockComment", "Comment"]);
const FN_VALUES = new Set(["ArrowFunction", "FunctionExpression"]);
const MODULE_NAME = "(módulo)";
const DEFAULT_NAME = "default";
const SNIPPET_MAX = 80;
const NAME_MAX = 160;
const LABEL_NAMES = 2;
const QUOTES = /^['"`]|['"`]$/g;
const HUNK_HEAD = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;
export const SOURCE = Object.freeze({ FULL: "full", AGENT: "agent", PATCH: "patch", LIST: "list" });
const LIST_TEXT = Object.freeze({
  BINARY: "binario",
  RENAMED: "solo renombrado",
  SAME: "sin cambios de texto",
  MISSING: "contenido incompleto",
});
const LIST_ID = "f1";
const CHANGE_STATUS = Object.freeze({ [CHANGE.ADDED]: NODE_STATUS.ADDED, [CHANGE.DELETED]: NODE_STATUS.REMOVED });
const VERBS = Object.freeze([
  [NODE_STATUS.ADDED, "Agrega"],
  [NODE_STATUS.MODIFIED, "Cambia"],
  [NODE_STATUS.REMOVED, "Quita"],
]);

const parsers = new Map();

function extensionOf(path) {
  const match = /\.[^./]+$/.exec(String(path || ""));
  return match ? match[0].toLowerCase() : "";
}

export function languageOf(path) {
  return EXTENSIONS[extensionOf(path)]?.[0] || "";
}

async function parserFor(path) {
  const [lang, dialect] = EXTENSIONS[extensionOf(path)] || [];
  if (!lang) return null;
  const key = `${lang}:${dialect}`;
  if (!parsers.has(key)) {
    parsers.set(key, LOADERS[lang]().then((mod) => (dialect ? mod.parser.configure({ dialect }) : mod.parser)));
  }
  return { lang, parser: await parsers.get(key) };
}

function compact(text, max = SNIPPET_MAX) {
  const single = String(text ?? "").replace(/\s+/g, " ").trim();
  return single.length <= max ? single : `${single.slice(0, max - 1)}…`;
}

export function textHash(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

function kids(node) {
  const out = [];
  for (let child = node?.firstChild; child; child = child.nextSibling) out.push(child);
  return out;
}

function child(node, ...names) {
  return kids(node).find((item) => names.includes(item.name)) || null;
}

function source(text, tree) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  const chars = text.split("");
  tree.iterate({
    enter(node) {
      if (!COMMENTS.has(node.name)) return;
      for (let i = node.from; i < node.to; i += 1) chars[i] = " ";
      return false;
    },
  });
  const clean = chars.join("");
  return {
    text,
    of: (node) => text.slice(node.from, node.to),
    span: (from, to) => text.slice(from, to),
    sig: (node) => textHash(clean.slice(node.from, node.to).replace(/\s+/g, "")),
    line(pos) {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= pos) lo = mid;
        else hi = mid - 1;
      }
      return lo + 1;
    },
  };
}

function collector(src) {
  const nodes = [];
  let seq = 0;
  let moduleNode = null;
  const add = (entry) => {
    const node = { id: `n${seq++}`, detail: "", ...entry };
    nodes.push(node);
    return node;
  };
  const moduleOwner = () => {
    if (!moduleNode) moduleNode = add({ kind: KIND.MODULE, name: MODULE_NAME, qual: MODULE_NAME, owner: null, line: 1, sig: "" });
    return moduleNode;
  };
  const qualify = (owner, name) => (owner && owner.kind !== KIND.MODULE ? `${owner.qual}.${name}` : name);
  const owned = (owner, kind, name, node, params) => add({
    kind, name, qual: qualify(owner, name), owner: owner ? owner.id : null, line: src.line(node.from), sig: src.sig(node),
    detail: params ? compact(src.of(params), NAME_MAX) : "",
  });
  const branch = (owner, type, node, head, detail = "") => add({
    kind: type === KIND.CALL ? KIND.CALL : KIND.BRANCH, type, name: head, owner: owner.id, line: src.line(node.from), sig: src.sig(node), detail,
  });
  return { nodes, moduleOwner, owned, branch };
}

function calleeName(src, call) {
  let callee = call.name === "NewExpression" ? kids(call).find((item) => item.name !== "new") : call.firstChild;
  if (callee && callee.name === "InstantiationExpression") callee = callee.firstChild;
  if (!callee) return "";
  const text = compact(src.of(callee).replace(/\?\./g, "."), NAME_MAX);
  return text.split(".").pop() || text;
}

function unwrap(expr) {
  let current = expr;
  while (current) {
    if (current.name === "AssignmentExpression" || current.name === "AssignStatement") current = current.lastChild;
    else if (current.name === "AwaitExpression") current = current.lastChild;
    else if (current.name === "ParenthesizedExpression") current = kids(current)[1] || null;
    else break;
  }
  return current;
}

function analyzeJs(src, tree) {
  const { nodes, moduleOwner, owned, branch } = collector(src);
  const isFn = (node) => node && FN_VALUES.has(node.name);
  const bodyOf = (fn) => child(fn, "Block");
  const kindIn = (owner) => (owner && owner.kind === KIND.CLASS ? KIND.METHOD : KIND.FUNCTION);
  const headTo = (node, body) => compact(src.span(node.from, body ? body.from : node.to));
  const initializers = (decl) => {
    const out = [];
    const list = kids(decl);
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].name !== "VariableDefinition") continue;
      const eq = list[i + 1];
      const value = eq && eq.name === "Equals" ? list[i + 2] : list[i + 1]?.name === "TypeAnnotation" && list[i + 2]?.name === "Equals" ? list[i + 3] : null;
      out.push({ name: src.of(list[i]), value: value || null });
    }
    return out;
  };
  const callIn = (node) => {
    let expr = null;
    if (node.name === "ExpressionStatement") expr = node.firstChild;
    else if (node.name === "VariableDeclaration") expr = initializers(node).map((item) => item.value).find((value) => value && !isFn(value)) || null;
    expr = unwrap(expr);
    if (expr && (expr.name === "CallExpression" || expr.name === "NewExpression")) return calleeName(src, expr);
    return "";
  };
  const visitBody = (fn, owner) => {
    const body = bodyOf(fn);
    if (body) kids(body).forEach((item) => visit(item, owner));
    else kids(fn).forEach((item) => visitExpr(item, owner));
  };
  const fnNode = (owner, kind, name, node, fn) => {
    const entry = owned(owner, kind, name, node, child(fn, "ParamList"));
    visitBody(fn, entry);
  };
  const visit = (node, owner) => {
    const name = node.name;
    if (name === "ExportDeclaration") {
      const value = kids(node).find((item) => isFn(item) || item.name === "ClassExpression");
      if (child(node, "default") && value && isFn(value)) return fnNode(owner, KIND.FUNCTION, DEFAULT_NAME, node, value);
      return kids(node).forEach((item) => visit(item, owner));
    }
    if (name === "FunctionDeclaration") {
      if (!bodyOf(node)) return;
      const id = child(node, "VariableDefinition");
      return fnNode(owner, kindIn(owner), id ? src.of(id) : DEFAULT_NAME, node, node);
    }
    if (name === "ClassDeclaration" || name === "ClassExpression") {
      const id = child(node, "VariableDefinition");
      const cls = owned(owner, KIND.CLASS, id ? src.of(id) : DEFAULT_NAME, node, null);
      kids(child(node, "ClassBody")).forEach((item) => visit(item, cls));
      return;
    }
    if (name === "MethodDeclaration") {
      if (!bodyOf(node)) return;
      const prop = child(node, "PropertyDefinition", "PrivatePropertyDefinition", "PropertyName");
      const prefix = child(node, "get") ? "get " : child(node, "set") ? "set " : "";
      return fnNode(owner, KIND.METHOD, prefix + (prop ? src.of(prop) : ""), node, node);
    }
    if (name === "PropertyDeclaration" || name === "Property") {
      const prop = child(node, "PropertyDefinition", "PrivatePropertyDefinition");
      const value = kids(node).find(isFn);
      if (prop && value) return fnNode(owner, kindIn(owner), src.of(prop), node, value);
      if (prop && child(node, "ParamList") && bodyOf(node)) return fnNode(owner, kindIn(owner), src.of(prop), node, node);
      return kids(node).forEach((item) => visitExpr(item, owner));
    }
    if (name === "VariableDeclaration") {
      const fns = initializers(node).filter((item) => isFn(item.value));
      if (fns.length) {
        fns.forEach((item) => fnNode(owner, KIND.FUNCTION, item.name, node, item.value));
        return;
      }
    }
    statement(node, owner);
  };
  const visitAll = (node, owner) => kids(node).forEach((item) => (isStatement(item) ? visit(item, owner) : visitExpr(item, owner)));
  const isStatement = (node) => node.name === "Block" || /Statement$|Declaration$/.test(node.name);
  const statement = (node, owner) => {
    const here = owner || moduleOwner();
    const active = here.kind !== KIND.CLASS;
    const name = node.name;
    if (active && name === "IfStatement") {
      branch(here, "if", node, `if ${compact(src.of(child(node, "ParenthesizedExpression") || node))}`);
      return visitAll(node, owner);
    }
    if (active && name === "SwitchStatement") {
      branch(here, "switch", node, `switch ${compact(src.of(child(node, "ParenthesizedExpression") || node))}`);
      return visitAll(child(node, "SwitchBody") || node, owner);
    }
    if (active && name === "ForStatement") {
      branch(here, "for", node, headTo(node, node.lastChild));
      return visitAll(node, owner);
    }
    if (active && name === "WhileStatement") {
      branch(here, "while", node, headTo(node, node.lastChild));
      return visitAll(node, owner);
    }
    if (active && name === "DoStatement") {
      branch(here, "while", node, `do … while ${compact(src.of(child(node, "ParenthesizedExpression") || node))}`);
      return visitAll(node, owner);
    }
    if (active && name === "TryStatement") {
      branch(here, "try", node, "try");
      for (const item of kids(node)) {
        if (item.name === "CatchClause") {
          const block = child(item, "Block");
          branch(here, "catch", item, compact(src.span(item.from, block ? block.from : item.to)));
          if (block) visit(block, owner);
        } else if (item.name === "FinallyClause") {
          visitAll(item, owner);
        } else if (item.name === "Block") visit(item, owner);
      }
      return;
    }
    if (active && name === "ReturnStatement") {
      branch(here, "return", node, compact(src.of(node)));
      return kids(node).forEach((item) => visitExpr(item, owner));
    }
    if (active && name === "ThrowStatement") {
      branch(here, "throw", node, compact(src.of(node)));
      return;
    }
    if (name === "Block" || name === "LabeledStatement") return visitAll(node, owner);
    const callee = active ? callIn(node) : "";
    if (callee) branch(here, KIND.CALL, node, compact(src.of(node)), callee);
    kids(node).forEach((item) => visitExpr(item, owner));
  };
  const visitExpr = (node, owner) => {
    const name = node.name;
    if (name === "ClassExpression" || name === "ClassDeclaration" || name === "FunctionDeclaration" || name === "Property" || name === "MethodDeclaration") return visit(node, owner);
    if (isFn(node)) {
      const body = bodyOf(node);
      if (body) return kids(body).forEach((item) => visit(item, owner));
    }
    kids(node).forEach((item) => visitExpr(item, owner));
  };
  kids(tree.topNode).forEach((item) => visit(item, null));
  const imports = [];
  const calls = new Set();
  tree.iterate({
    enter(ref) {
      const node = ref.node;
      if (node.name === "ImportDeclaration" || node.name === "ExportDeclaration" || node.name === "DynamicImport") {
        const spec = child(node, "String");
        if (spec && (node.name !== "ExportDeclaration" || child(node, "from"))) imports.push({ spec: src.of(spec).replace(QUOTES, "") });
      }
      if (node.name === "CallExpression") {
        const callee = calleeName(src, node);
        if (callee === "require") {
          const spec = child(child(node, "ArgList"), "String");
          if (spec) imports.push({ spec: src.of(spec).replace(QUOTES, "") });
        } else if (callee) calls.add(callee);
      }
      if (node.name === "NewExpression") calls.add(calleeName(src, node));
    },
  });
  return { nodes, imports, calls };
}

function analyzePy(src, tree) {
  const { nodes, moduleOwner, owned, branch } = collector(src);
  const callIn = (node) => {
    let expr = node.name === "ExpressionStatement" ? node.firstChild : node.name === "AssignStatement" || node.name === "UpdateStatement" ? node.lastChild : null;
    expr = unwrap(expr);
    return expr && expr.name === "CallExpression" ? calleeName(src, expr) : "";
  };
  const visitBody = (body, owner) => kids(body).forEach((item) => visit(item, owner));
  const visit = (node, owner) => {
    const name = node.name;
    if (name === "DecoratedStatement") return kids(node).forEach((item) => visit(item, owner));
    if (name === "FunctionDefinition") {
      const id = child(node, "VariableName");
      const fn = owned(owner, owner && owner.kind === KIND.CLASS ? KIND.METHOD : KIND.FUNCTION, id ? src.of(id) : "", node, child(node, "ParamList"));
      return visitBody(child(node, "Body"), fn);
    }
    if (name === "ClassDefinition") {
      const id = child(node, "VariableName");
      const cls = owned(owner, KIND.CLASS, id ? src.of(id) : "", node, null);
      return visitBody(child(node, "Body"), cls);
    }
    statement(node, owner);
  };
  const statement = (node, owner) => {
    const here = owner || moduleOwner();
    const active = here.kind !== KIND.CLASS;
    const name = node.name;
    const list = kids(node);
    const headAt = (index) => {
      const body = list.slice(index).find((item) => item.name === "Body" || item.name === "MatchBody");
      return compact(src.span(list[index].from, body ? body.from : node.to));
    };
    const bodies = () => list.forEach((item) => {
      if (item.name === "Body") visitBody(item, owner);
      if (item.name === "MatchBody") kids(item).forEach((clause) => visitBody(child(clause, "Body"), owner));
    });
    if (active && name === "IfStatement") {
      list.forEach((item, index) => {
        if (item.name === "if" || item.name === "elif") branch(here, "if", index ? item : node, headAt(index));
      });
      return bodies();
    }
    const simple = { ForStatement: "for", WhileStatement: "while", WithStatement: "with", MatchStatement: "switch" }[name];
    if (active && simple) {
      branch(here, simple, node, headAt(0));
      return bodies();
    }
    if (active && name === "TryStatement") {
      branch(here, "try", node, "try");
      list.forEach((item, index) => {
        if (item.name === "except") branch(here, "catch", item, headAt(index));
      });
      return bodies();
    }
    if (active && name === "ReturnStatement") return void branch(here, "return", node, compact(src.of(node)));
    if (active && name === "RaiseStatement") return void branch(here, "throw", node, compact(src.of(node)));
    if (name === "Body") return visitBody(node, owner);
    if (list.some((item) => item.name === "Body")) return bodies();
    const callee = active ? callIn(node) : "";
    if (callee) branch(here, KIND.CALL, node, compact(src.of(node)), callee);
  };
  kids(tree.topNode).forEach((item) => visit(item, null));
  const imports = [];
  const calls = new Set();
  tree.iterate({
    enter(ref) {
      const node = ref.node;
      if (node.name === "CallExpression") {
        const callee = calleeName(src, node);
        if (callee) calls.add(callee);
      }
      if (node.name !== "ImportStatement") return;
      const list = kids(node);
      if (list[0]?.name === "from") {
        let i = 1;
        let dots = 0;
        while (list[i] && list[i].name === ".") {
          dots += 1;
          i += 1;
        }
        const parts = [];
        while (list[i] && list[i].name !== "import") {
          if (list[i].name === "VariableName") parts.push(src.of(list[i]));
          i += 1;
        }
        const names = [];
        for (i += 1; i < list.length; i += 1) {
          if (list[i].name === "VariableName" && list[i - 1]?.name !== "as") names.push(src.of(list[i]));
        }
        imports.push({ dots, module: parts.join("."), names });
      } else {
        let parts = [];
        let skip = false;
        for (const item of list.slice(1)) {
          if (item.name === "as") skip = true;
          else if (item.name === ",") {
            if (parts.length) imports.push({ dots: 0, module: parts.join("."), names: [] });
            parts = [];
            skip = false;
          } else if (item.name === "VariableName" && !skip) parts.push(src.of(item));
        }
        if (parts.length) imports.push({ dots: 0, module: parts.join("."), names: [] });
      }
    },
  });
  return { nodes, imports, calls };
}

export async function parseText(text, path) {
  if (text == null) return null;
  const found = await parserFor(path);
  if (!found) return null;
  const tree = found.parser.parse(text);
  return { lang: found.lang, tree, src: source(text, tree) };
}

export async function analyzeSource(text, path) {
  const parsed = await parseText(text, path);
  if (!parsed) return { nodes: [], imports: [], calls: new Set() };
  return parsed.lang === LANG.PY ? analyzePy(parsed.src, parsed.tree) : analyzeJs(parsed.src, parsed.tree);
}

function prepare(nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    if (OWNER_KINDS.has(node.kind)) node.key = `${node.qual}:${node.kind}`;
    else node.key = `${node.kind}:${byId.get(node.owner)?.qual ?? ""}:${node.type}:${node.kind === KIND.CALL ? node.detail : ""}`;
  }
}

function groupByKey(nodes) {
  const groups = new Map();
  for (const node of nodes) {
    if (!groups.has(node.key)) groups.set(node.key, []);
    groups.get(node.key).push(node);
  }
  return groups;
}

function byLine(a, b) {
  return a.line - b.line || a.id.localeCompare(b.id, "en", { numeric: true });
}

export function delta(oldNodes, newNodes) {
  prepare(oldNodes);
  prepare(newNodes);
  const oldGroups = groupByKey(oldNodes);
  const newGroups = groupByKey(newNodes);
  const pairs = [];
  for (const key of new Set([...oldGroups.keys(), ...newGroups.keys()])) {
    const olds = (oldGroups.get(key) || []).slice().sort(byLine);
    const news = (newGroups.get(key) || []).slice().sort(byLine);
    const left = new Set(news);
    const matched = new Set();
    for (const before of olds) {
      const same = news.filter((node) => left.has(node) && node.sig === before.sig);
      if (!same.length) continue;
      const pick = same.find((node) => node.line === before.line) || same[0];
      left.delete(pick);
      matched.add(before);
      pairs.push({ before, after: pick, status: NODE_STATUS.UNCHANGED });
    }
    const restOld = olds.filter((node) => !matched.has(node));
    const restNew = news.filter((node) => left.has(node));
    const count = Math.min(restOld.length, restNew.length);
    for (let i = 0; i < count; i += 1) pairs.push({ before: restOld[i], after: restNew[i], status: NODE_STATUS.MODIFIED });
    restOld.slice(count).forEach((before) => pairs.push({ before, after: null, status: NODE_STATUS.REMOVED }));
    restNew.slice(count).forEach((after) => pairs.push({ before: null, after, status: NODE_STATUS.ADDED }));
  }
  return pairs;
}

function rowsFrom(sha, path, pairs) {
  const entityOf = new Map();
  pairs.forEach((pair, index) => {
    pair.index = index;
    if (pair.before) entityOf.set(`o:${pair.before.id}`, pair);
    if (pair.after) entityOf.set(`n:${pair.after.id}`, pair);
  });
  for (const pair of pairs) {
    const node = pair.after || pair.before;
    pair.node = node;
    pair.parent = node.owner ? entityOf.get(`${pair.after ? "n" : "o"}:${node.owner}`) || null : null;
  }
  const keep = new Set();
  for (const pair of pairs) {
    if (pair.status === NODE_STATUS.UNCHANGED) continue;
    for (let current = pair; current && !keep.has(current); current = current.parent) keep.add(current);
  }
  const children = new Map();
  for (const pair of pairs) {
    if (!keep.has(pair)) continue;
    const parentKey = pair.parent ? pair.parent.index : -1;
    if (!children.has(parentKey)) children.set(parentKey, []);
    children.get(parentKey).push(pair);
  }
  const ordered = [];
  const walk = (key) => {
    for (const pair of (children.get(key) || []).sort((a, b) => a.node.line - b.node.line || a.index - b.index)) {
      ordered.push(pair);
      walk(pair.index);
    }
  };
  walk(-1);
  const ids = new Map(ordered.map((pair, index) => [pair, `s${index + 1}`]));
  return ordered.map((pair) => ({
    [NODE.SHA]: sha,
    [NODE.PATH]: path,
    [NODE.ID]: ids.get(pair),
    [NODE.PARENT]: pair.parent ? ids.get(pair.parent) || "" : "",
    [NODE.KIND]: pair.node.kind === KIND.BRANCH ? pair.node.type : pair.node.kind,
    [NODE.NAME]: compact(pair.node.name, NAME_MAX),
    [NODE.STATUS]: pair.status,
    [NODE.LINE]: String(pair.node.line || ""),
    [NODE.DETAIL]: compact(pair.node.detail || "", NAME_MAX),
  }));
}

function topChanges(pairs) {
  const out = [];
  for (const pair of pairs) {
    const node = pair.after || pair.before;
    if (pair.status === NODE_STATUS.UNCHANGED || !TOP_KINDS.has(node.kind) || pair.parent) continue;
    out.push({ name: node.name, status: pair.status });
  }
  return out;
}

function topDefs(nodes) {
  const ids = new Set(nodes.filter((node) => node.kind === KIND.MODULE).map((node) => node.id));
  return new Set(nodes.filter((node) => TOP_KINDS.has(node.kind) && (!node.owner || ids.has(node.owner))).map((node) => node.name));
}

function labelFor(changes) {
  const parts = [];
  for (const [status, verb] of VERBS) {
    const names = [...new Set(changes.filter((item) => item.status === status).map((item) => item.name))];
    if (!names.length) continue;
    const extra = names.length > LABEL_NAMES ? ` +${names.length - LABEL_NAMES}` : "";
    parts.push(`${verb} ${names.slice(0, LABEL_NAMES).join(", ")}${extra}`);
  }
  return parts.join(" · ");
}

function normalize(parts) {
  const out = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function dirOf(path) {
  const parts = String(path).split("/");
  parts.pop();
  return parts;
}

function jsCandidates(from, spec) {
  if (!spec.startsWith(".")) return [];
  const base = normalize([...dirOf(from), ...spec.split("/")]);
  const ext = extensionOf(base);
  const out = [base];
  for (const swap of JS_SWAP[ext] || []) out.push(base.slice(0, -ext.length) + swap);
  for (const add of JS_RESOLVE) out.push(base + add, `${base}/index${add}`);
  return out;
}

function pyCandidates(from, item) {
  const modules = [];
  const tail = item.module ? item.module.split(".") : [];
  if (item.dots) {
    const dir = dirOf(from);
    for (let i = 1; i < item.dots; i += 1) dir.pop();
    modules.push([...dir, ...tail]);
    item.names.forEach((name) => modules.push([...dir, ...tail, name]));
  } else {
    modules.push(tail);
    item.names.forEach((name) => modules.push([...tail, name]));
  }
  return { exact: Boolean(item.dots), paths: modules.filter((parts) => parts.length).flatMap((parts) => [`${normalize(parts)}.py`, `${normalize(parts)}/__init__.py`]) };
}

function resolver(paths) {
  const set = new Set(paths);
  return (from, item) => {
    if (languageOf(from) === LANG.PY) {
      const { exact, paths: candidates } = pyCandidates(from, item);
      for (const candidate of candidates) {
        if (set.has(candidate)) return candidate;
        if (!exact) {
          const hit = paths.find((path) => path.endsWith(`/${candidate}`));
          if (hit) return hit;
        }
      }
      return "";
    }
    return jsCandidates(from, item.spec || "").find((candidate) => set.has(candidate)) || "";
  };
}

function levels(paths, edges) {
  const level = new Map(paths.map((path) => [path, 0]));
  for (let round = 0; round < paths.length; round += 1) {
    let moved = false;
    for (const edge of edges) {
      const next = level.get(edge.from) + 1;
      if (next > level.get(edge.to) && next < paths.length) {
        level.set(edge.to, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return level;
}

export function autoGraph(info) {
  const paths = info.map((item) => item.path);
  const resolve = resolver(paths);
  const edges = [];
  const seen = new Set();
  const link = (from, to) => {
    const key = `${from}\u0000${to}`;
    if (from === to || seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to });
  };
  for (const item of info) {
    for (const spec of item.imports) {
      const target = resolve(item.path, spec);
      if (target) link(target, item.path);
    }
  }
  for (const provider of info) {
    const changed = new Set(provider.changes.filter((change) => change.status !== NODE_STATUS.REMOVED).map((change) => change.name));
    for (const consumer of info) {
      if (consumer === provider) continue;
      for (const name of changed) {
        if (consumer.calls.has(name) && !consumer.defs.has(name)) link(provider.path, consumer.path);
      }
    }
  }
  const linked = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  const level = levels(paths, edges);
  const last = Math.max(0, ...[...linked].map((path) => level.get(path))) + 1;
  const nodes = info
    .map((item) => ({ path: item.path, label: labelFor(item.changes), order: linked.has(item.path) ? level.get(item.path) : last }))
    .filter((node) => node.label || linked.has(node.path));
  if (!nodes.length) return null;
  return { nodes, edges };
}

const emptyInfo = (path, fallback = "") => ({ path, changes: [], imports: [], calls: new Set(), defs: new Set(), fallback });

function supported(file) {
  return Boolean(languageOf(file.path) || languageOf(file.oldPath || file.path));
}

function statusOf(file) {
  return CHANGE_STATUS[file.change] || NODE_STATUS.MODIFIED;
}

function countText(parsed) {
  const parts = [];
  if (parsed.additions) parts.push(`+${parsed.additions}`);
  if (parsed.deletions) parts.push(`\u2212${parsed.deletions}`);
  return parts.join(" ");
}

function listName(file, parsed) {
  if (!parsed) return LIST_TEXT.MISSING;
  if (parsed.binary) return LIST_TEXT.BINARY;
  const counts = countText(parsed);
  if (counts) return counts;
  return file.oldPath && file.oldPath !== file.path ? LIST_TEXT.RENAMED : LIST_TEXT.SAME;
}

function firstLine(file, parsed) {
  const removed = statusOf(file) === NODE_STATUS.REMOVED;
  const hit = parsed?.lines.find((line) => line.kind === (removed ? LINE.DEL : LINE.ADD))
    || parsed?.lines.find((line) => line.kind === LINE.DEL || line.kind === LINE.ADD);
  return hit ? (hit.newNo ?? hit.oldNo ?? 0) : 0;
}

function listResult(sha, file, parsed, partial) {
  const name = listName(file, parsed);
  return {
    path: file.path,
    source: SOURCE.LIST,
    partial,
    rows: [{
      [NODE.SHA]: sha,
      [NODE.PATH]: file.path,
      [NODE.ID]: LIST_ID,
      [NODE.PARENT]: "",
      [NODE.KIND]: NODE_KIND.FILE,
      [NODE.NAME]: name,
      [NODE.STATUS]: statusOf(file),
      [NODE.LINE]: String(firstLine(file, parsed) || ""),
      [NODE.DETAIL]: "",
    }],
    info: emptyInfo(file.path, `${LABEL.change[file.change] || LABEL.change[CHANGE.MODIFIED]} · ${name}`),
  };
}

function sparseSides(parsed, change) {
  const oldText = [];
  const newText = [];
  const oldShown = [];
  const newShown = [];
  let pending = null;
  const known = new Set();
  const place = (lines, at, text) => {
    if (at >= 0 && lines[at] == null) lines[at] = text;
  };
  for (const line of parsed.lines) {
    if (line.kind === LINE.HUNK) {
      const head = HUNK_HEAD.exec(line.text);
      pending = head && head[3].trim() ? { old: Number(head[1]) - 2, new: Number(head[2]) - 2, text: head[3] } : null;
      continue;
    }
    if (pending) {
      if (!known.has(pending.text.trim()) && oldText[pending.old] == null && newText[pending.new] == null) {
        place(oldText, pending.old, pending.text);
        place(newText, pending.new, pending.text);
      }
      pending = null;
    }
    if (line.text != null) known.add(String(line.text).trim());
    if (line.oldNo != null) {
      oldText[line.oldNo - 1] = line.text;
      oldShown.push(line.oldNo);
    }
    if (line.newNo != null) {
      newText[line.newNo - 1] = line.text;
      newShown.push(line.newNo);
    }
  }
  const join = (lines) => Array.from(lines, (text) => text ?? "").join("\n");
  return {
    old: change === CHANGE.ADDED ? null : join(oldText),
    new: change === CHANGE.DELETED ? null : join(newText),
    oldShown: oldShown.sort((a, b) => a - b),
    newShown: newShown.sort((a, b) => a - b),
  };
}

function nearest(shown, line) {
  if (!shown.length || !line) return line;
  return shown.find((value) => value >= line) ?? shown[shown.length - 1];
}

function outlineResult(sha, file, before, after, source, partial) {
  const pairs = delta(before.nodes, after.nodes);
  const current = file.new == null ? before : after;
  return {
    path: file.path,
    source,
    partial,
    rows: rowsFrom(sha, file.path, pairs),
    info: { path: file.path, changes: topChanges(pairs), imports: current.imports, calls: current.calls, defs: topDefs(current.nodes), fallback: "" },
  };
}

async function fromContent(sha, file) {
  const parsed = diffTexts(file.old, file.new);
  if (!supported(file)) return listResult(sha, file, parsed, false);
  const before = await analyzeSource(file.old, file.oldPath || file.path);
  const after = await analyzeSource(file.new, file.path);
  const sides = { old: file.old ?? null, new: file.new ?? null, oldPath: file.oldPath || file.path, oldShown: null, newShown: null };
  return { ...withList(outlineResult(sha, file, before, after, SOURCE.FULL, false), listResult(sha, file, parsed, false)), sides, flowSource: SOURCE.FULL };
}

async function fromPatch(sha, file, patch) {
  const parsed = parsePatch(patch);
  const whole = file.change === CHANGE.ADDED || file.change === CHANGE.DELETED || !parsed.lines.length;
  if (parsed.binary || !supported(file) || !parsed.lines.length) return listResult(sha, file, parsed, !whole);
  const sides = sparseSides(parsed, file.change);
  const before = await analyzeSource(sides.old, file.oldPath || file.path);
  const after = await analyzeSource(sides.new, file.path);
  const result = outlineResult(sha, { ...file, new: sides.new }, before, after, SOURCE.PATCH, !whole);
  for (const row of result.rows) {
    const shown = row[NODE.STATUS] === NODE_STATUS.REMOVED ? sides.oldShown : sides.newShown;
    row[NODE.LINE] = String(nearest(shown, Number.parseInt(row[NODE.LINE], 10) || 0) || "");
  }
  return { ...withList(result, listResult(sha, file, parsed, !whole)), sides: { ...sides, oldPath: file.oldPath || file.path }, flowSource: SOURCE.PATCH };
}

function withList(result, list) {
  if (result.rows.length) return result;
  return { ...list, info: { ...result.info, fallback: list.info.fallback } };
}

async function analyzeOne(sha, file, patch) {
  const complete = file.content && file.received >= file.total;
  if (file.binary) return listResult(sha, file, { lines: [], binary: true, additions: 0, deletions: 0 }, false);
  if (complete) return fromContent(sha, file);
  const text = file.content ? patch : file.patch;
  if (text) return fromPatch(sha, file, text);
  return listResult(sha, file, file.content ? null : parsePatch(""), Boolean(file.content));
}

export async function analyzeCommit(sha, files, patches = []) {
  const patchOf = new Map((patches || []).filter((item) => item.patch).map((item) => [item.path, item.patch]));
  const results = [];
  for (const file of files || []) results.push(await analyzeOne(sha, file, patchOf.get(file.path)));
  const info = results.map((result) => result.info);
  return { files: results, rows: results.flatMap((result) => result.rows), graph: autoGraph(info) || fallbackGraph(info) };
}

function fallbackGraph(info) {
  const nodes = info.filter((item) => item.fallback).map((item) => ({ path: item.path, label: item.fallback, order: 0 }));
  return nodes.length ? { nodes, edges: [] } : null;
}
