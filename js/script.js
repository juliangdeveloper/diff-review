import { ACTION, ERROR, LEGACY_STORAGE, REQUEST_TIMEOUT_MS, STORAGE } from "./config.js";
import { AppError } from "./errors.js";

const EXEC_SUFFIX = "/exec";
const SECURE = "https:";
const PLAIN = "http:";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const TEXT_TYPE = "text/plain;charset=UTF-8";

export function connectionError(url, key) {
  const trimmed = String(url ?? "").trim();
  const secret = String(key ?? "");
  if (!trimmed || !secret.trim()) return "Escribe la URL /exec y la clave.";
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (e) {
    return "Esa URL no es válida.";
  }
  const local = LOCAL_HOSTS.has(parsed.hostname);
  if (!(parsed.protocol === SECURE || (parsed.protocol === PLAIN && local))) return "La URL tiene que empezar por https.";
  if (!parsed.pathname.endsWith(EXEC_SUFFIX)) return "Usa la URL que termina en /exec.";
  return "";
}

export function cleanLegacy(local, session) {
  for (const store of [local, session]) {
    if (!store) continue;
    for (const key of LEGACY_STORAGE) {
      try {
        store.removeItem(key);
      } catch (e) {
        continue;
      }
    }
  }
}

export function loadConnection(storage) {
  try {
    const raw = JSON.parse(storage.getItem(STORAGE.CONNECTION) || "null");
    if (!raw || typeof raw.url !== "string" || typeof raw.key !== "string") return null;
    if (connectionError(raw.url, raw.key)) return null;
    return { url: raw.url.trim(), key: raw.key };
  } catch (e) {
    return null;
  }
}

export function saveConnection(storage, connection) {
  try {
    storage.setItem(STORAGE.CONNECTION, JSON.stringify({ url: connection.url, key: connection.key }));
  } catch (e) {
    return;
  }
}

export function clearConnection(storage) {
  try {
    storage.removeItem(STORAGE.CONNECTION);
  } catch (e) {
    return;
  }
}

async function request(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, { cache: "no-store", redirect: "follow", signal: controller.signal, ...options });
  } catch (e) {
    throw new AppError(controller.signal.aborted ? ERROR.TIMEOUT : ERROR.NETWORK);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new AppError(ERROR.URL, String(response.status));
  let body;
  try {
    body = await response.json();
  } catch (e) {
    throw new AppError(ERROR.URL);
  }
  if (!body || typeof body !== "object") throw new AppError(ERROR.URL);
  if (body.ok !== true) throw new AppError(body.error, body.detail || "");
  return body;
}

export function createScriptBackend(connection) {
  const get = (action, params = {}) => {
    const endpoint = new URL(connection.url);
    endpoint.searchParams.set("action", action);
    for (const [name, value] of Object.entries(params)) endpoint.searchParams.set(name, value);
    endpoint.searchParams.set("key", connection.key);
    return request(endpoint.toString(), { method: "GET" });
  };
  const post = (action, payload) => request(connection.url, {
    method: "POST",
    headers: { "Content-Type": TEXT_TYPE },
    body: JSON.stringify({ key: connection.key, action, ...payload }),
  });
  return {
    demo: false,
    ping: () => get(ACTION.PING),
    load: () => get(ACTION.LOAD),
    diffs: (sha) => get(ACTION.DIFFS, { sha }),
    review: (review) => post(ACTION.REVIEW, { review }),
  };
}
