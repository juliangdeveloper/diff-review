import { DIFF, ERROR, HEADERS, OPTIONAL, SCHEMA_VERSION, TAB } from "./config.js";
import { AppError } from "./errors.js";

const HEADER_ROW = 1;
const NUMBER_JUNK = /[^\d-]/g;

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
  const fields = HEADERS[tab].concat(OPTIONAL[tab] || []);
  const rows = [];
  for (let r = 1; r < table.length; r += 1) {
    const line = table[r] || [];
    if (!line.some((cell) => String(cell ?? "").trim())) continue;
    const row = { _row: r + HEADER_ROW };
    for (const name of fields) {
      if (!(name in index)) continue;
      const raw = String(line[index[name]] ?? "");
      row[name] = name === DIFF.PATCH ? raw : raw.trim();
    }
    rows.push(row);
  }
  return { index, width: header.length, rows };
}

export function checkSchema(body) {
  const found = String(body?.schema_version ?? "").trim();
  if (found !== String(SCHEMA_VERSION)) throw new AppError(ERROR.SCHEMA, found);
  return found;
}

export function parseLoad(body) {
  checkSchema(body);
  return {
    title: String(body?.title || ""),
    commits: parseTable(body?.commits, TAB.COMMITS),
    reviews: parseTable(body?.reviews, TAB.REVIEWS),
  };
}

export function parseDiffs(body) {
  return parseTable(body?.diffs, TAB.DIFFS);
}
