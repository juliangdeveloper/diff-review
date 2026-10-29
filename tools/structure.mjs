import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const COLUMNS = Object.freeze(["commit_sha", "file_path", "node_id", "parent_id", "kind", "name", "status", "line", "detail"]);
const STATUS = Object.freeze({ ADDED: "added", REMOVED: "removed", MODIFIED: "modified", UNCHANGED: "unchanged" });
const KIND = Object.freeze({
  MODULE: "module",
  CLASS: "class",
  FUNCTION: "function",
  METHOD: "method",
  BRANCH: "branch",
  CALL: "call",
});
const OWNER_KINDS = new Set([KIND.MODULE, KIND.CLASS, KIND.FUNCTION, KIND.METHOD]);
const TS_EXTENSIONS = Object.freeze({ ".ts": "TS", ".mts": "TS", ".cts": "TS", ".tsx": "TSX", ".js": "JS", ".mjs": "JS", ".cjs": "JS", ".jsx": "JSX" });
const PY_EXTENSIONS = new Set([".py"]);
const MODULE_NAME = "(módulo)";
const SNIPPET_MAX = 80;
const NAME_MAX = 160;
const MAX_ROWS = 400;
const MAX_BUFFER = 64 * 1024 * 1024;
const HASH_LENGTH = 16;
const PY_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "structure.py");
const PY_BIN = process.env.PYTHON || "python3";
const TS_PACKAGE = "typescript@5";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: MAX_BUFFER, stdio: ["ignore", "pipe", "ignore"] });
}

function tryGit(args) {
  try {
    return git(args);
  } catch (err) {
    return null;
  }
}

function compact(text, max = SNIPPET_MAX) {
  const single = String(text ?? "").replace(/\s+/g, " ").trim();
  return single.length <= max ? single : `${single.slice(0, max - 1)}…`;
}

function hash(text) {
  return createHash("sha1").update(String(text ?? "").replace(/\s+/g, "")).digest("hex").slice(0, HASH_LENGTH);
}

function extensionOf(path) {
  const match = /\.[^./]+$/.exec(path);
  return match ? match[0].toLowerCase() : "";
}

function languageOf(path) {
  const ext = extensionOf(path);
  if (TS_EXTENSIONS[ext]) return "ts";
  if (PY_EXTENSIONS.has(ext)) return "py";
  return "";
}

let tsModule;
function loadTypescript() {
  if (tsModule !== undefined) return tsModule;
  const local = createRequire(import.meta.url);
  const fromPath = String(process.env.NODE_PATH || "").split(delimiter).filter(Boolean).map((dir) => () => local(join(resolve(dir), "typescript")));
  const attempts = [...fromPath, () => createRequire(join(process.cwd(), "noop.js"))("typescript"), () => local("typescript")];
  for (const attempt of attempts) {
    try {
      const found = attempt();
      if (typeof found?.createSourceFile !== "function") continue;
      tsModule = found;
      return tsModule;
    } catch (err) {
      continue;
    }
  }
  tsModule = null;
  return tsModule;
}

