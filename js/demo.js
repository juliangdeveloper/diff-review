import { COMMIT, DECISION, DECISION_STATUS, DIFF, ERROR, GRAPH, HEADERS, NODE, OPTIONAL, REVIEW, SCHEMA_VERSION, STATUS, TAB } from "./config.js";
import { AppError } from "./errors.js";
import { parsePatch } from "./diff.js";

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

const CART_PATCH = [
  "@@ -1,10 +1,17 @@",
  " import { formatMoney } from \"./money.js\";",
  "+import { couponRate } from \"./coupons.js\";",
  " ",
  " export function cartTotal(items, coupon) {",
  "-  const subtotal = items.reduce((sum, item) => sum + item.price, 0);",
  "-  return subtotal * 1.19;",
  "+  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);",
  "+  const discount = subtotal * couponRate(coupon);",
  "+  const taxed = (subtotal - discount) * 1.19;",
  "+  return Math.round(taxed);",
  " }",
  " ",
  " export function cartSummary(items, coupon) {",
  "-  return formatMoney(cartTotal(items));",
  "+  const total = cartTotal(items, coupon);",
  "+  return {",
  "+    items: items.length,",
  "+    total: formatMoney(total),",
  "+  };",
  " }",
].join("\n");

const COUPON_PATCH = [
  "@@ -0,0 +1,9 @@",
  "+const RATES = Object.freeze({",
  "+  BIENVENIDA: 0.1,",
  "+  AMIGOS: 0.15,",
  "+});",
  "+",
  "+export function couponRate(code) {",
  "+  const key = String(code || \"\").trim().toUpperCase();",
  "+  return RATES[key] || 0;",
  "+}",
].join("\n");

const TEST_PATCH = [
  "@@ -4,4 +4,8 @@ import { cartTotal } from \"../src/cart.js\";",
  " test(\"suma los productos\", () => {",
  "   assert.equal(cartTotal([{ price: 100, qty: 1 }]), 119);",
  " });",
  "+",
  "+test(\"aplica el cupón antes del IVA\", () => {",
  "+  const items = [{ price: 1000, qty: 2 }];",
  "+  assert.equal(cartTotal(items, \"bienvenida\"), 2142);",
  "+});",
  "-test(\"pendiente\", () => {});",
].join("\n");

const DIFFS = [
  { sha: COMMITS[0][COMMIT.SHA], path: "src/cart.js", change: "M", patch: CART_PATCH, label: "Total con descuento", order: "2", to: "test/cart.test.js" },
  { sha: COMMITS[0][COMMIT.SHA], path: "src/coupons.js", change: "A", patch: COUPON_PATCH, label: "Tasa del cupón", order: "1", to: "src/cart.js" },
  { sha: COMMITS[0][COMMIT.SHA], path: "test/cart.test.js", change: "M", patch: TEST_PATCH, label: "Prueba el cupón", order: "3" },
  {
    sha: COMMITS[1][COMMIT.SHA], path: "src/money.js", oldPath: "src/price-utils.js", change: "R",
    patch: "@@ -1,11 +1,3 @@\n-export function toCents(value) {\n-  return Math.round(value * 100);\n-}\n-\n-export function fromCents(value) {\n-  return value / 100;\n-}\n-\n export function formatMoney(value) {\n-  return \"$\" + value;\n+  return new Intl.NumberFormat(\"es-CO\", { style: \"currency\", currency: \"COP\" }).format(value);\n }",
  },
  { sha: COMMITS[1][COMMIT.SHA], path: "src/legacy-price.js", change: "D", patch: "@@ -1,2 +0,0 @@\n-export const LEGACY = true;\n-export default LEGACY;" },
  {
    sha: COMMITS[2][COMMIT.SHA], path: "src/summary.js", change: "M",
    patch: "@@ -8,4 +8,5 @@ export function renderSummary(order) {\n   const lines = order.items.map((item) => item.name);\n-  const total = \"$\" + order.total;\n-  return lines.concat(total).join(\"\\n\");\n+  const total = formatMoney(order.total);\n+  const header = `Pedido ${order.id}`;\n+  return [header, ...lines, total].join(\"\\n\");\n }\n\\ No newline at end of file",
  },
  {
    sha: COMMITS[3][COMMIT.SHA], path: "src/confirmed.html", change: "A",
    patch: "@@ -0,0 +1,10 @@\n+<section class=\"confirmed\">\n+  <h1>¡Pedido confirmado!</h1>\n+  <p>Te enviamos el resumen y el número de seguimiento.</p>\n+  <a class=\"btn\" href=\"/\">Volver a la tienda</a>\n+</section>\n+<style>\n+  .confirmed { display: grid; gap: 12px; padding: 24px; }\n+  .confirmed h1 { font-size: 28px; }\n+  .confirmed .btn { justify-self: start; }\n+</style>",
  },
  { sha: COMMITS[3][COMMIT.SHA], path: "assets/check.png", change: "A", patch: "Binary files /dev/null and b/assets/check.png differ" },
];

