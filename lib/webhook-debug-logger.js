"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MAX_BODY_CHARS = 20000;
const DEFAULT_DIR = "/opt/exports/webhooks";
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const SENSITIVE_KEY = /secret|token|password|authorization|cookie|signature|api[-_]?key|(?:^|[_-])sign(?:ature)?(?:$|[_-])/i;
const PAYMENT_KEY = /(?:card|pan|cvv|cvc|payment[_-]?token)/i;
const EMAIL_KEY = /email/i;
const PHONE_KEY = /(?:phone|telephone|mobile|msisdn)/i;
let lastCleanupAt = 0;

function enabled() {
  return ["1", "true", "yes", "on"].includes(String(process.env.WEBHOOK_DEBUG || "").toLowerCase());
}

function debugDir() { return process.env.WEBHOOK_DEBUG_DIR || DEFAULT_DIR; }
function positiveNumber(value, fallback) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : fallback; }
function retentionDays() { return positiveNumber(process.env.WEBHOOK_DEBUG_RETENTION_DAYS, 7); }
function maxFiles() { return Math.floor(positiveNumber(process.env.WEBHOOK_DEBUG_MAX_FILES, 1000)); }

function maskEmail(value) {
  const text = String(value || ""); const at = text.indexOf("@");
  if (at < 1) return "***";
  return `${text.slice(0, 1)}***@${text.slice(at + 1)}`;
}

function maskPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 5) return "***";
  return `${digits.slice(0, 2)}***${digits.slice(-2)}`;
}

function maskCard(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 6 ? `${digits.slice(0, 6)}******${digits.slice(-4)}` : "***";
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""), "http://localhost");
    for (const key of url.searchParams.keys()) if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, "***");
    return url.pathname + (url.search || "");
  } catch (_) {
    return String(value || "").replace(/([?&](?:secret|token|password|authorization|cookie|signature|api[-_]?key)=[^&\s]+)/gi, (part) => `${part.split("=")[0]}=***`);
  }
}

function safeValue(value, key = "", seen = new WeakSet()) {
  try {
    const name = String(key || "");
    if (SENSITIVE_KEY.test(name) && !(typeof value === "boolean" && /signature(?:Present|Valid)$/i.test(name))) return "***";
    if (PAYMENT_KEY.test(name)) return maskCard(value);
    if (EMAIL_KEY.test(name)) return maskEmail(value);
    if (PHONE_KEY.test(name)) return maskPhone(value);
    if (Buffer.isBuffer(value)) return `[Buffer length=${value.length}]`;
    if (value === null || value === undefined || typeof value !== "object") return value;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => safeValue(item, "", seen));
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, safeValue(childValue, childKey, seen)]));
  } catch (_) { return "[Unserializable]"; }
}

function safeRawBody(rawBody, contentType) {
  try {
    const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "");
    const originalLength = text.length;
    let value = text;
    try { value = JSON.parse(text); } catch (_) {
      if (/^[^=&\s]+=[\s\S]*$/.test(text)) value = Object.fromEntries(new URLSearchParams(text));
    }
    const safe = safeValue(value);
    const serialized = typeof safe === "string" ? safe.replace(/((?:secret|token|password|authorization|cookie|signature|api_key)=[^&\s]+)/gi, (part) => `${part.split("=")[0]}=***`) : JSON.stringify(safe);
    if (serialized.length <= MAX_BODY_CHARS) return { value: serialized, truncated: false, originalLength };
    return { value: serialized.slice(0, MAX_BODY_CHARS), truncated: true, originalLength };
  } catch (_) { return { value: "[Unserializable raw body]", truncated: false, originalLength: 0 }; }
}

function write(level, label, data) { try { console[level](label, safeValue(data)); } catch (_) {} }

