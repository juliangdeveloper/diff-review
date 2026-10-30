import {
  COMMIT, DECISION, DECISION_STATUS, DIFF, ERROR, FILE, FILE_SIDE, GRAPH, HEADERS, OPTIONAL, REVIEW, SCHEMA_VERSION, STATUS, TAB,
} from "./config.js";
import { AppError } from "./errors.js";
import { parsePatch } from "./diff.js";
import { diffTexts } from "./linediff.js";

export const DEMO_TITLE = "Revisiones de ejemplo";
const REPO = "ejemplo/tienda-web";
const DELAY_MS = 120;

const COMMITS = [
  {
    [COMMIT.SHA]: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    [COMMIT.BRANCH]: "feature/carrito",
    [COMMIT.AUTHOR]: "Persona Ejemplo",
    [COMMIT.DATE]: "2026-10-20T15:42:00-05:00",
    [COMMIT.MESSAGE]: "Agrega total con descuento al carrito\n\nCalcula el descuento por cupón antes de los impuestos.",
    [GRAPH.RULE]: "El cupón entra antes del IVA",
    [COMMIT.PARENT]: "0f1e2d3c4b5a69788796a5b4c3d2e1f00a1b2c3d",
    [COMMIT.STATUS]: STATUS.PENDING,
  },
  {
    [COMMIT.SHA]: "0f1e2d3c4b5a69788796a5b4c3d2e1f00a1b2c3d",
    [COMMIT.BRANCH]: "feature/carrito",
    [COMMIT.AUTHOR]: "Persona Ejemplo",
    [COMMIT.DATE]: "2026-10-19T10:05:00-05:00",
    [COMMIT.MESSAGE]: "Renombra helpers de precios",
    [COMMIT.PARENT]: "9a8b7c6d5e4f30211203f4e5d6c7b8a90f1e2d3c",
    [COMMIT.STATUS]: STATUS.REJECTED,
  },
  {
    [COMMIT.SHA]: "9a8b7c6d5e4f30211203f4e5d6c7b8a90f1e2d3c",
    [COMMIT.BRANCH]: "main",
    [COMMIT.AUTHOR]: "Otra Persona",
    [COMMIT.DATE]: "2026-10-17T18:30:00-05:00",
    [COMMIT.MESSAGE]: "Corrige el formato de moneda en el resumen",
    [COMMIT.PARENT]: "5566778899aabbccddeeff001122334455667788",
    [COMMIT.STATUS]: STATUS.APPROVED,
  },
  {
    [COMMIT.SHA]: "5566778899aabbccddeeff001122334455667788",
    [COMMIT.BRANCH]: "main",
    [COMMIT.AUTHOR]: "Otra Persona",
    [COMMIT.DATE]: "2026-10-15T09:12:00-05:00",
    [COMMIT.MESSAGE]: "Agrega pantalla de pedido confirmado",
    [COMMIT.PARENT]: "",
    [COMMIT.STATUS]: STATUS.PENDING,
  },
];

const SUMMARY_OLD = [
  "import { formatMoney } from \"./money.js\";",
  "",
  "export function orderTitle(order) {",
  "  return order.name;",
  "}",
  "",
  "export function renderSummary(order) {",
  "  const lines = order.items.map((item) => item.name);",
  "  const total = \"$\" + order.total;",
  "  return lines.concat(total).join(\"\\n\");",
  "}",
].join("\n");

const SUMMARY_NEW = [
  "import { formatMoney } from \"./money.js\";",
  "",
  "export function orderTitle(order) {",
  "  return order.name;",
  "}",
  "",
  "export function renderSummary(order) {",
  "  const lines = order.items.map((item) => item.name);",
  "  const total = formatMoney(order.total);",
  "  const header = `Pedido ${order.id}`;",
  "  return [header, ...lines, total].join(\"\\n\");",
  "}",
].join("\n");

const PRICE_OLD = [
  "export function toCents(value) {",
  "  return Math.round(value * 100);",
  "}",
  "",
  "export function fromCents(value) {",
  "  return value / 100;",
  "}",
  "",
  "export function formatMoney(value) {",
  "  return \"$\" + value;",
  "}",
  "",
].join("\n");

const MONEY_NEW = [
  "export function formatMoney(value) {",
  "  return new Intl.NumberFormat(\"es-CO\", { style: \"currency\", currency: \"COP\" }).format(value);",
  "}",
  "",
].join("\n");

const LEGACY_OLD = [
  "export const LEGACY = true;",
  "export default LEGACY;",
  "",
].join("\n");

