var SCHEMA_VERSION_ = "1";
var SCHEMA_KEY_ = "schema_version";
var SECRET_PROPERTY_ = "SECRET";
var SPREADSHEET_NAME_ = "diff-review";
var MENU_NAME_ = "diff-review";
var MENU_INIT_ = "Inicializar";
var DEFAULT_TABS_ = Object.freeze(["Hoja 1", "Hoja1", "Sheet1", "Sheet 1"]);
var LOCK_MS_ = 30000;
var TEXT_FORMAT_ = "@";
var MAX_COMMENT_ = 10000;
var MAX_REVIEWER_ = 200;
var REVIEW_ID_RE_ = /^[A-Za-z0-9_-]{8,64}$/;

var TAB_ = Object.freeze({
  COMMITS: "commits",
  DIFFS: "diffs",
  REVIEWS: "reviews",
  META: "meta",
});

var TAB_ORDER_ = Object.freeze([TAB_.COMMITS, TAB_.DIFFS, TAB_.REVIEWS, TAB_.META]);

var COMMIT_ = Object.freeze({
  SHA: "commit_sha",
  BRANCH: "branch",
  STATUS: "status",
});

var DIFF_ = Object.freeze({
  SHA: "commit_sha",
});

var REVIEW_ = Object.freeze({
  ID: "review_id",
  SHA: "commit_sha",
  BRANCH: "branch",
  DECISION: "decision",
  COMMENT: "comment",
  REVIEWER: "reviewer",
  AT: "reviewed_at",
});

var META_ = Object.freeze({
  KEY: "key",
  VALUE: "value",
});

var HEADERS_ = Object.freeze({
  commits: ["commit_sha", "short_sha", "branch", "repo", "author", "date_iso", "message", "parent_sha", "files_changed", "additions", "deletions", "uploaded_at", "status"],
  diffs: ["commit_sha", "file_path", "change_type", "old_path", "chunk_index", "chunk_total", "patch"],
  reviews: ["review_id", "commit_sha", "branch", "decision", "comment", "reviewer", "reviewed_at"],
  meta: ["key", "value"],
});

// Optional. Old sheets keep working without them. load and diffs already return
// every column that exists; the app reads these names when the header is present.
// graph_rule: diagram title on commits. graph_label: phrase per file.
// graph_order: block order. graph_to: destination file_path values, separated by |.
var OPTIONAL_HEADERS_ = Object.freeze({
  commits: ["graph_rule"],
  diffs: ["graph_label", "graph_order", "graph_to"],
  reviews: [],
  meta: [],
});

var ACTION_ = Object.freeze({
  PING: "ping",
  LOAD: "load",
  DIFFS: "diffs",
  REVIEW: "review",
});

var STATUS_ = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
});

var DECISION_ = Object.freeze({
  APPROVED: "approved",
  REJECTED: "rejected",
  COMMENT: "comment",
});

var DECISION_STATUS_ = Object.freeze({
  approved: STATUS_.APPROVED,
  rejected: STATUS_.REJECTED,
});

var ERROR_ = Object.freeze({
  FORBIDDEN: "forbidden",
  BAD_REQUEST: "bad_request",
  TABS: "tabs",
  HEADERS: "headers",
  SCHEMA: "schema",
  NOT_FOUND: "not_found",
  DECISION: "decision",
  LOCK: "lock",
  CONTAINER: "container",
  SERVER: "server",
});

function doGet(e) {
  var params = (e && e.parameter) || {};
  if (!authorized_(params.key)) return json_({ ok: false, error: ERROR_.FORBIDDEN });
  return run_(function () {
    if (params.action === ACTION_.PING) return ping_();
    if (params.action === ACTION_.LOAD) return load_();
    if (params.action === ACTION_.DIFFS) return diffs_(params.sha);
    throw fail_(ERROR_.BAD_REQUEST);
  });
}