async function cleanupDebugFiles(directory = debugDir(), now = Date.now()) {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = path.join(directory, entry.name);
    const stat = await fs.promises.stat(file);
    files.push({ file, mtimeMs: stat.mtimeMs });
  }
  const expiredBefore = now - retentionDays() * 24 * 60 * 60 * 1000;
  const retained = [];
  for (const item of files) {
    if (item.mtimeMs < expiredBefore) await fs.promises.unlink(item.file);
    else retained.push(item);
  }
  retained.sort((a, b) => b.mtimeMs - a.mtimeMs);
  await Promise.all(retained.slice(maxFiles()).map((item) => fs.promises.unlink(item.file)));
}

function scheduleCleanup(directory) {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  void cleanupDebugFiles(directory, now).catch((error) => write("warn", "[webhook] debug cleanup failed", { error: error?.message || String(error) }));
}

async function writeSnapshot(directory, filename, snapshot) {
  const file = path.join(directory, filename);
  const temporary = path.join(directory, `.${filename}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o750 });
    await fs.promises.chmod(directory, 0o750);
    await fs.promises.writeFile(temporary, JSON.stringify(safeValue(snapshot), null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    await fs.promises.rename(temporary, file);
    await fs.promises.chmod(file, 0o640);
    return file;
  } catch (error) {
    try { await fs.promises.unlink(temporary); } catch (_) {}
    write("warn", "[webhook] debug file write failed", { error: error?.message || String(error), directory });
    return null;
  }
}

function createWebhookDebugLogger(req, res, { provider = "webhook" } = {}) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const receivedAt = new Date(startedAt).toISOString();
  const contentType = req.get?.("content-type") || req.headers?.["content-type"] || null;
  const snapshot = {
    requestId, receivedAt, updatedAt: receivedAt, source: provider, method: req.method || null,
    path: new URL(req.originalUrl || req.url || "/", "http://localhost").pathname,
    originalUrl: safeUrl(req.originalUrl || req.url || "/"), remoteIp: req.ip || req.socket?.remoteAddress || null,
    headers: req.headers || {}, query: req.query || {}, rawBody: null, parsedBody: null,
    stage: "received", result: null, httpStatus: null, paymentStatus: null, error: null,
  };
  const directory = debugDir();
  const filename = `${receivedAt.replace(/[:.]/g, "-")}-${requestId}.json`;
  let writeQueue = Promise.resolve();
  function persist() {
    if (!enabled()) return;
    snapshot.updatedAt = new Date().toISOString(); scheduleCleanup(directory);
    writeQueue = writeQueue.then(() => writeSnapshot(directory, filename, snapshot));
  }
  persist();
  const api = {
    requestId, enabled,
    received({ body, rawBody } = {}) {
      if (body !== undefined) snapshot.parsedBody = body;
      else if (req.body !== undefined) snapshot.parsedBody = req.body;
      if (rawBody !== undefined) snapshot.rawBody = safeRawBody(rawBody, contentType);
      snapshot.stage = "received"; persist();
      if (enabled()) write("info", "[webhook] received", { ...snapshot });
    },
    stage(stage, data = {}) {
      snapshot.stage = stage; Object.assign(snapshot, data);
      if (data.paymentStatus !== undefined) snapshot.paymentStatus = data.paymentStatus;
      persist(); if (enabled()) write("info", "[webhook] stage", { requestId, provider, stage, ...data });
    },
    error(error, data = {}) {
      snapshot.stage = data.stage || "failed"; snapshot.result = "failed"; snapshot.error = { name: error?.name || "Error", message: error?.message || String(error) };
      Object.assign(snapshot, data); persist();
      write("error", "[webhook] error", { requestId, provider, ...data, error: snapshot.error });
    },
  };
  try { res.once("finish", () => { snapshot.httpStatus = res.statusCode || null; snapshot.result = snapshot.result || (res.statusCode >= 400 ? "failed" : "completed"); snapshot.stage = snapshot.result === "failed" ? "failed" : "completed"; persist(); if (enabled()) write("info", "[webhook] completed", { requestId, provider, statusCode: res.statusCode, durationMs: Date.now() - startedAt }); }); } catch (_) {}
  return api;
}

module.exports = { createWebhookDebugLogger, safeValue, safeRawBody, enabled, cleanupDebugFiles, writeSnapshot, MAX_BODY_CHARS };