function analyzeTs(source, path) {
  const ts = loadTypescript();
  if (!ts) throw new Error("typescript");
  const kind = ts.ScriptKind[TS_EXTENSIONS[extensionOf(path)]];
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const nodes = [];
  let seq = 0;
  let moduleNode = null;
  const lineOf = (node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const add = (entry) => {
    const node = { id: `n${seq++}`, ...entry };
    nodes.push(node);
    return node;
  };
  const moduleOwner = () => {
    if (!moduleNode) moduleNode = add({ kind: KIND.MODULE, name: MODULE_NAME, qual: MODULE_NAME, owner: null, line: 1, sig: "" });
    return moduleNode;
  };
  const nameText = (name) => {
    if (!name) return "";
    if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
    return compact(name.getText(file), NAME_MAX);
  };
  const isFn = (node) => node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
  const params = (fn) => `(${fn.parameters.map((p) => compact(p.getText(file), NAME_MAX)).join(", ")})`;
  const headOf = (node, body) => {
    const start = node.getStart(file);
    const end = body ? body.getStart(file) : node.getEnd();
    return compact(source.slice(start, end));
  };
  const callIn = (node) => {
    let expr = null;
    if (ts.isExpressionStatement(node)) expr = node.expression;
    else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (decl.initializer && !isFn(decl.initializer)) {
          expr = decl.initializer;
          break;
        }
      }
    } else if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) return null;
    if (!expr) return null;
    if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) expr = expr.right;
    if (ts.isAwaitExpression(expr)) expr = expr.expression;
    if (ts.isCallExpression(expr) || ts.isNewExpression(expr)) {
      const callee = compact(expr.expression.getText(file).replace(/\?\./g, "."), NAME_MAX);
      return callee.split(".").pop() || callee;
    }
    return null;
  };
  const owned = (owner, qual, kind, name, node, fn) => add({
    kind, name, qual, owner: owner ? owner.id : null, line: lineOf(node), sig: hash(node.getText(file)), detail: fn ? params(fn) : "",
  });
  const qualify = (owner, name) => (owner && owner.kind !== KIND.MODULE ? `${owner.qual}.${name}` : name);
  const branch = (owner, type, node, head, detail = "") => add({
    kind: type === KIND.CALL ? KIND.CALL : KIND.BRANCH,
    type,
    name: head,
    owner: owner.id,
    ownerQual: owner.qual,
    line: lineOf(node),
    sig: hash(node.getText(file)),
    detail,
  });

  const visit = (node, owner) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const name = nameText(node.name);
      const fn = owned(owner, qualify(owner, name), owner && owner.kind === KIND.CLASS ? KIND.METHOD : KIND.FUNCTION, name, node, node);
      return visitBody(node.body, fn);
    }
    if (ts.isClassDeclaration(node) || (ts.isClassExpression(node) && node.name)) {
      const name = nameText(node.name) || "default";
      const cls = owned(owner, qualify(owner, name), KIND.CLASS, name, node, null);
      node.members.forEach((member) => visit(member, cls));
      return;
    }
    if ((ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.body) {
      const prefix = ts.isGetAccessorDeclaration(node) ? "get " : ts.isSetAccessorDeclaration(node) ? "set " : "";
      const name = prefix + nameText(node.name);
      const fn = owned(owner, qualify(owner, name), KIND.METHOD, name, node, node);
      return visitBody(node.body, fn);
    }
    if (ts.isConstructorDeclaration(node) && node.body) {
      const fn = owned(owner, qualify(owner, "constructor"), KIND.METHOD, "constructor", node, node);
      return visitBody(node.body, fn);
    }
    if ((ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) && isFn(node.initializer)) {
      const name = nameText(node.name);
      const fn = owned(owner, qualify(owner, name), owner && owner.kind === KIND.CLASS ? KIND.METHOD : KIND.FUNCTION, name, node, node.initializer);
      return visitBody(node.initializer.body, fn);
    }
    if (ts.isVariableStatement(node)) {
      const fnDecls = node.declarationList.declarations.filter((decl) => isFn(decl.initializer) && ts.isIdentifier(decl.name));
      if (fnDecls.length) {
        for (const decl of fnDecls) {
          const name = nameText(decl.name);
          const fn = owned(owner, qualify(owner, name), KIND.FUNCTION, name, node, decl.initializer);
          visitBody(decl.initializer.body, fn);
        }
        return;
      }
    }
    if (ts.isExportAssignment(node) && isFn(node.expression)) {
      const fn = owned(owner, qualify(owner, "default"), KIND.FUNCTION, "default", node, node.expression);
      return visitBody(node.expression.body, fn);
    }
    statement(node, owner);
  };

  const statement = (node, owner) => {
    const here = owner || moduleOwner();
    const isOwner = here.kind !== KIND.CLASS;
    if (isOwner && ts.isIfStatement(node)) {
      branch(here, "if", node, `if (${compact(node.expression.getText(file))})`);
      visit(node.thenStatement, owner);
      if (node.elseStatement) visit(node.elseStatement, owner);
      return;
    }
    if (isOwner && ts.isSwitchStatement(node)) {
      branch(here, "switch", node, `switch (${compact(node.expression.getText(file))})`);
      node.caseBlock.clauses.forEach((clause) => clause.statements.forEach((child) => visit(child, owner)));
      return;
    }
    if (isOwner && (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node))) {
      branch(here, "for", node, headOf(node, node.statement));
      visit(node.statement, owner);
      return;
    }
    if (isOwner && (ts.isWhileStatement(node) || ts.isDoStatement(node))) {
      const head = ts.isDoStatement(node) ? `do … while (${compact(node.expression.getText(file))})` : headOf(node, node.statement);
      branch(here, "while", node, head);
      visit(node.statement, owner);
      return;
    }
    if (isOwner && ts.isTryStatement(node)) {
      branch(here, "try", node, "try");
      visit(node.tryBlock, owner);
      if (node.catchClause) {
        const binding = node.catchClause.variableDeclaration ? ` (${compact(node.catchClause.variableDeclaration.getText(file))})` : "";
        branch(here, "catch", node.catchClause, `catch${binding}`);
        visit(node.catchClause.block, owner);
      }
      if (node.finallyBlock) visit(node.finallyBlock, owner);
      return;
    }
    if (isOwner && ts.isReturnStatement(node)) {
      branch(here, "return", node, compact(node.getText(file)));
      if (node.expression) ts.forEachChild(node.expression, (child) => visitExpr(child, owner));
      return;
    }
    if (isOwner && ts.isThrowStatement(node)) {
      branch(here, "throw", node, compact(node.getText(file)));
      return;
    }
    if (ts.isBlock(node)) {
      node.statements.forEach((child) => visit(child, owner));
      return;
    }
    const callee = isOwner ? callIn(node) : null;
    if (callee) branch(here, KIND.CALL, node, compact(node.getText(file)), callee);
    ts.forEachChild(node, (child) => visitExpr(child, owner));
  };

  const visitExpr = (node, owner) => {
    if (ts.isClassExpression(node) || ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)) return visit(node, owner);
    if ((ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) && isFn(node.initializer)) return visit(node, owner);
    if (ts.isMethodDeclaration(node)) return visit(node, owner);
    if (isFn(node) && node.body && ts.isBlock(node.body)) {
      node.body.statements.forEach((child) => visit(child, owner));
      return;
    }
    ts.forEachChild(node, (child) => visitExpr(child, owner));
  };

  const visitBody = (body, fn) => {
    if (!body) return;
    if (ts.isBlock(body)) body.statements.forEach((child) => visit(child, fn));
    else ts.forEachChild(body, (child) => visitExpr(child, fn));
  };

  file.statements.forEach((node) => visit(node, null));
  return nodes;
}

