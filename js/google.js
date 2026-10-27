import { SCOPES, SCRIPT_TIMEOUT_MS, SHEET_MIME, STORAGE, TOKEN_MARGIN_MS, URLS } from "./config.js";

const PROJECT_SEPARATOR = "-";
const SECONDS_TO_MS = 1000;

export class AppError extends Error {
  constructor(code, detail = "") {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

export const ERROR = Object.freeze({
  NO_CLIENT: "no_client",
  NO_SHEET: "no_sheet",
  AUTH: "auth",
  ACCESS: "access",
  SCRIPT: "script",
  PICKER: "picker",
  TABS: "tabs",
  HEADERS: "headers",
  SCHEMA: "schema",
  HTTP: "http",
  NOT_FOUND: "not_found",
});

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const found = document.querySelector(`script[data-src="${src}"]`);
    if (found?.dataset.loaded) {
      resolve();
      return;
    }
    const script = found || document.createElement("script");
    const timer = setTimeout(() => reject(new AppError(ERROR.SCRIPT)), SCRIPT_TIMEOUT_MS);
    script.dataset.src = src;
    script.src = src;
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new AppError(ERROR.SCRIPT));
    };
    if (!found) document.head.appendChild(script);
  });
}

export function readStoredToken() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE.TOKEN) || "null");
    if (saved?.token && saved.expiresAt - TOKEN_MARGIN_MS > Date.now()) return saved;
  } catch (e) {
    return null;
  }
  return null;
}

export function clearStoredToken() {
  try {
    sessionStorage.removeItem(STORAGE.TOKEN);
  } catch (e) {
    return;
  }
}

function storeToken(saved) {
  try {
    sessionStorage.setItem(STORAGE.TOKEN, JSON.stringify(saved));
  } catch (e) {
    return;
  }
}

export async function signIn(clientId) {
  if (!clientId) throw new AppError(ERROR.NO_CLIENT);
  await loadScript(URLS.GSI);
  const oauth = globalThis.google?.accounts?.oauth2;
  if (!oauth) throw new AppError(ERROR.SCRIPT);
  const response = await new Promise((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: clientId,
      scope: SCOPES.join(" "),
      include_granted_scopes: true,
      callback: (res) => (res?.access_token ? resolve(res) : reject(new AppError(ERROR.AUTH, res?.error || ""))),
      error_callback: (err) => reject(new AppError(ERROR.AUTH, err?.type || "")),
    });
    client.requestAccessToken({ prompt: "" });
  });
  const saved = {
    token: response.access_token,
    expiresAt: Date.now() + Number(response.expires_in || 0) * SECONDS_TO_MS,
    email: "",
  };
  saved.email = await fetchEmail(saved.token);
  storeToken(saved);
  return saved;
}

async function fetchEmail(token) {
  try {
    const res = await fetch(URLS.USERINFO, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return "";
    const info = await res.json();
    return String(info?.email || "");
  } catch (e) {
    return "";
  }
}

export function revoke(token) {
  clearStoredToken();
  const oauth = globalThis.google?.accounts?.oauth2;
  if (token && oauth?.revoke) oauth.revoke(token, () => {});
}

export async function pickSheet({ clientId, apiKey, token }) {
  if (!clientId) throw new AppError(ERROR.NO_CLIENT);
  await loadScript(URLS.GAPI);
  const gapi = globalThis.gapi;
  if (!gapi?.load) throw new AppError(ERROR.PICKER);
  await new Promise((resolve, reject) => {
    gapi.load("picker", { callback: resolve, onerror: () => reject(new AppError(ERROR.PICKER)) });
  });
  const picker = globalThis.google?.picker;
  if (!picker) throw new AppError(ERROR.PICKER);
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.SPREADSHEETS);
    view.setMimeTypes(SHEET_MIME);
    const builder = new picker.PickerBuilder()
      .setOAuthToken(token)
      .setAppId(clientId.split(PROJECT_SEPARATOR)[0])
      .setLocale("es")
      .setTitle("Elige la hoja de revisión")
      .addView(view)
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED && data.docs?.[0]?.id) {
          resolve({ id: data.docs[0].id, name: data.docs[0].name || "" });
        } else if (data.action === picker.Action.CANCEL) {
          resolve(null);
        }
      });
    if (apiKey) builder.setDeveloperKey(apiKey);
    builder.build().setVisible(true);
  });
}