const CART_OLD = [
  "import { formatMoney } from \"./money.js\";",
  "",
  "export function cartTotal(items, coupon) {",
  "  const subtotal = items.reduce((sum, item) => sum + item.price, 0);",
  "  return subtotal * 1.19;",
  "}",
  "",
  "export function cartSummary(items, coupon) {",
  "  return formatMoney(cartTotal(items));",
  "}",
  "",
].join("\n");

const CART_NEW = [
  "import { formatMoney } from \"./money.js\";",
  "import { couponRate } from \"./coupons.js\";",
  "",
  "export function cartTotal(items, coupon) {",
  "  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);",
  "  const discount = subtotal * couponRate(coupon);",
  "  const taxed = (subtotal - discount) * 1.19;",
  "  return Math.round(taxed);",
  "}",
  "",
  "export function cartSummary(items, coupon) {",
  "  const total = cartTotal(items, coupon);",
  "  return {",
  "    items: items.length,",
  "    total: formatMoney(total),",
  "  };",
  "}",
  "",
].join("\n");

const COUPONS_NEW = [
  "const RATES = Object.freeze({",
  "  BIENVENIDA: 0.1,",
  "  AMIGOS: 0.15,",
  "});",
  "",
  "export function couponRate(code) {",
  "  const key = String(code || \"\").trim().toUpperCase();",
  "  return RATES[key] || 0;",
  "}",
  "",
].join("\n");

const TEST_OLD = [
  "import test from \"node:test\";",
  "import assert from \"node:assert/strict\";",
  "import { cartTotal } from \"../src/cart.js\";",
  "test(\"suma los productos\", () => {",
  "  assert.equal(cartTotal([{ price: 100, qty: 1 }]), 119);",
  "});",
  "test(\"pendiente\", () => {});",
  "",
].join("\n");

const TEST_NEW = [
  "import test from \"node:test\";",
  "import assert from \"node:assert/strict\";",
  "import { cartTotal } from \"../src/cart.js\";",
  "test(\"suma los productos\", () => {",
  "  assert.equal(cartTotal([{ price: 100, qty: 1 }]), 119);",
  "});",
  "",
  "test(\"aplica el cupón antes del IVA\", () => {",
  "  const items = [{ price: 1000, qty: 2 }];",
  "  assert.equal(cartTotal(items, \"bienvenida\"), 2142);",
  "});",
  "",
].join("\n");

const FILES = [
  { sha: COMMITS[0][COMMIT.SHA], path: "src/cart.js", change: "M", old: CART_OLD, new: CART_NEW },
  { sha: COMMITS[0][COMMIT.SHA], path: "src/coupons.js", change: "A", new: COUPONS_NEW },
  { sha: COMMITS[0][COMMIT.SHA], path: "test/cart.test.js", change: "M", old: TEST_OLD, new: TEST_NEW },
  { sha: COMMITS[1][COMMIT.SHA], path: "src/money.js", oldPath: "src/price-utils.js", change: "R", old: PRICE_OLD, new: MONEY_NEW },
  { sha: COMMITS[1][COMMIT.SHA], path: "src/legacy-price.js", change: "D", old: LEGACY_OLD },
  { sha: COMMITS[2][COMMIT.SHA], path: "src/summary.js", change: "M", old: SUMMARY_OLD, new: SUMMARY_NEW },
];

const DIFFS = [
  {
    sha: COMMITS[3][COMMIT.SHA], path: "src/confirmed.html", change: "A",
    patch: "@@ -0,0 +1,10 @@\n+<section class=\"confirmed\">\n+  <h1>¡Pedido confirmado!</h1>\n+  <p>Te enviamos el resumen y el número de seguimiento.</p>\n+  <a class=\"btn\" href=\"/\">Volver a la tienda</a>\n+</section>\n+<style>\n+  .confirmed { display: grid; gap: 12px; padding: 24px; }\n+  .confirmed h1 { font-size: 28px; }\n+  .confirmed .btn { justify-self: start; }\n+</style>",
  },
  { sha: COMMITS[3][COMMIT.SHA], path: "assets/check.png", change: "A", patch: "Binary files /dev/null and b/assets/check.png differ" },
];

const REVIEWS = [
  {
    [REVIEW.ID]: "demo-review-0001",
    [REVIEW.SHA]: COMMITS[2][COMMIT.SHA],
    [REVIEW.BRANCH]: "main",
    [REVIEW.DECISION]: DECISION.APPROVED,
    [REVIEW.COMMENT]: "Bien, usa el mismo formato que el carrito.",
    [REVIEW.REVIEWER]: "Revisor",
    [REVIEW.AT]: "2026-10-18T08:10:00-05:00",
  },
  {
    [REVIEW.ID]: "demo-review-0002",
    [REVIEW.SHA]: COMMITS[1][COMMIT.SHA],
    [REVIEW.BRANCH]: "feature/carrito",
    [REVIEW.DECISION]: DECISION.COMMENT,
    [REVIEW.COMMENT]: "¿Alguien más usa toCents?",
    [REVIEW.REVIEWER]: "Revisor",
    [REVIEW.AT]: "2026-10-19T11:00:00-05:00",
  },
  {
    [REVIEW.ID]: "demo-review-0003",
    [REVIEW.SHA]: COMMITS[1][COMMIT.SHA],
    [REVIEW.BRANCH]: "feature/carrito",
    [REVIEW.DECISION]: DECISION.REJECTED,
    [REVIEW.COMMENT]: "formatMoney quedó con una línea fuera de la función.",
    [REVIEW.REVIEWER]: "Revisor",
    [REVIEW.AT]: "2026-10-19T11:20:00-05:00",
  },
];

