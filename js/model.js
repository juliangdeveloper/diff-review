import { CHANGE, COMMIT, DECISION_STATUS, DIFF, REVIEW, STATUS } from "./config.js";
import { toNumber } from "./sheets.js";
import { joinChunks } from "./diff.js";

const KEY_SEPARATOR = "\u0001";
const SHEET_URL_RE = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/;
const SHEET_ID_RE = /^[A-Za-z0-9_-]{20,}$/;
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

export function parseSheetInput(text) {
  const value = String(text || "").trim();
  const match = SHEET_URL_RE.exec(value);
  if (match) return match[1];
  return SHEET_ID_RE.test(value) ? value : "";
}

export function newId() {
  return crypto.randomUUID();
}