function analyzePy(source) {
  const run = spawnSync(PY_BIN, [PY_SCRIPT], { input: source, encoding: "utf8", maxBuffer: MAX_BUFFER, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  if (run.error) throw new Error("python");
  if (run.status !== 0) throw new Error("python-parse");
  const parsed = JSON.parse(run.stdout || "{}");
  if (parsed.error) throw new Error("python-parse");
  return (parsed.nodes || []).map((node) => ({ ...node, detail: node.detail || "", sig: hash(node.sig) }));
}

function analyze(source, path) {
  if (source == null) return [];
  const lang = languageOf(path);
  if (lang === "ts") return analyzeTs(source, path);
  if (lang === "py") return analyzePy(source);
  return [];
}

function prepare(nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    if (OWNER_KINDS.has(node.kind)) node.key = `${node.qual}:${node.kind}`;
    else node.key = `${node.kind}:${byId.get(node.owner)?.qual ?? ""}:${node.type}:${node.kind === KIND.CALL ? node.detail : ""}`;
  }
  return byId;
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
      pairs.push({ before, after: pick, status: STATUS.UNCHANGED });
    }
    const restOld = olds.filter((node) => !matched.has(node));
    const restNew = news.filter((node) => left.has(node));
    const count = Math.min(restOld.length, restNew.length);
    for (let i = 0; i < count; i += 1) pairs.push({ before: restOld[i], after: restNew[i], status: STATUS.MODIFIED });
    restOld.slice(count).forEach((before) => pairs.push({ before, after: null, status: STATUS.REMOVED }));
    restNew.slice(count).forEach((after) => pairs.push({ before: null, after, status: STATUS.ADDED }));
  }
  return pairs;
}