const STRUCTURE = [
  [0, "src/cart.js", "s1", "", "function", "cartTotal", "modified", "4", "(items, coupon)"],
  [0, "src/cart.js", "s2", "s1", "call", "const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);", "modified", "5", "reduce"],
  [0, "src/cart.js", "s3", "s1", "return", "return Math.round(taxed);", "modified", "8", ""],
  [0, "src/cart.js", "s4", "", "function", "cartSummary", "modified", "11", "(items, coupon)"],
  [0, "src/cart.js", "s5", "s4", "call", "const total = cartTotal(items, coupon);", "added", "12", "cartTotal"],
  [0, "src/cart.js", "s6", "s4", "return", "return { items: items.length, total: formatMoney(total), };", "modified", "13", ""],
  [0, "src/coupons.js", "s1", "", "module", "(módulo)", "added", "1", ""],
  [0, "src/coupons.js", "s2", "s1", "call", "const RATES = Object.freeze({ BIENVENIDA: 0.1, AMIGOS: 0.15, });", "added", "1", "freeze"],
  [0, "src/coupons.js", "s3", "", "function", "couponRate", "added", "6", "(code)"],
  [0, "src/coupons.js", "s4", "s3", "call", "const key = String(code || \"\").trim().toUpperCase();", "added", "7", "toUpperCase"],
  [0, "src/coupons.js", "s5", "s3", "return", "return RATES[key] || 0;", "added", "8", ""],
  [0, "test/cart.test.js", "s1", "", "module", "(módulo)", "unchanged", "1", ""],
  [0, "test/cart.test.js", "s2", "s1", "call", "test(\"aplica el cupón antes del IVA\", () => { const items = [{ price: 1000, qty…", "modified", "8", "test"],
  [0, "test/cart.test.js", "s3", "s1", "call", "assert.equal(cartTotal(items, \"bienvenida\"), 2142);", "added", "10", "equal"],
  [1, "src/money.js", "s1", "", "function", "toCents", "removed", "1", "(value)"],
  [1, "src/money.js", "s2", "s1", "return", "return Math.round(value * 100);", "removed", "2", ""],
  [1, "src/money.js", "s3", "", "function", "formatMoney", "modified", "1", "(value)"],
  [1, "src/money.js", "s4", "s3", "return", "return new Intl.NumberFormat(\"es-CO\", { style: \"currency\", currency: \"COP\" }).f…", "modified", "2", ""],
  [1, "src/money.js", "s5", "", "function", "fromCents", "removed", "5", "(value)"],
  [1, "src/money.js", "s6", "s5", "return", "return value / 100;", "removed", "6", ""],
  [1, "src/legacy-price.js", "s1", "", "module", "(módulo)", "removed", "1", ""],
  [2, "src/summary.js", "s1", "", "function", "renderSummary", "modified", "7", "(order)"],
  [2, "src/summary.js", "s2", "s1", "call", "const total = formatMoney(order.total);", "added", "9", "formatMoney"],
  [2, "src/summary.js", "s3", "s1", "return", "return [header, ...lines, total].join(\"\\n\");", "modified", "11", ""]
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
    [GRAPH.LABEL]: item.label || "",
    [GRAPH.ORDER]: item.order || "",
    [GRAPH.TO]: item.to || "",
  };
}

function statsFor(sha) {
  const files = DIFFS.filter((item) => item.sha === sha);
  const parsed = files.map((item) => parsePatch(item.patch));
  return {
    [COMMIT.FILES]: String(files.length),
    [COMMIT.ADDITIONS]: String(parsed.reduce((sum, item) => sum + item.additions, 0)),
    [COMMIT.DELETIONS]: String(parsed.reduce((sum, item) => sum + item.deletions, 0)),
  };
}

function structureRow([index, ...cells]) {
  const names = Object.values(NODE).slice(1);
  return Object.fromEntries([[NODE.SHA, COMMITS[index][COMMIT.SHA]], ...names.map((name, i) => [name, cells[i]])]);
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
  const structure = STRUCTURE.map(structureRow);
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
        diffs: toValues(TAB.DIFFS, diffs.filter((row) => row[DIFF.SHA] === sha)),
        structure: toValues(TAB.STRUCTURE, structure.filter((row) => row[NODE.SHA] === sha)),
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