function doPost(e) {
  var body = parseBody_(e);
  if (!body) return json_({ ok: false, error: ERROR_.BAD_REQUEST });
  if (!authorized_(body.key)) return json_({ ok: false, error: ERROR_.FORBIDDEN });
  return run_(function () {
    if (body.action === ACTION_.REVIEW) return review_(body.review);
    throw fail_(ERROR_.BAD_REQUEST);
  });
}

function run_(task) {
  try {
    return json_(task());
  } catch (err) {
    if (err && err.appCode) return json_({ ok: false, error: err.appCode, detail: err.detail || "" });
    return json_({ ok: false, error: ERROR_.SERVER });
  }
}

function fail_(code, detail) {
  var err = new Error(code);
  err.appCode = code;
  err.detail = detail == null ? "" : String(detail);
  return err;
}

function authorized_(given) {
  var secret = "";
  try {
    secret = String(PropertiesService.getScriptProperties().getProperty(SECRET_PROPERTY_) || "");
  } catch (err) {
    secret = "";
  }
  if (!secret) return false;
  var provided = String(given == null ? "" : given);
  var length = Math.max(provided.length, secret.length);
  var diff = provided.length ^ secret.length;
  for (var i = 0; i < length; i += 1) {
    var left = i < provided.length ? provided.charCodeAt(i) : 0;
    var right = i < secret.length ? secret.charCodeAt(i) : 0;
    diff |= left ^ right;
  }
  return diff === 0;
}

function parseBody_(e) {
  var raw = e && e.postData && e.postData.contents;
  if (typeof raw !== "string" || !raw) return null;
  try {
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch (err) {
    return null;
  }
}

function text_(value) {
  if (value == null) return "";
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return isNaN(value.getTime()) ? "" : value.toISOString();
  }
  if (typeof value === "number") return isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

function spreadsheet_() {
  var ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (err) {
    ss = null;
  }
  if (!ss) throw fail_(ERROR_.CONTAINER);
  return ss;
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu(MENU_NAME_).addItem(MENU_INIT_, "init").addToUi();
}

function init() {
  var ss = spreadsheet_();
  ensureStructure_(ss);
  var message = "diff-review listo: " + ss.getUrl();
  console.log(message);
  try {
    ss.toast(message, MENU_NAME_);
  } catch (err) {
    return message;
  }
  return message;
}

function missingHeaders_(sheet, tab) {
  var lastCol = sheet.getLastColumn();
  var row = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var present = {};
  for (var c = 0; c < row.length; c += 1) present[text_(row[c]).trim().toLowerCase()] = true;
  var missing = [];
  for (var i = 0; i < HEADERS_[tab].length; i += 1) {
    if (!present[HEADERS_[tab][i]]) missing.push(HEADERS_[tab][i]);
  }
  return { missing: missing, start: row.join("").trim() ? lastCol + 1 : 1 };
}

function emptyDefaultTabs_(ss) {
  var sheets = ss.getSheets();
  var out = [];
  for (var i = 0; i < sheets.length; i += 1) {
    var name = sheets[i].getName();
    if (DEFAULT_TABS_.indexOf(name) < 0 || TAB_ORDER_.indexOf(name) >= 0) continue;
    if (sheets[i].getLastRow() === 0 && sheets[i].getLastColumn() === 0) out.push(sheets[i]);
  }
  return out;
}

function schemaRow_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var head = header_(sheet, TAB_.META);
  var keys = sheet.getRange(2, head.map[META_.KEY], lastRow - 1, 1).getValues();
  for (var r = 0; r < keys.length; r += 1) {
    if (text_(keys[r][0]).trim() === SCHEMA_KEY_) return r + 2;
  }
  return 0;
}

function needsRepair_(ss) {
  if (ss.getName() !== SPREADSHEET_NAME_) return true;
  for (var i = 0; i < TAB_ORDER_.length; i += 1) {
    var sheet = ss.getSheetByName(TAB_ORDER_[i]);
    if (!sheet || missingHeaders_(sheet, TAB_ORDER_[i]).missing.length) return true;
  }
  if (!schemaRow_(ss.getSheetByName(TAB_.META))) return true;
  return emptyDefaultTabs_(ss).length > 0;
}

