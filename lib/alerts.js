const axios = require("axios");
const crypto = require("crypto");

const MAX_MESSAGE_LENGTH = 4000;
const CAFE_LABELS = { novokuznetskaya: "Новокузнецкая", prospekt_mira: "Проспект Мира" };
const CAFE_ALERT_TYPES = new Set(["feed_request", "adopt_request"]);

function text(value, max = 5000) { return String(value ?? "").trim().slice(0, max); }
function parseId(value, { positive = false } = {}) {
  const source = text(value);
  if (!/^-?\d+$/.test(source)) return null;
  const number = Number(source);
  return Number.isSafeInteger(number) && (!positive || number > 0) ? number : null;
}
function normalizeCafeCode(value) {
  const source = text(value).toLowerCase().replace(/[ё]/g, "е").replace(/[\s-]+/g, "_");
  if (["novokuznetskaya", "novokuz", "novokuznetsk", "1", "новокузнецкая", "павелецкая", "третьяковская"].includes(source)) return "novokuznetskaya";
  if (["prospekt_mira", "prospekt", "koteeshnaya", "гиляровского", "проспект_мира", "сухаревская"].includes(source)) return "prospekt_mira";
  return null;
}
function shouldSendAlertToCafe({ type, cafeCode }) {
  return CAFE_ALERT_TYPES.has(type) && Boolean(CAFE_LABELS[cafeCode]);
}
function configuredDestination(key, chatEnv, topicEnv, legacyChatEnv = [], legacyTopicEnv = []) {
  const chatId = parseId(process.env[chatEnv] || legacyChatEnv.map((name) => process.env[name]).find(Boolean));
  if (chatId === null) return null;
  return { key, chatId, messageThreadId: parseId(process.env[topicEnv] || legacyTopicEnv.map((name) => process.env[name]).find(Boolean), { positive: true }) };
}
function getAlertDestinations(alert) {
  const payload = alert.payload || {};
  const cafeCode = normalizeCafeCode(alert.cafeCode || alert.cafe_code || alert.location || payload.cafeCode || payload.cafe_code || payload.location || payload.animalLocation);
  const general = configuredDestination("general", "TELEGRAM_ALERTS_GENERAL_CHAT_ID", "TELEGRAM_ALERTS_GENERAL_TOPIC_ID", ["ALERTS_ADOPT_DEFAULT_CHAT_ID", "ADOPT_TELEGRAM_CHAT_ID", "ALERTS_SITE_REQUESTS_CHAT_ID"], ["ALERTS_ADOPT_DEFAULT_THREAD_ID", "ADOPT_TELEGRAM_THREAD_ID"]);
  const cafe = shouldSendAlertToCafe({ type: alert.type, cafeCode }) && cafeCode === "novokuznetskaya"
    ? configuredDestination(cafeCode, "TELEGRAM_ALERTS_NOVOKUZNETSKAYA_CHAT_ID", "TELEGRAM_ALERTS_NOVOKUZNETSKAYA_TOPIC_ID", ["ALERTS_ADOPT_NOVO_CHAT_ID", "ALERTS_FEED_NOVO_CHAT_ID"], ["ALERTS_ADOPT_NOVO_THREAD_ID", "ALERTS_FEED_NOVO_THREAD_ID"])
    : shouldSendAlertToCafe({ type: alert.type, cafeCode }) && cafeCode === "prospekt_mira"
      ? configuredDestination(cafeCode, "TELEGRAM_ALERTS_PROSPEKT_MIRA_CHAT_ID", "TELEGRAM_ALERTS_PROSPEKT_MIRA_TOPIC_ID", ["ALERTS_ADOPT_PM_CHAT_ID", "ALERTS_FEED_PM_CHAT_ID"], ["ALERTS_ADOPT_PM_THREAD_ID", "ALERTS_FEED_PM_THREAD_ID"])
      : null;
  if (!cafeCode && text(alert.location || payload.location || payload.animalLocation)) console.warn("[alerts] unknown_cafe", { alert_type: text(alert.type, 100), normalized_cafe_code: null });
  return [...new Map([general, cafe].filter(Boolean).map((d) => [`${d.chatId}:${d.messageThreadId || ""}`, d])).values()];
}
function formatMessage(alert) {
  const p = alert.payload || {}; const cafe = normalizeCafeCode(alert.cafeCode || alert.cafe_code || alert.location || p.cafeCode || p.cafe_code || p.location || p.animalLocation);
  const title = { feed_request: "🍽 Покормить котика", adopt_request: "🏠 Заявка на укотовление", booking_request: "📅 Бронирование", site_request: "📩 Заявка с сайта" }[alert.type] || "📩 Новая заявка";
  const lines = [title];
  if (cafe) lines.push(`Кафе: ${CAFE_LABELS[cafe]}`);
  const fields = [["Котик", p.animalName], ["Имя", p.fullName || p.name || p.customerName], ["Телефон", p.phone || p.messengerContact], ["Email", p.email], ["Сумма", p.amount && `${p.amount} ₽`], ["Сообщение", p.message || p.comment]];
  for (const [label, value] of fields) if (text(value)) lines.push(`${label}: ${text(value, 1000)}`);
  return lines.join("\n").slice(0, MAX_MESSAGE_LENGTH);
}
function validToken(candidate, expected) { const a = Buffer.from(String(candidate || "")); const b = Buffer.from(String(expected || "")); return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b); }
function maskedChatId(chatId) { const id = String(chatId); return id.length <= 4 ? "****" : `***${id.slice(-4)}`; }
async function sendTelegramAlertToDestination(destination, message, client = axios) {
  const token = process.env.ALERTS_BOT_TOKEN;
  if (!token) throw new Error("alerts_bot_token_missing");
  const payload = { chat_id: destination.chatId, text: message, disable_web_page_preview: true };
  if (destination.messageThreadId) payload.message_thread_id = destination.messageThreadId;
  try {
    const response = await client.post(`https://api.telegram.org/bot${token}/sendMessage`, payload, { timeout: 10000 });
    if (!response.data?.ok) throw Object.assign(new Error("telegram_send_failed"), { status: null });
  } catch (error) {
    throw Object.assign(new Error("telegram_send_failed"), { status: error?.response?.status || error?.status || null });
  }
}
async function dispatchTelegramAlert(alert, client = axios) {
  const destinations = getAlertDestinations(alert); const message = formatMessage(alert);
  if (!destinations.length) return { ok: false, partial: false, deliveries: [] };
  const settled = await Promise.allSettled(destinations.map((destination) => sendTelegramAlertToDestination(destination, message, client)));
  const deliveries = settled.map((result, index) => { const destination = destinations[index]; const ok = result.status === "fulfilled"; console.log("[alerts] delivery", { alert_type: text(alert.type, 100), normalized_cafe_code: normalizeCafeCode(alert.cafeCode || alert.cafe_code || alert.location || alert.payload?.animalLocation), destination: destination.key, chat_id_masked: maskedChatId(destination.chatId), message_thread_id: destination.messageThreadId, delivery_status: ok ? "sent" : "failed", telegram_status: ok ? null : (result.reason?.status || null) }); return { destination: destination.key, ok, ...(ok ? {} : { error: "telegram_send_failed" }) }; });
  return { ok: deliveries.every((item) => item.ok), partial: deliveries.some((item) => item.ok) && deliveries.some((item) => !item.ok), deliveries };
}
function createInternalAlertsRouter() { const express = require("express"); const router = express.Router(); router.post("/internal/alerts", async (req, res) => { if (!validToken(req.get("X-Internal-Token"), process.env.KOTOCATS_CORE_INTERNAL_TOKEN)) return res.status(401).json({ ok: false, error: "unauthorized" }); const alert = req.body || {}; if (!text(alert.type)) return res.status(422).json({ ok: false, error: "unsupported_type" }); const result = await dispatchTelegramAlert(alert); return res.status(result.ok ? 202 : 502).json(result); }); return router; }
module.exports = { normalizeCafeCode, shouldSendAlertToCafe, getAlertDestinations, sendTelegramAlertToDestination, dispatchTelegramAlert, createInternalAlertsRouter };
