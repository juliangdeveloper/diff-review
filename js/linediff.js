import { LINE } from "./diff.js";

export const CONTEXT_LINES = 3;
const NO_EOL = "No newline at end of file";
const EOL_MARK = "\u0000";
const OP = Object.freeze({ EQ: 0, DEL: 1, ADD: 2 });

export function splitLines(text) {
  const source = String(text ?? "");
  if (!source) return { lines: [], eol: true };
  const lines = source.split("\n");
  const eol = lines[lines.length - 1] === "";
  if (eol) lines.pop();
  return { lines, eol };
}

function keysFor(split, ids) {
  const out = new Int32Array(split.lines.length);
  split.lines.forEach((line, i) => {
    const key = !split.eol && i === split.lines.length - 1 ? line + EOL_MARK : line;
    if (!ids.has(key)) ids.set(key, ids.size);
    out[i] = ids.get(key);
  });
  return out;
}

function bisect(a, aLo, aHi, b, bLo, bHi) {
  const n = aHi - aLo;
  const m = bHi - bLo;
  const maxD = Math.ceil((n + m) / 2);
  const offset = maxD;
  const size = 2 * maxD + 2;
  const v1 = new Int32Array(size).fill(-1);
  const v2 = new Int32Array(size).fill(-1);
  v1[offset + 1] = 0;
  v2[offset + 1] = 0;
  const delta = n - m;
  const front = delta % 2 !== 0;
  let k1start = 0;
  let k1end = 0;
  let k2start = 0;
  let k2end = 0;
  for (let d = 0; d < maxD; d += 1) {
    for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      const i1 = offset + k1;
      let x1 = k1 === -d || (k1 !== d && v1[i1 - 1] < v1[i1 + 1]) ? v1[i1 + 1] : v1[i1 - 1] + 1;
      let y1 = x1 - k1;
      while (x1 < n && y1 < m && a[aLo + x1] === b[bLo + y1]) {
        x1 += 1;
        y1 += 1;
      }
      v1[i1] = x1;
      if (x1 > n) k1end += 2;
      else if (y1 > m) k1start += 2;
      else if (front) {
        const i2 = offset + delta - k1;
        if (i2 >= 0 && i2 < size && v2[i2] !== -1 && x1 >= n - v2[i2]) return [aLo + x1, bLo + y1];
      }
    }
    for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      const i2 = offset + k2;
      let x2 = k2 === -d || (k2 !== d && v2[i2 - 1] < v2[i2 + 1]) ? v2[i2 + 1] : v2[i2 - 1] + 1;
      let y2 = x2 - k2;
      while (x2 < n && y2 < m && a[aHi - x2 - 1] === b[bHi - y2 - 1]) {
        x2 += 1;
        y2 += 1;
      }
      v2[i2] = x2;
      if (x2 > n) k2end += 2;
      else if (y2 > m) k2start += 2;
      else if (!front) {
        const i1 = offset + delta - k2;
        if (i1 >= 0 && i1 < size && v1[i1] !== -1) {
          const x1 = v1[i1];
          const y1 = offset + x1 - i1;
          if (x1 >= n - x2) return [aLo + x1, bLo + y1];
        }
      }
    }
  }
  return null;
}

function mark(a, b) {
  const removed = new Uint8Array(a.length);
  const added = new Uint8Array(b.length);
  const stack = [[0, a.length, 0, b.length]];
  while (stack.length) {
    let [aLo, aHi, bLo, bHi] = stack.pop();
    while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
      aLo += 1;
      bLo += 1;
    }
    while (aLo < aHi && bLo < bHi && a[aHi - 1] === b[bHi - 1]) {
      aHi -= 1;
      bHi -= 1;
    }
    if (aLo === aHi) {
      added.fill(1, bLo, bHi);
      continue;
    }
    if (bLo === bHi) {
      removed.fill(1, aLo, aHi);
      continue;
    }
    const split = bisect(a, aLo, aHi, b, bLo, bHi);
    if (!split) {
      removed.fill(1, aLo, aHi);
      added.fill(1, bLo, bHi);
      continue;
    }
    stack.push([split[0], aHi, split[1], bHi], [aLo, split[0], bLo, split[1]]);
  }
  return { removed, added };
}