function repair_(ss) {
  if (ss.getName() !== SPREADSHEET_NAME_) ss.rename(SPREADSHEET_NAME_);
  for (var i = 0; i < TAB_ORDER_.length; i += 1) {
    var tab = TAB_ORDER_[i];
    var sheet = ss.getSheetByName(tab) || ss.insertSheet(tab, ss.getSheets().length);
    var gap = missingHeaders_(sheet, tab);
    var columns = gap.missing.slice();
    if (gap.start === 1) {
      var optional = OPTIONAL_HEADERS_[tab] || [];
      for (var k = 0; k < optional.length; k += 1) columns.push(optional[k]);
    }
    if (!columns.length) continue;
    writeText_(sheet.getRange(1, gap.start, 1, columns.length), [columns]);
    var width = Math.max(gap.start + columns.length - 1, HEADERS_[tab].length);
    sheet.getRange(1, 1, sheet.getMaxRows(), width).setNumberFormat(TEXT_FORMAT_);
    if (sheet.getFrozenRows() < 1) sheet.setFrozenRows(1);
  }
  var meta = ss.getSheetByName(TAB_.META);
  if (!schemaRow_(meta)) {
    var head = header_(meta, TAB_.META);
    var line = [];
    for (var c = 0; c < head.width; c += 1) line.push("");
    line[head.map[META_.KEY] - 1] = SCHEMA_KEY_;
    line[head.map[META_.VALUE] - 1] = SCHEMA_VERSION_;
    writeText_(meta.getRange(Math.max(meta.getLastRow(), 1) + 1, 1, 1, head.width), [line]);
  }
  var defaults = emptyDefaultTabs_(ss);
  for (var d = 0; d < defaults.length; d += 1) {
    if (ss.getSheets().length > 1) ss.deleteSheet(defaults[d]);
  }
}

