const axios = require("axios");
const crypto = require("crypto");

const MAX_MESSAGE_LENGTH = 4000;

function text(value, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeBoolean(value) {
  return value === true || ["true", "1", "yes", "да", "on"].includes(text(value).toLowerCase());
}

function resolveAdoptRoute(payload) {
  const location = text(payload.animalLocation).toLowerCase();
  if (location === "novokuznetskaya") {
    return { chatId: process.env.ALERTS_ADOPT_NOVO_CHAT_ID || process.env.ADOPT_TELEGRAM_CHAT_ID, threadId: process.env.ALERTS_ADOPT_NOVO_THREAD_ID || process.env.ADOPT_TELEGRAM_THREAD_ID, name: "adopt_novokuznetskaya" };
  }
  if (["prospekt_mira", "gilyarovskogo"].includes(location)) {
    return { chatId: process.env.ALERTS_ADOPT_PM_CHAT_ID || process.env.ADOPT_TELEGRAM_CHAT_ID, threadId: process.env.ALERTS_ADOPT_PM_THREAD_ID || process.env.ADOPT_TELEGRAM_THREAD_ID, name: "adopt_prospekt_mira" };
  }
  return { chatId: process.env.ALERTS_ADOPT_DEFAULT_CHAT_ID || process.env.ADOPT_TELEGRAM_CHAT_ID, threadId: process.env.ALERTS_ADOPT_DEFAULT_THREAD_ID || process.env.ADOPT_TELEGRAM_THREAD_ID, name: "adopt_default" };
}

function formatAdoptRequest(payload) {
  return [
    `🐈 Новая заявка ${text(payload.requestNumber || payload.requestId) || "без номера"}`,
    "",
    `Кошка: ${text(payload.animalName) || "не указана"}`,
    `Филиал: ${text(payload.animalLocationLabel || payload.animalLocation) || "не указан"}`,
    `Имя: ${text(payload.fullName) || "не указано"}`,
    `Телефон: ${text(payload.phone) || "не указан"}`,
    `Email: ${text(payload.email) || "не указан"}`,
    `Другие питомцы: ${normalizeBoolean(payload.hasOtherPets) ? "да" : "нет"}`,
    `Дети: ${normalizeBoolean(payload.hasChildren) ? "да" : "нет"}`,
    "",
    "Почему выбрали эту кошку:",
    text(payload.reason) || "не указано",
    "",
    "О себе:",
    text(payload.about) || "не указано",
  ].join("\n");
}

function formatSiteRequest(payload) {
  return ["Новая заявка с сайта", "", `Тип: ${text(payload.requestType) || "не указан"}`, `Страница: ${text(payload.page) || "не указана"}`, `Имя: ${text(payload.name) || "не указано"}`, `Телефон: ${text(payload.phone) || "не указан"}`, `Email: ${text(payload.email) || "не указан"}`, "", "Сообщение:", text(payload.message) || "не указано"].join("\n");
}

function validToken(candidate, expected) {
  const a = Buffer.from(String(candidate || ""));
  const b = Buffer.from(String(expected || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function isTemporary(error) {
  const status = error.response?.status;
  return !status || status >= 500;
}

async function postTelegram(token, payload) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, payload, { timeout: 10000 });
      if (!response.data?.ok) throw new Error("telegram_rejected");
      return { ok: true, messageId: response.data.result?.message_id || null };
    } catch (error) {
      lastError = error;
      if (attempt === 1 || !isTemporary(error)) break;
    }
  }
  const status = lastError?.response?.status || null;
  throw Object.assign(new Error("telegram_send_failed"), { status });
}

async function send(event) {
  if (!["adopt_request", "site_request"].includes(event.type)) throw new Error("unsupported_alert_type");
  const route = event.type === "adopt_request" ? resolveAdoptRoute(event.payload) : { chatId: process.env.ALERTS_SITE_REQUESTS_CHAT_ID, name: "site_requests" };
  const token = process.env.ALERTS_BOT_TOKEN;
  if (!token) throw new Error("alerts_bot_token_missing");
  if (!route.chatId) throw new Error("alert_chat_missing");
  const formatted = event.type === "adopt_request" ? formatAdoptRequest(event.payload) : formatSiteRequest(event.payload);
  const payload = { chat_id: route.chatId, text: formatted.slice(0, MAX_MESSAGE_LENGTH), disable_web_page_preview: true };
  const threadId = Number(route.threadId);
  if (Number.isInteger(threadId) && threadId > 0) payload.message_thread_id = threadId;
  const result = await postTelegram(token, payload);
  console.log("[alerts] sent", { type: event.type, requestId: text(event.payload.requestId, 100) || null, route: route.name, messageId: result.messageId });
  return { ...result, route: route.name };
}

function validateAdoptPayload(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const required = ["requestId", "animalId", "animalName", "fullName", "phone", "email", "reason", "about"];
  return required.every((key) => text(source[key]).length > 0);
}

function validateSiteRequestPayload(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  return ["name", "phone", "email", "message"].every((key) => text(source[key]).length > 0);
}

function createInternalAlertsRouter() {
  const express = require("express");
  const router = express.Router();
  router.post("/internal/alerts", async (req, res) => {
    if (!validToken(req.get("X-Internal-Token"), process.env.KOTOCATS_CORE_INTERNAL_TOKEN)) return res.status(401).json({ ok: false, error: "unauthorized" });
    const { type, payload } = req.body || {};
    if (!["adopt_request", "site_request"].includes(type)) return res.status(422).json({ ok: false, error: "unsupported_type" });
    if ((type === "adopt_request" && !validateAdoptPayload(payload)) || (type === "site_request" && !validateSiteRequestPayload(payload))) return res.status(400).json({ ok: false, error: "invalid_payload" });
    try {
      const result = await send({ type, payload });
      return res.status(202).json({ ok: true, result });
    } catch (error) {
      console.error("[alerts] failed", { type, requestId: text(payload.requestId, 100) || null, reason: error.message, status: error.status || null });
      return res.status(502).json({ ok: false, error: "delivery_failed" });
    }
  });
  return router;
}

module.exports = { createInternalAlertsRouter, send };
