export const APP_ID = "diff-review";
export const APP_VERSION = "0.2.6";
export const PORTFOLIO_PREFIX = "meta.v1.";
export const PORTFOLIO = Object.freeze({
  v: 1,
  slug: APP_ID,
  proyecto: Object.freeze({
    fase: 4,
    fase_estado: 1,
    fases_completadas: 3,
    objetivo: "Open source para revisar diffs de commits en el celular y aprobar, rechazar o comentar.",
  }),
});
export const SCHEMA_VERSION = 1;
export const SCHEMA_KEY = "schema_version";
export const PATCH_CHUNK_MAX = 40000;
export const LARGE_FILE_LINES = 800;
export const AUTO_OPEN_MAX_FILES = 8;
export const REQUEST_TIMEOUT_MS = 30000;
export const MESSAGE_PREVIEW_CHARS = 140;

const PREFIX = "diffreview.";
export const STORAGE = Object.freeze({
  CONNECTION: PREFIX + "connection",
  WRAP: PREFIX + "wrap",
  REVIEWER: PREFIX + "reviewer",
});

export const LEGACY_STORAGE = Object.freeze([
  PREFIX + "clientId",
  PREFIX + "apiKey",
  PREFIX + "sheetId",
  PREFIX + "sheetName",
  PREFIX + "token",
]);

export const URLS = Object.freeze({
  NEW_SHEET: "https://sheets.new",
  CODE_GS: "apps-script/Code.gs",
});

export const ACTION = Object.freeze({
  PING: "ping",
  LOAD: "load",
  DIFFS: "diffs",
  REVIEW: "review",
});

export const ERROR = Object.freeze({
  INPUT: "input",
  NETWORK: "network",
  URL: "url",
  TIMEOUT: "timeout",
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

export const DEMO_PARAM = "demo";
export const DEMO_ON = "1";

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

export const GRAPH = Object.freeze({
  RULE: "graph_rule",
  LABEL: "graph_label",
  ORDER: "graph_order",
  TO: "graph_to",
});

export const HEADERS = Object.freeze({
  [TAB.COMMITS]: Object.freeze(Object.values(COMMIT)),
  [TAB.DIFFS]: Object.freeze(Object.values(DIFF)),
  [TAB.REVIEWS]: Object.freeze(Object.values(REVIEW)),
  [TAB.META]: Object.freeze(Object.values(META)),
});

export const OPTIONAL = Object.freeze({
  [TAB.COMMITS]: Object.freeze([GRAPH.RULE]),
  [TAB.DIFFS]: Object.freeze([GRAPH.LABEL, GRAPH.ORDER, GRAPH.TO]),
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
