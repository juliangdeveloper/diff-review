export const LINE = Object.freeze({
  ADD: "add",
  DEL: "del",
  CTX: "ctx",
  HUNK: "hunk",
  NOTE: "note",
});

const SIGN = Object.freeze({ ADD: "+", DEL: "-", CTX: " ", NOTE: "\\" });
const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
const BINARY_RE = /^(Binary files .* differ|GIT binary patch)/;
const HUNK_START = "@@";

export function joinChunks(rows) {
  const sorted = rows.slice().sort((a, b) => a.index - b.index);
  const seen = new Set(sorted.map((row) => row.index));
  const total = sorted.reduce((max, row) => Math.max(max, row.total), 0);
  return {
    patch: sorted.map((row) => row.patch).join(""),
    received: seen.size,
    total: Math.max(total, seen.size),
  };
}

export function parsePatch(patch) {
  const text = String(patch ?? "").replace(/\r\n/g, "\n");
  const lines = text.length ? text.split("\n") : [];
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const out = [];
  let inHunk = false;
  let binary = false;
  let oldNo = 0;
  let newNo = 0;
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (!inHunk && !line.startsWith(HUNK_START)) {
      if (BINARY_RE.test(line)) binary = true;
      continue;
    }
    const hunk = line.startsWith(HUNK_START) ? HUNK_RE.exec(line) : null;
    if (hunk) {
      inHunk = true;
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[3]);
      out.push({ kind: LINE.HUNK, text: line });
      continue;
    }
    const sign = line.charAt(0);
    const body = line.slice(1);
    if (sign === SIGN.ADD) {
      out.push({ kind: LINE.ADD, oldNo: null, newNo: newNo++, text: body });
      additions += 1;
    } else if (sign === SIGN.DEL) {
      out.push({ kind: LINE.DEL, oldNo: oldNo++, newNo: null, text: body });
      deletions += 1;
    } else if (sign === SIGN.NOTE) {
      out.push({ kind: LINE.NOTE, text: body.trim() });
    } else {
      out.push({ kind: LINE.CTX, oldNo: oldNo++, newNo: newNo++, text: sign === SIGN.CTX ? body : line });
    }
  }
  if (!out.length && !binary && lines.length) {
    lines.forEach((line, i) => out.push({ kind: LINE.CTX, oldNo: null, newNo: i + 1, text: line }));
  }
  return { lines: out, binary: binary && !out.length, additions, deletions };
}

function cell(className, text) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

export function renderLines(parsed) {
  const maxNo = parsed.lines.reduce((max, line) => Math.max(max, line.oldNo || 0, line.newNo || 0), 0);
  const wrap = document.createElement("div");
  wrap.className = "diff-lines";
  wrap.style.setProperty("--nw", `${Math.max(String(maxNo).length, 2)}ch`);
  const frag = document.createDocumentFragment();
  for (const line of parsed.lines) {
    const row = document.createElement("div");
    row.className = `ln ln-${line.kind}`;
    if (line.oldNo != null) row.dataset.old = String(line.oldNo);
    if (line.newNo != null) row.dataset.new = String(line.newNo);
    if (line.kind === LINE.HUNK || line.kind === LINE.NOTE) {
      row.appendChild(cell("code", line.text));
    } else {
      const nums = document.createElement("span");
      nums.className = "nums";
      nums.appendChild(cell("no", line.oldNo ?? ""));
      nums.appendChild(cell("no", line.newNo ?? ""));
      row.appendChild(nums);
      const sign = line.kind === LINE.ADD ? SIGN.ADD : line.kind === LINE.DEL ? SIGN.DEL : SIGN.CTX;
      row.appendChild(cell("sign", sign));
      row.appendChild(cell("code", line.text));
    }
    frag.appendChild(row);
  }
  wrap.appendChild(frag);
  return wrap;
}
