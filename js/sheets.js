import { COMMIT, DIFF, HEADERS, META, SCHEMA_KEY, SCHEMA_VERSION, TAB, URLS } from "./config.js";
import { AppError, ERROR } from "./google.js";

const HTTP = Object.freeze({ UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404 });
const HEADER_ROW = 1;
const LETTER_BASE = 26;
const CHAR_A = 65;
const NUMBER_JUNK = /[^\d-]/g;

export function columnLetter(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % LETTER_BASE;
    out = String.fromCharCode(CHAR_A + rem) + out;
    n = Math.floor((n - 1) / LETTER_BASE);
  }
  return out;
}

export function quoteTab(title) {
  return `'${String(title).replaceAll("'", "''")}'`;
}

export function toNumber(value) {
  const n = parseInt(String(value ?? "").replace(NUMBER_JUNK, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

export function parseTable(values, tab) {
  const table = Array.isArray(values) ? values : [];
  const header = (table[0] || []).map((cell) => String(cell ?? "").trim().toLowerCase());
  const index = {};
  header.forEach((name, i) => {
    if (name && !(name in index)) index[name] = i;
  });
  const missing = HEADERS[tab].filter((name) => !(name in index));
  if (missing.length) throw new AppError(ERROR.HEADERS, `${tab}: ${missing.join(", ")}`);
  const rows = [];
  for (let r = 1; r < table.length; r += 1) {
    const line = table[r] || [];
    if (!line.some((cell) => String(cell ?? "").trim())) continue;
    const row = { _row: r + HEADER_ROW };
    for (const name of HEADERS[tab]) {
      const raw = String(line[index[name]] ?? "");
      row[name] = name === DIFF.PATCH ? raw : raw.trim();
    }
    rows.push(row);
  }
  return { index, width: header.length, rows };
}

export function checkSchema(metaTable) {
  const entry = metaTable.rows.find((row) => row[META.KEY].trim() === SCHEMA_KEY);
  const found = entry ? entry[META.VALUE].trim() : "";
  if (found !== String(SCHEMA_VERSION)) throw new AppError(ERROR.SCHEMA, found);
}

async function api(token, path, options = {}) {
  let res;
  try {
    res = await fetch(URLS.SHEETS + path, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
    });
  } catch (e) {
    throw new AppError(ERROR.HTTP, String(e?.message || ""));
  }
  if (res.status === HTTP.UNAUTHORIZED) throw new AppError(ERROR.AUTH);
  if (res.status === HTTP.FORBIDDEN || res.status === HTTP.NOT_FOUND) throw new AppError(ERROR.ACCESS);
  if (!res.ok) throw new AppError(ERROR.HTTP, String(res.status));
  return res.json();
}

function batchPath(sheetId, tabs) {
  const ranges = tabs.map((tab) => `ranges=${encodeURIComponent(quoteTab(tab))}`).join("&");
  return `${encodeURIComponent(sheetId)}/values:batchGet?${ranges}`;
}

export async function loadSheet(token, sheetId) {
  const info = await api(token, `${encodeURIComponent(sheetId)}?fields=properties.title,sheets.properties.title`);
  const titles = (info.sheets || []).map((sheet) => sheet.properties?.title);
  const needed = Object.values(TAB);
  const missing = needed.filter((tab) => !titles.includes(tab));
  if (missing.length) throw new AppError(ERROR.TABS, missing.join(", "));
  const tabs = [TAB.META, TAB.COMMITS, TAB.REVIEWS];
  const data = await api(token, batchPath(sheetId, tabs));
  const ranges = data.valueRanges || [];
  const meta = parseTable(ranges[0]?.values, TAB.META);
  checkSchema(meta);
  return {
    title: String(info.properties?.title || ""),
    commits: parseTable(ranges[1]?.values, TAB.COMMITS),
    reviews: parseTable(ranges[2]?.values, TAB.REVIEWS),
  };
}

export async function loadDiffs(token, sheetId) {
  const data = await api(token, batchPath(sheetId, [TAB.DIFFS]));
  return parseTable(data.valueRanges?.[0]?.values, TAB.DIFFS);
}

export async function appendReview(token, sheetId, reviewsTable, review) {
  const row = new Array(Math.max(reviewsTable.width, HEADERS[TAB.REVIEWS].length)).fill("");
  for (const name of HEADERS[TAB.REVIEWS]) row[reviewsTable.index[name]] = review[name] ?? "";
  const range = encodeURIComponent(`${quoteTab(TAB.REVIEWS)}!A1`);
  return api(token, `${encodeURIComponent(sheetId)}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values: [row] }),
  });
}

export async function updateStatus(token, sheetId, commitsTable, sha, branch, status) {
  const shaCol = columnLetter(commitsTable.index[COMMIT.SHA]);
  const branchCol = columnLetter(commitsTable.index[COMMIT.BRANCH]);
  const statusCol = columnLetter(commitsTable.index[COMMIT.STATUS]);
  const tab = quoteTab(TAB.COMMITS);
  const ranges = [`${tab}!${shaCol}:${shaCol}`, `${tab}!${branchCol}:${branchCol}`]
    .map((range) => `ranges=${encodeURIComponent(range)}`).join("&");
  const data = await api(token, `${encodeURIComponent(sheetId)}/values:batchGet?${ranges}&majorDimension=COLUMNS`);
  const shas = data.valueRanges?.[0]?.values?.[0] || [];
  const branches = data.valueRanges?.[1]?.values?.[0] || [];
  const targets = [];
  shas.forEach((value, i) => {
    if (i < HEADER_ROW) return;
    if (String(value).trim() !== sha) return;
    if (branch && String(branches[i] ?? "").trim() !== branch) return;
    targets.push(i + HEADER_ROW);
  });
  if (!targets.length) throw new AppError(ERROR.NOT_FOUND, sha);
  await api(token, `${encodeURIComponent(sheetId)}/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "RAW",
      data: targets.map((rowNumber) => ({ range: `${tab}!${statusCol}${rowNumber}`, values: [[status]] })),
    }),
  });
  return targets;
}