function toValues(tab, rows) {
  const header = HEADERS[tab].concat(OPTIONAL[tab] || []);
  return [header.slice(), ...rows.map((row) => header.map((name) => String(row[name] ?? "")))];
}

function diffRow(item) {
  return {
    [DIFF.SHA]: item.sha,
    [DIFF.PATH]: item.path,
    [DIFF.CHANGE]: item.change,
    [DIFF.OLD_PATH]: item.oldPath || "",
    [DIFF.CHUNK]: "0",
    [DIFF.CHUNKS]: "1",
    [DIFF.PATCH]: item.patch,
  };
}

function fileRows(item) {
  const base = {
    [FILE.SHA]: item.sha,
    [FILE.PATH]: item.path,
    [FILE.CHANGE]: item.change,
    [FILE.OLD_PATH]: item.oldPath || "",
    [FILE.CHUNK]: "0",
    [FILE.CHUNKS]: "1",
  };
  const sides = [[FILE_SIDE.OLD, item.old], [FILE_SIDE.NEW, item.new]].filter(([, text]) => text != null);
  return sides.map(([side, text]) => ({ ...base, [FILE.SIDE]: side, [FILE.CONTENT]: text }));
}

function statsFor(sha) {
  const files = FILES.filter((item) => item.sha === sha);
  const patches = DIFFS.filter((item) => item.sha === sha);
  const parsed = files.map((item) => diffTexts(item.old, item.new)).concat(patches.map((item) => parsePatch(item.patch)));
  return {
    [COMMIT.FILES]: String(parsed.length),
    [COMMIT.ADDITIONS]: String(parsed.reduce((sum, item) => sum + item.additions, 0)),
    [COMMIT.DELETIONS]: String(parsed.reduce((sum, item) => sum + item.deletions, 0)),
  };
}

const wait = () => new Promise((resolve) => setTimeout(resolve, DELAY_MS));

export function createDemoBackend() {
  const commits = COMMITS.map((row) => ({
    ...row,
    ...statsFor(row[COMMIT.SHA]),
    [COMMIT.SHORT]: row[COMMIT.SHA].slice(0, 7),
    [COMMIT.REPO]: REPO,
    [COMMIT.UPLOADED]: row[COMMIT.DATE],
  }));
  const reviews = REVIEWS.map((row) => ({ ...row }));
  const diffs = DIFFS.map(diffRow);
  const files = FILES.flatMap(fileRows);
  return {
    demo: true,
    async ping() {
      await wait();
      return { ok: true, title: DEMO_TITLE, schema_version: String(SCHEMA_VERSION), commits: commits.length, reviews: reviews.length };
    },
    async load() {
      await wait();
      return {
        ok: true,
        title: DEMO_TITLE,
        schema_version: String(SCHEMA_VERSION),
        commits: toValues(TAB.COMMITS, commits),
        reviews: toValues(TAB.REVIEWS, reviews),
      };
    },
    async diffs(sha) {
      await wait();
      return {
        ok: true,
        sha,
        files: toValues(TAB.FILES, files.filter((row) => row[FILE.SHA] === sha)),
        diffs: toValues(TAB.DIFFS, diffs.filter((row) => row[DIFF.SHA] === sha)),
      };
    },
    async review(input) {
      await wait();
      const targets = commits.filter((row) => row[COMMIT.SHA] === input[REVIEW.SHA]
        && (!input[REVIEW.BRANCH] || row[COMMIT.BRANCH] === input[REVIEW.BRANCH]));
      if (!targets.length) throw new AppError(ERROR.NOT_FOUND, input[REVIEW.SHA]);
      const review = { ...input, [REVIEW.AT]: new Date().toISOString() };
      reviews.push(review);
      const status = DECISION_STATUS[review[REVIEW.DECISION]];
      if (status) targets.forEach((row) => { row[COMMIT.STATUS] = status; });
      return { ok: true, duplicate: false, review, status: status || targets[0][COMMIT.STATUS], rows: targets.length };
    },
  };
}