function slide(keys, flags) {
  let i = 0;
  while (i < keys.length) {
    if (!flags[i]) {
      i += 1;
      continue;
    }
    let start = i;
    let end = i;
    while (end < keys.length && flags[end]) end += 1;
    while (end < keys.length && !flags[end] && keys[start] === keys[end]) {
      flags[start] = 0;
      flags[end] = 1;
      start += 1;
      end += 1;
      while (end < keys.length && flags[end]) end += 1;
    }
    i = end;
  }
}

function script(a, b, removed, added) {
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && removed[i]) ops.push([OP.DEL, i++, -1]);
    else if (j < b.length && added[j]) ops.push([OP.ADD, -1, j++]);
    else ops.push([OP.EQ, i++, j++]);
  }
  return ops;
}

function header(oldStart, oldCount, newStart, newCount) {
  const range = (start, count) => (count === 1 ? `${start}` : `${count ? start : start - 1},${count}`);
  return `@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@`;
}

export function diffTexts(oldText, newText, context = CONTEXT_LINES) {
  const before = splitLines(oldText);
  const after = splitLines(newText);
  const ids = new Map();
  const a = keysFor(before, ids);
  const b = keysFor(after, ids);
  const { removed, added } = mark(a, b);
  slide(a, removed);
  slide(b, added);
  const ops = script(a, b, removed, added);
  const lines = [];
  let additions = 0;
  let deletions = 0;
  const changed = [];
  ops.forEach((op, index) => {
    if (op[0] !== OP.EQ) changed.push(index);
  });
  const hunks = [];
  for (const index of changed) {
    const last = hunks[hunks.length - 1];
    if (last && index - last.end <= 2 * context + 1) last.end = index;
    else hunks.push({ start: index, end: index });
  }
  const oldLast = before.lines.length - 1;
  const newLast = after.lines.length - 1;
  for (const hunk of hunks) {
    const from = Math.max(0, hunk.start - context);
    const to = Math.min(ops.length - 1, hunk.end + context);
    const slice = ops.slice(from, to + 1);
    const firstOld = slice.find((op) => op[1] >= 0);
    const firstNew = slice.find((op) => op[2] >= 0);
    const oldCount = slice.filter((op) => op[1] >= 0).length;
    const newCount = slice.filter((op) => op[2] >= 0).length;
    const oldStart = firstOld ? firstOld[1] + 1 : ops.slice(0, from).filter((op) => op[1] >= 0).length + 1;
    const newStart = firstNew ? firstNew[2] + 1 : ops.slice(0, from).filter((op) => op[2] >= 0).length + 1;
    lines.push({ kind: LINE.HUNK, text: header(oldStart, oldCount, newStart, newCount) });
    for (const [type, i, j] of slice) {
      if (type === OP.DEL) {
        lines.push({ kind: LINE.DEL, oldNo: i + 1, newNo: null, text: before.lines[i] });
        deletions += 1;
        if (i === oldLast && !before.eol) lines.push({ kind: LINE.NOTE, text: NO_EOL });
      } else if (type === OP.ADD) {
        lines.push({ kind: LINE.ADD, oldNo: null, newNo: j + 1, text: after.lines[j] });
        additions += 1;
        if (j === newLast && !after.eol) lines.push({ kind: LINE.NOTE, text: NO_EOL });
      } else {
        lines.push({ kind: LINE.CTX, oldNo: i + 1, newNo: j + 1, text: before.lines[i] });
        if ((i === oldLast && !before.eol) || (j === newLast && !after.eol)) lines.push({ kind: LINE.NOTE, text: NO_EOL });
      }
    }
  }
  return { lines, binary: false, additions, deletions };
}

export function toPatch(parsed) {
  const sign = { [LINE.ADD]: "+", [LINE.DEL]: "-", [LINE.CTX]: " ", [LINE.NOTE]: "\\ " };
  return parsed.lines.map((line) => (line.kind === LINE.HUNK ? line.text : sign[line.kind] + line.text)).join("\n") + (parsed.lines.length ? "\n" : "");
}
