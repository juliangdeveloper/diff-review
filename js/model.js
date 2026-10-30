import { CHANGE, COMMIT, DECISION_STATUS, DIFF, FILE, FILE_SIDE, REVIEW, STATUS } from "./config.js";
import { toNumber } from "./sheets.js";
import { joinChunks } from "./diff.js";

const KEY_SEPARATOR = "\u0001";
export const SHORT_SHA_LENGTH = 7;
const STATUS_VALUES = new Set(Object.values(STATUS));

export function commitKey(sha, branch) {
  return `${sha}${KEY_SEPARATOR}${branch}`;
}

export function shortSha(commit) {
  return commit[COMMIT.SHORT] || commit[COMMIT.SHA].slice(0, SHORT_SHA_LENGTH);
}

export function firstLine(text) {
  return String(text || "").split("\n")[0].trim();
}

export function restLines(text) {
  return String(text || "").split("\n").slice(1).join("\n").trim();
}

export function timeOf(value) {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

export function reviewMatches(review, commit) {
  if (review[REVIEW.SHA] !== commit[COMMIT.SHA]) return false;
  return !review[REVIEW.BRANCH] || !commit[COMMIT.BRANCH] || review[REVIEW.BRANCH] === commit[COMMIT.BRANCH];
}

export function reviewsFor(reviews, commit) {
  return sortReviews(reviews.filter((review) => reviewMatches(review, commit)));
}

export function sortReviews(reviews) {
  return reviews.slice().sort((a, b) => timeOf(b[REVIEW.AT]) - timeOf(a[REVIEW.AT]) || b._row - a._row);
}

export function commitStatus(commit, reviews) {
  const decisive = reviewsFor(reviews, commit).find((review) => DECISION_STATUS[review[REVIEW.DECISION]]);
  if (decisive) return DECISION_STATUS[decisive[REVIEW.DECISION]];
  const own = commit[COMMIT.STATUS].toLowerCase();
  return STATUS_VALUES.has(own) ? own : STATUS.PENDING;
}

export function commitTime(commit) {
  return timeOf(commit[COMMIT.DATE]) || timeOf(commit[COMMIT.UPLOADED]);
}

export function sortCommits(commits) {
  return commits.slice().sort((a, b) => commitTime(b) - commitTime(a) || b._row - a._row);
}

export function commitStats(commit) {
  return {
    files: toNumber(commit[COMMIT.FILES]),
    additions: toNumber(commit[COMMIT.ADDITIONS]),
    deletions: toNumber(commit[COMMIT.DELETIONS]),
  };
}

export function uniqueValues(rows, field) {
  return [...new Set(rows.map((row) => row[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function branchSummary(commits, reviews) {
  const map = new Map();
  for (const commit of commits) {
    const key = commitKey(commit[COMMIT.REPO], commit[COMMIT.BRANCH]);
    if (!map.has(key)) {
      map.set(key, {
        repo: commit[COMMIT.REPO],
        branch: commit[COMMIT.BRANCH],
        latest: 0,
        total: 0,
        counts: { [STATUS.PENDING]: 0, [STATUS.APPROVED]: 0, [STATUS.REJECTED]: 0 },
      });
    }
    const item = map.get(key);
    item.total += 1;
    item.counts[commitStatus(commit, reviews)] += 1;
    item.latest = Math.max(item.latest, commitTime(commit));
  }
  return [...map.values()].sort((a, b) => b.latest - a.latest);
}

export function filesFor(diffRows, sha) {
  const groups = new Map();
  for (const row of diffRows) {
    if (row[DIFF.SHA] !== sha) continue;
    const key = [row[DIFF.PATH], row[DIFF.OLD_PATH], row[DIFF.CHANGE]].join(KEY_SEPARATOR);
    if (!groups.has(key)) {
      groups.set(key, {
        path: row[DIFF.PATH],
        oldPath: row[DIFF.OLD_PATH],
        change: row[DIFF.CHANGE].toUpperCase() || CHANGE.MODIFIED,
        chunks: [],
      });
    }
    groups.get(key).chunks.push({
      index: toNumber(row[DIFF.CHUNK]),
      total: toNumber(row[DIFF.CHUNKS]),
      patch: row[DIFF.PATCH],
    });
  }
  return [...groups.values()].map((file) => ({ ...file, ...joinChunks(file.chunks) }));
}

function joinContent(chunks) {
  const sorted = chunks.slice().sort((a, b) => a.index - b.index);
  const seen = new Set(sorted.map((chunk) => chunk.index));
  const total = sorted.reduce((max, chunk) => Math.max(max, chunk.total), 0);
  return { text: sorted.map((chunk) => chunk.content).join(""), received: seen.size, total: Math.max(total, seen.size) };
}

export function contentFilesFor(fileRows, sha) {
  const groups = new Map();
  for (const row of fileRows || []) {
    if (row[FILE.SHA] !== sha) continue;
    const key = [row[FILE.PATH], row[FILE.OLD_PATH], row[FILE.CHANGE]].join(KEY_SEPARATOR);
    if (!groups.has(key)) {
      groups.set(key, {
        path: row[FILE.PATH],
        oldPath: row[FILE.OLD_PATH],
        change: row[FILE.CHANGE].toUpperCase() || CHANGE.MODIFIED,
        sides: new Map(),
      });
    }
    const side = String(row[FILE.SIDE] || "").toLowerCase();
    const sides = groups.get(key).sides;
    if (!sides.has(side)) sides.set(side, []);
    sides.get(side).push({ index: toNumber(row[FILE.CHUNK]), total: toNumber(row[FILE.CHUNKS]), content: row[FILE.CONTENT] });
  }
  return [...groups.values()].map(({ sides, ...file }) => {
    const before = sides.has(FILE_SIDE.OLD) ? joinContent(sides.get(FILE_SIDE.OLD)) : null;
    const after = sides.has(FILE_SIDE.NEW) ? joinContent(sides.get(FILE_SIDE.NEW)) : null;
    const parts = [before, after].filter(Boolean);
    return {
      ...file,
      content: true,
      binary: sides.has(FILE_SIDE.BINARY),
      old: before ? before.text : null,
      new: after ? after.text : null,
      received: parts.reduce((sum, part) => sum + part.received, 0),
      total: parts.reduce((sum, part) => sum + part.total, 0),
    };
  });
}

export function commitFilesFor(table, sha) {
  const content = contentFilesFor(table.files, sha);
  const paths = new Set(content.map((file) => file.path));
  const legacy = filesFor(table.rows, sha).filter((file) => !paths.has(file.path));
  return content.concat(legacy);
}

export function newId() {
  return crypto.randomUUID();
}
