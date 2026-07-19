const crypto = require("crypto");
const { send } = require("./alerts");
const { sendAdoptConfirmationEmail } = require("./mail");

function text(value, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

function validToken(candidate, expected) {
  const actual = Buffer.from(String(candidate || ""));
  const configured = Buffer.from(String(expected || ""));
  return actual.length === configured.length && actual.length > 0 && crypto.timingSafeEqual(actual, configured);
}

function isLoopback(req) {
  const address = String(req.socket?.remoteAddress || "");
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function validPayload(payload) {
  const required = ["requestId", "requestNumber", "animalId", "animalName", "fullName", "phone", "email", "reason", "about", "catUrl", "createdAt"];
  return payload && typeof payload === "object" && required.every((key) => text(payload[key]).length > 0);
}

function channelResult(result) {
  return result.status === "fulfilled" ? { ok: true } : { ok: false };
}

function logFailure(channel, payload, error) {
  console.error("[adoption-notifications] failed", {
    channel,
    requestId: text(payload.requestNumber || payload.requestId, 100) || null,
    reason: text(error?.message || "delivery_failed", 120),
    status: error?.status || error?.response?.status || null,
  });
}

function createInternalAdoptionNotificationsRouter({ sendAlert = send, sendEmail = sendAdoptConfirmationEmail } = {}) {
  const express = require("express");
  const router = express.Router();
  router.post("/internal/adoption-notifications", async (req, res) => {
    if (!isLoopback(req) || !validToken(req.get("X-Internal-Token"), process.env.KOTOCATS_CORE_INTERNAL_TOKEN)) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    const payload = req.body?.payload;
    if (req.body?.type !== "adopt_request") return res.status(422).json({ ok: false, error: "unsupported_type" });
    if (!validPayload(payload)) return res.status(400).json({ ok: false, error: "invalid_payload" });

    const [telegram, email] = await Promise.allSettled([
      sendAlert({ type: "adopt_request", payload }),
      sendEmail(payload),
    ]);
    if (telegram.status === "rejected") logFailure("telegram", payload, telegram.reason);
    if (email.status === "rejected") logFailure("email", payload, email.reason);
    return res.status(202).json({
      ok: true,
      notifications: { telegram: channelResult(telegram), email: channelResult(email) },
    });
  });
  return router;
}

module.exports = { createInternalAdoptionNotificationsRouter, validPayload };