function ensureStructure_(ss) {
  if (!needsRepair_(ss)) return;
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_MS_);
  } catch (err) {
    throw fail_(ERROR_.LOCK);
  }
  try {
    if (needsRepair_(ss)) repair_(ss);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

function sheet_(ss, tab) {
  var sheet = ss.getSheetByName(tab);
  if (!sheet) throw fail_(ERROR_.TABS, tab);
  return sheet;
}

function header_(sheet, tab) {
  var lastCol = sheet.getLastColumn();
  var row = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var names = [];
  var map = {};
  for (var c = 0; c < row.length; c += 1) {
    var name = text_(row[c]).trim().toLowerCase();
    names.push(name);
    if (name && !Object.prototype.hasOwnProperty.call(map, name)) map[name] = c + 1;
  }
  var missing = [];
  for (var i = 0; i < HEADERS_[tab].length; i += 1) {
    if (!map[HEADERS_[tab][i]]) missing.push(HEADERS_[tab][i]);
  }
  if (missing.length) throw fail_(ERROR_.HEADERS, tab + ": " + missing.join(", "));
  return { names: names, map: map, width: Math.max(lastCol, 1) };
}

function table_(ss, tab) {
  var sheet = sheet_(ss, tab);
  var head = header_(sheet, tab);
  var lastRow = sheet.getLastRow();
  var values = lastRow >= 1 ? sheet.getRange(1, 1, lastRow, head.width).getValues() : [];
  return { sheet: sheet, head: head, values: textRows_(values) };
}

function textRows_(values) {
  var out = [];
  for (var r = 0; r < values.length; r += 1) {
    var line = values[r] || [];
    var row = [];
    for (var c = 0; c < line.length; c += 1) row.push(text_(line[c]));
    out.push(row);
  }
  return out;
}

function checkTabs_(ss) {
  var missing = [];
  var tabs = [TAB_.COMMITS, TAB_.DIFFS, TAB_.REVIEWS, TAB_.META];
  for (var i = 0; i < tabs.length; i += 1) {
    if (!ss.getSheetByName(tabs[i])) missing.push(tabs[i]);
  }
  if (missing.length) throw fail_(ERROR_.TABS, missing.join(", "));
}

function schema_(ss) {
  var meta = table_(ss, TAB_.META);
  var keyCol = meta.head.map[META_.KEY] - 1;
  var valueCol = meta.head.map[META_.VALUE] - 1;
  var found = "";
  for (var r = 1; r < meta.values.length; r += 1) {
    if (String(meta.values[r][keyCol]).trim() === SCHEMA_KEY_) {
      found = String(meta.values[r][valueCol]).trim();
      break;
    }
  }
  if (found !== SCHEMA_VERSION_) throw fail_(ERROR_.SCHEMA, found);
  return found;
}

function dataRows_(values) {
  var count = 0;
  for (var r = 1; r < values.length; r += 1) {
    if (values[r].join("").trim()) count += 1;
  }
  return count;
}

function ping_() {
  var ss = spreadsheet_();
  ensureStructure_(ss);
  checkTabs_(ss);
  var version = schema_(ss);
  var commits = table_(ss, TAB_.COMMITS);
  var reviews = table_(ss, TAB_.REVIEWS);
  header_(sheet_(ss, TAB_.DIFFS), TAB_.DIFFS);
  return {
    ok: true,
    title: ss.getName(),
    schema_version: version,
    commits: dataRows_(commits.values),
    reviews: dataRows_(reviews.values),
  };
}

function load_() {
  var ss = spreadsheet_();
  ensureStructure_(ss);
  checkTabs_(ss);
  var version = schema_(ss);
  return {
    ok: true,
    title: ss.getName(),
    schema_version: version,
    commits: table_(ss, TAB_.COMMITS).values,
    reviews: table_(ss, TAB_.REVIEWS).values,
  };
}

function diffs_(sha) {
  var target = String(sha == null ? "" : sha).trim();
  if (!target) throw fail_(ERROR_.BAD_REQUEST);
  var ss = spreadsheet_();
  ensureStructure_(ss);
  var sheet = sheet_(ss, TAB_.DIFFS);
  var head = header_(sheet, TAB_.DIFFS);
  var out = [head.names];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, sha: target, diffs: out };
  var shas = sheet.getRange(2, head.map[DIFF_.SHA], lastRow - 1, 1).getValues();
  var runs = [];
  for (var i = 0; i < shas.length; i += 1) {
    if (text_(shas[i][0]).trim() !== target) continue;
    var rowNumber = i + 2;
    var last = runs[runs.length - 1];
    if (last && last.start + last.count === rowNumber) last.count += 1;
    else runs.push({ start: rowNumber, count: 1 });
  }
  for (var j = 0; j < runs.length; j += 1) {
    var block = sheet.getRange(runs[j].start, 1, runs[j].count, head.width).getValues();
    out = out.concat(textRows_(block));
  }
  return { ok: true, sha: target, diffs: out };
}

function writeText_(range, rows) {
  var rich = [];
  for (var r = 0; r < rows.length; r += 1) {
    var line = [];
    for (var c = 0; c < rows[r].length; c += 1) {
      line.push(SpreadsheetApp.newRichTextValue().setText(String(rows[r][c])).build());
    }
    rich.push(line);
  }
  range.setNumberFormat(TEXT_FORMAT_);
  range.setRichTextValues(rich);
}

function cleanReview_(input) {
  var review = input && typeof input === "object" ? input : {};
  var decision = String(review[REVIEW_.DECISION] == null ? "" : review[REVIEW_.DECISION]).trim();
  var known = false;
  for (var name in DECISION_) {
    if (DECISION_[name] === decision) known = true;
  }
  if (!known) throw fail_(ERROR_.DECISION, decision);
  var sha = String(review[REVIEW_.SHA] == null ? "" : review[REVIEW_.SHA]).trim();
  if (!sha) throw fail_(ERROR_.BAD_REQUEST);
  var comment = String(review[REVIEW_.COMMENT] == null ? "" : review[REVIEW_.COMMENT]).trim().slice(0, MAX_COMMENT_);
  if (decision === DECISION_.COMMENT && !comment) throw fail_(ERROR_.BAD_REQUEST);
  var id = String(review[REVIEW_.ID] == null ? "" : review[REVIEW_.ID]).trim();
  var out = {};
  out[REVIEW_.ID] = REVIEW_ID_RE_.test(id) ? id : Utilities.getUuid();
  out[REVIEW_.SHA] = sha;
  out[REVIEW_.BRANCH] = String(review[REVIEW_.BRANCH] == null ? "" : review[REVIEW_.BRANCH]).trim();
  out[REVIEW_.DECISION] = decision;
  out[REVIEW_.COMMENT] = comment;
  out[REVIEW_.REVIEWER] = String(review[REVIEW_.REVIEWER] == null ? "" : review[REVIEW_.REVIEWER]).trim().slice(0, MAX_REVIEWER_);
  out[REVIEW_.AT] = new Date().toISOString();
  return out;
}