export function fileRows(sha, path, oldSource, newSource, oldPath = path) {
  const oldNodes = analyze(oldSource, oldPath);
  const newNodes = analyze(newSource, path);
  const pairs = delta(oldNodes, newNodes);
  const entityOf = new Map();
  pairs.forEach((pair, index) => {
    pair.index = index;
    if (pair.before) entityOf.set(`o:${pair.before.id}`, pair);
    if (pair.after) entityOf.set(`n:${pair.after.id}`, pair);
  });
  for (const pair of pairs) {
    const node = pair.after || pair.before;
    const side = pair.after ? "n" : "o";
    pair.node = node;
    pair.parent = node.owner ? entityOf.get(`${side}:${node.owner}`) || null : null;
    pair.line = node.line;
  }
  const keep = new Set();
  for (const pair of pairs) {
    if (pair.status === STATUS.UNCHANGED) continue;
    let current = pair;
    while (current && !keep.has(current)) {
      keep.add(current);
      current = current.parent;
    }
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
    const list = (children.get(key) || []).sort((a, b) => a.line - b.line || a.index - b.index);
    for (const pair of list) {
      ordered.push(pair);
      walk(pair.index);
    }
  };
  walk(-1);
  const ids = new Map(ordered.map((pair, index) => [pair, `s${index + 1}`]));
  return ordered.map((pair) => ({
    commit_sha: sha,
    file_path: path,
    node_id: ids.get(pair),
    parent_id: pair.parent ? ids.get(pair.parent) || "" : "",
    kind: pair.node.kind === KIND.BRANCH ? pair.node.type : pair.node.kind,
    name: compact(pair.node.name, NAME_MAX),
    status: pair.status,
    line: String(pair.line || ""),
    detail: compact(pair.node.detail || "", NAME_MAX),
  }));
}

function changedFiles(sha) {
  const out = git(["show", "--name-status", "-M", "--format=", sha]);
  return out.split("\n").filter(Boolean).map((line) => {
    const parts = line.split("\t");
    const code = parts[0].charAt(0);
    if (code === "R" || code === "C") return { change: code, oldPath: parts[1], path: parts[2] };
    return { change: code, oldPath: parts[1], path: parts[1] };
  });
}

function show(rev, path) {
  if (!rev) return null;
  return tryGit(["show", `${rev}:${path}`]);
}

export function commitRows(ref = "HEAD") {
  const sha = git(["rev-parse", ref]).trim();
  const parent = (tryGit(["rev-parse", `${sha}^`]) || "").trim();
  const rows = [];
  const warnings = [];
  for (const file of changedFiles(sha)) {
    if (!languageOf(file.path) && !languageOf(file.oldPath)) continue;
    const before = file.change === "A" ? null : show(parent, file.oldPath);
    const after = file.change === "D" ? null : show(sha, file.path);
    try {
      rows.push(...fileRows(sha, file.path, before, after, file.oldPath));
    } catch (err) {
      warnings.push(`${file.path}: ${err.message}`);
    }
  }
  if (rows.length > MAX_ROWS) warnings.push(`truncated:${rows.length}`);
  return { sha, rows: rows.slice(0, MAX_ROWS), warnings };
}

function main() {
  const args = process.argv.slice(2);
  const ref = args.find((arg) => !arg.startsWith("--")) || "HEAD";
  if (!loadTypescript()) {
    process.stderr.write(`diff-review structure: falta ${TS_PACKAGE} (el compilador en JavaScript). Instálalo con npm install --prefix <carpeta> ${TS_PACKAGE} y corre con NODE_PATH=<carpeta>/node_modules.\n`);
  }
  const result = commitRows(ref);
  for (const warning of result.warnings) process.stderr.write(`diff-review structure: ${warning}\n`);
  if (args.includes("--values")) {
    process.stdout.write(`${JSON.stringify(result.rows.map((row) => COLUMNS.map((name) => row[name])))}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({ columns: COLUMNS, rows: result.rows })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
