export const APP_ID = "diff-review";
export const APP_VERSION = "0.1.0";
export const SCHEMA_VERSION = 1;
export const SCHEMA_KEY = "schema_version";
export const PATCH_CHUNK_MAX = 40000;
export const LARGE_FILE_LINES = 800;
export const AUTO_OPEN_MAX_FILES = 8;
export const TOKEN_MARGIN_MS = 60000;
export const SCRIPT_TIMEOUT_MS = 15000;
export const MESSAGE_PREVIEW_CHARS = 140;

const PREFIX = "diffreview.";
export const STORAGE = Object.freeze({
  CLIENT_ID: PREFIX + "clientId",
  API_KEY: PREFIX + "apiKey",
  SHEET_ID: PREFIX + "sheetId",
  SHEET_NAME: PREFIX + "sheetName",
  WRAP: PREFIX + "wrap",
  REVIEWER: PREFIX + "reviewer",
  TOKEN: PREFIX + "token",
});

export const SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/drive.file",
  "openid",
  "email",
]);

export const URLS = Object.freeze({
  GSI: "https://accounts.google.com/gsi/client",
  GAPI: "https://apis.google.com/js/api.js",
  SHEETS: "https://sheets.googleapis.com/v4/spreadsheets/",
  USERINFO: "https://www.googleapis.com/oauth2/v3/userinfo",
  TEMPLATE_XLSX: "plantilla/diff-review-plantilla.xlsx",
});

export const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

export const TAB = Object.freeze({
  COMMITS: "commits",
  DIFFS: "diffs",
  REVIEWS: "reviews",
  META: "meta",
});

export const COMMIT = Object.freeze({
  SHA: "commit_sha",
  SHORT: "short_sha",
  BRANCH: "branch",
  REPO: "repo",
  AUTHOR: "author",
  DATE: "date_iso",
  MESSAGE: "message",
  PARENT: "parent_sha",
  FILES: "files_changed",
  ADDITIONS: "additions",
  DELETIONS: "deletions",
  UPLOADED: "uploaded_at",
  STATUS: "status",
});

export const DIFF = Object.freeze({
  SHA: "commit_sha",
  PATH: "file_path",
  CHANGE: "change_type",
  OLD_PATH: "old_path",
  CHUNK: "chunk_index",
  CHUNKS: "chunk_total",
  PATCH: "patch",
});

export const REVIEW = Object.freeze({
  ID: "review_id",
  SHA: "commit_sha",
  BRANCH: "branch",
  DECISION: "decision",
  COMMENT: "comment",
  REVIEWER: "reviewer",
  AT: "reviewed_at",
});

export const META = Object.freeze({
  KEY: "key",
  VALUE: "value",
});

export const HEADERS = Object.freeze({
  [TAB.COMMITS]: Object.freeze(Object.values(COMMIT)),
  [TAB.DIFFS]: Object.freeze(Object.values(DIFF)),
  [TAB.REVIEWS]: Object.freeze(Object.values(REVIEW)),
  [TAB.META]: Object.freeze(Object.values(META)),
});

export const STATUS = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
});

export const DECISION = Object.freeze({
  APPROVED: "approved",
  REJECTED: "rejected",
  COMMENT: "comment",
});

export const DECISION_STATUS = Object.freeze({
  [DECISION.APPROVED]: STATUS.APPROVED,
  [DECISION.REJECTED]: STATUS.REJECTED,
});

export const CHANGE = Object.freeze({
  ADDED: "A",
  MODIFIED: "M",
  DELETED: "D",
  RENAMED: "R",
});

export const LABEL = Object.freeze({
  status: Object.freeze({
    [STATUS.PENDING]: "Pendiente",
    [STATUS.APPROVED]: "Aprobado",
    [STATUS.REJECTED]: "Rechazado",
  }),
  decision: Object.freeze({
    [DECISION.APPROVED]: "Aprobado",
    [DECISION.REJECTED]: "Rechazado",
    [DECISION.COMMENT]: "Comentario",
  }),
  change: Object.freeze({
    [CHANGE.ADDED]: "Nuevo",
    [CHANGE.MODIFIED]: "Modificado",
    [CHANGE.DELETED]: "Eliminado",
    [CHANGE.RENAMED]: "Renombrado",
  }),
});

export const ROUTE = Object.freeze({
  COMMITS: "commits",
  BRANCHES: "ramas",
  BRANCH: "rama",
  COMMIT: "commit",
  HISTORY: "historial",
  SETTINGS: "ajustes",
});

export const FILTER_ALL = "";