function matchingCommits_(commits, sha, branch) {
  var shaCol = commits.head.map[COMMIT_.SHA] - 1;
  var branchCol = commits.head.map[COMMIT_.BRANCH] - 1;
  var rows = [];
  for (var r = 1; r < commits.values.length; r += 1) {
    var line = commits.values[r];
    if (String(line[shaCol]).trim() !== sha) continue;
    if (branch && String(line[branchCol]).trim() !== branch) continue;
    rows.push(r + 1);
  }
  return rows;
}

function existingReview_(reviews, id) {
  var idCol = reviews.head.map[REVIEW_.ID] - 1;
  for (var r = 1; r < reviews.values.length; r += 1) {
    if (String(reviews.values[r][idCol]).trim() === id) return reviews.values[r];
  }
  return null;
}

function rowObject_(head, line) {
  var out = {};
  for (var i = 0; i < HEADERS_.reviews.length; i += 1) {
    var name = HEADERS_.reviews[i];
    out[name] = line[head.map[name] - 1] || "";
  }
  return out;
}

function review_(input) {
  var review = cleanReview_(input);
  var lock = LockService.getScriptLock();
  var held = false;
  try {
    lock.waitLock(LOCK_MS_);
    held = true;
  } catch (err) {
    throw fail_(ERROR_.LOCK);
  }
  try {
    var ss = spreadsheet_();
    if (needsRepair_(ss)) repair_(ss);
    checkTabs_(ss);
    schema_(ss);
    var commits = table_(ss, TAB_.COMMITS);
    var targets = matchingCommits_(commits, review[REVIEW_.SHA], review[REVIEW_.BRANCH]);
    if (!targets.length) throw fail_(ERROR_.NOT_FOUND, review[REVIEW_.SHA]);
    var statusCol = commits.head.map[COMMIT_.STATUS];
    var reviews = table_(ss, TAB_.REVIEWS);
    var previous = existingReview_(reviews, review[REVIEW_.ID]);
    if (previous) {
      var current = String(commits.values[targets[0] - 1][statusCol - 1]).trim();
      return { ok: true, duplicate: true, review: rowObject_(reviews.head, previous), status: current, rows: targets.length };
    }
    var line = [];
    for (var c = 0; c < reviews.head.width; c += 1) line.push("");
    for (var i = 0; i < HEADERS_.reviews.length; i += 1) {
      var name = HEADERS_.reviews[i];
      line[reviews.head.map[name] - 1] = review[name];
    }
    var nextRow = Math.max(reviews.sheet.getLastRow(), 1) + 1;
    writeText_(reviews.sheet.getRange(nextRow, 1, 1, reviews.head.width), [line]);
    var status = DECISION_STATUS_[review[REVIEW_.DECISION]] || "";
    if (status) {
      for (var t = 0; t < targets.length; t += 1) {
        writeText_(commits.sheet.getRange(targets[t], statusCol, 1, 1), [[status]]);
      }
    } else {
      status = String(commits.values[targets[0] - 1][statusCol - 1]).trim() || STATUS_.PENDING;
    }
    SpreadsheetApp.flush();
    return { ok: true, duplicate: false, review: review, status: status, rows: targets.length };
  } finally {
    if (held) lock.releaseLock();
  }
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
