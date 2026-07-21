"use strict";

const crypto = require("crypto");

const MAX_BODY_CHARS = 20000;
const SENSITIVE_KEY = /secret|token|password|authorization|cookie|signature|api[-_]?key|(?:^|[_-])sign(?:ature)?(?:$|[_-])/i;
const PAYMENT_KEY = /(?:card|pan|cvv|cvc|payment[_-]?token)/i;
const EMAIL_KEY = /email/i;
const PHONE_KEY = /(?:phone|telephone|mobile|msisdn)/i;

function enabled() {
  return ["1", "true", "yes", "on"].includes(String(process.env.WEBHOOK_DEBUG || "").toLowerCase());
}

function maskEmail(value) {
  const text = String(value || "");
  const at = text.indexOf("@");
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
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, "***");
    }
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
  } catch (_) {
    return "[Unserializable]";
  }
}

function safeRawBody(rawBody, contentType) {
  try {
    const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "");
    const originalLength = text.length;
    let value = text;
    if (String(contentType || "").includes("application/json")) {
      try { value = JSON.parse(text); } catch (_) {}
    } else if (/^[^=&\s]+=[\s\S]*$/.test(text)) {
      value = Object.fromEntries(new URLSearchParams(text));
    }
    const safe = safeValue(value);
    const serialized = typeof safe === "string" ? safe.replace(/((?:secret|token|password|authorization|cookie|signature|api_key)=[^&\s]+)/gi, (part) => `${part.split("=")[0]}=***`) : JSON.stringify(safe);
    if (serialized.length <= MAX_BODY_CHARS) return { value: serialized, truncated: false, originalLength };
    return { value: serialized.slice(0, MAX_BODY_CHARS), truncated: true, originalLength };
  } catch (_) {
    return { value: "[Unserializable raw body]", truncated: false, originalLength: 0 };
  }
}

function write(level, label, data) {
  try { console[level](label, safeValue(data)); } catch (_) {}
}

function createWebhookDebugLogger(req, res, { provider = "webhook" } = {}) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const base = {
    timestamp: new Date().toISOString(), requestId, provider, method: req.method,
    originalUrl: safeUrl(req.originalUrl || req.url || "/"),
    pathname: new URL(req.originalUrl || req.url || "/", "http://localhost").pathname,
    ip: req.ip || req.socket?.remoteAddress || null,
    xForwardedFor: req.get?.("x-forwarded-for") || req.headers?.["x-forwarded-for"] || null,
    userAgent: req.get?.("user-agent") || req.headers?.["user-agent"] || null,
    contentType: req.get?.("content-type") || req.headers?.["content-type"] || null,
    contentLength: req.get?.("content-length") || req.headers?.["content-length"] || null,
  };
  const api = {
    requestId, enabled,
    received({ body, rawBody } = {}) {
      if (!enabled()) return;
      const details = { ...base, query: req.query || {}, headers: req.headers || {}, parsedBody: body === undefined ? req.body : body };
      if (rawBody !== undefined) details.rawBody = safeRawBody(rawBody, base.contentType);
      write("info", "[webhook] received", details);
    },
    stage(stage, data = {}) { if (enabled()) write("info", "[webhook] stage", { requestId, provider, stage, ...data }); },
    error(error, data = {}) {
      write("error", "[webhook] error", { requestId, provider, ...data, error: { name: error?.name || "Error", message: safeUrl(error?.message || String(error)), stack: String(error?.stack || "").replace(/([?&](?:secret|token|password|authorization|cookie|signature|api[-_]?key)=[^&\s]+)/gi, (part) => `${part.split("=")[0]}=***`) || null } });
    },
  };
  try {
    res.once("finish", () => {
      if (enabled()) write("info", "[webhook] completed", { requestId, provider, statusCode: res.statusCode, durationMs: Date.now() - startedAt });
    });
  } catch (_) {}
  return api;
}

module.exports = { createWebhookDebugLogger, safeValue, safeRawBody, enabled };
