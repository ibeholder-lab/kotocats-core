const express = require("express");
const axios = require("axios");

const { createCatDonationPayment } = require("../lib/payments/mixplat");

const router = express.Router();
const DONATIONS_COLLECTION =
  process.env.MIXPLAT_DONATIONS_COLLECTION || "animals_donations";
const DONATION_READ_FIELDS = [
  "id",
  "animal_id",
  "payment_id",
  "mixplat_transaction_id",
  "payment_type",
  "amount",
  "currency",
  "status",
  "telegram_id",
  "donor_name",
  "comment",
  "raw_request",
  "raw_response",
  "created_at",
  "paid_at",
].join(",");

function normalizeText(value, maxLen = 500) {
  return String(value || "").trim().slice(0, maxLen);
}

function normalizeNullable(value, maxLen = 500) {
  const text = normalizeText(value, maxLen);
  return text || null;
}

function normalizeAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 300;
}

function directusUrl() {
  return String(process.env.DIRECTUS_URL || "").replace(/\/$/, "");
}

function directusHeaders() {
  if (!process.env.DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_TOKEN is required");
  }

  return {
    Authorization: `Bearer ${process.env.DIRECTUS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

function internalAuthorized(req) {
  const expected = String(process.env.KOTOCATS_CORE_INTERNAL_TOKEN || "").trim();
  if (!expected) return true;

  const supplied = String(
    req.headers["x-kotocats-core-token"] ||
      req.headers.authorization ||
      "",
  )
    .replace(/^Bearer\s+/i, "")
    .trim();

  return supplied === expected;
}

function requireInternalAuth(req, res, next) {
  if (!internalAuthorized(req)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  return next();
}

async function directusGet(params = {}) {
  const response = await axios.get(
    `${directusUrl()}/items/${DONATIONS_COLLECTION}`,
    {
      headers: directusHeaders(),
      params,
      timeout: Number(process.env.DIRECTUS_TIMEOUT_MS || 30000),
    },
  );
  return response.data.data || [];
}

async function directusPatch(id, data) {
  const response = await axios.patch(
    `${directusUrl()}/items/${DONATIONS_COLLECTION}/${encodeURIComponent(id)}`,
    data,
    {
      headers: directusHeaders(),
      timeout: Number(process.env.DIRECTUS_TIMEOUT_MS || 30000),
    },
  );
  return response.data.data;
}

router.post("/create", async (req, res) => {
  try {
    const body = req.body || {};
    const telegramContext =
      body.telegram_context && typeof body.telegram_context === "object"
        ? body.telegram_context
        : {};
    const rawExtra =
      body.raw_request_extra && typeof body.raw_request_extra === "object"
        ? body.raw_request_extra
        : {};

    const animalId = normalizeText(body.animal_id || body.animalId, 100);
    const animalName = normalizeText(
      body.animal_name || body.animalName || "Кошка",
      200,
    );

    if (!animalId) {
      return res.status(400).json({ ok: false, error: "animal_id is required" });
    }

    const paymentType =
      normalizeText(body.payment_type || body.paymentType || "donate", 20) ===
      "feed"
        ? "feed"
        : "donate";

    const successUrl = normalizeText(body.success_url || body.successUrl, 1000);
    const failureUrl = normalizeText(body.failure_url || body.failureUrl, 1000);

    const payment = await createCatDonationPayment({
      animal: { id: animalId, name: animalName },
      amountRub: normalizeAmount(body.amount ?? body.amountRub),
      paymentType,
      source: normalizeText(
        body.source ||
          (paymentType === "feed"
            ? "koshkivgorode-site-feed"
            : "koshkivgorode-site"),
        100,
      ),
      needId: normalizeNullable(body.need_id || body.needId, 100),
      needTitle: normalizeNullable(body.need_title || body.needTitle, 300),
      comment: normalizeNullable(
        body.comment ||
          (paymentType === "feed"
            ? `Вкусняшка для кошки по имени ${animalName}`
            : `Донат для кошки по имени ${animalName}`),
        500,
      ),
      publicThanks:
        body.public_thanks === true || body.public_thanks === false
          ? body.public_thanks
          : null,
      askPublicThanksAfterPayment: Boolean(
        body.ask_public_thanks_after_payment ||
          body.askPublicThanksAfterPayment,
      ),
      donorTelegramId:
        body.donor_telegram_id || body.donorTelegramId || null,
      donorUsername: normalizeNullable(
        body.donor_username || body.donorUsername,
        200,
      ),
      donorFirstName: normalizeNullable(
        body.donor_first_name || body.donorFirstName,
        200,
      ),
      donorLastName: normalizeNullable(
        body.donor_last_name || body.donorLastName,
        200,
      ),
      donorPhone: normalizeNullable(body.donor_phone || body.donorPhone, 50),
      donorEmail: normalizeNullable(body.donor_email || body.donorEmail, 200),
      sourceChatId:
        telegramContext.sourceChatId ||
        telegramContext.source_chat_id ||
        body.source_chat_id ||
        null,
      sourceMessageId:
        telegramContext.sourceMessageId ||
        telegramContext.source_message_id ||
        body.source_message_id ||
        null,
      sourceThreadId:
        telegramContext.sourceThreadId ||
        telegramContext.source_thread_id ||
        body.source_thread_id ||
        null,
      thanksChatId:
        telegramContext.thanksChatId ||
        telegramContext.thanks_chat_id ||
        body.thanks_chat_id ||
        null,
      thanksThreadId:
        telegramContext.thanksThreadId ||
        telegramContext.thanks_thread_id ||
        body.thanks_thread_id ||
        null,
      successUrl,
      failureUrl,
      rawRequestExtra: {
        ...rawExtra,
        messenger: normalizeNullable(body.messenger, 30),
        success_url: successUrl || null,
        failure_url: failureUrl || null,
      },
    });

    return res.json({
      ok: true,
      donation_id: payment.donation_id,
      amount: payment.amount,
      payment_id: payment.payment_id,
      redirect_url: payment.redirect_url,
    });
  } catch (error) {
    console.error("DONATION CREATE ERROR:", error.response?.data || error.message);
    return res.status(500).json({
      ok: false,
      error: "donation_create_failed",
      message: error.message,
    });
  }
});

router.get("/thanks-queue", requireInternalAuth, async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(Number(req.query.limit || 20), 1),
      100
    );

    const rows = await directusGet({
      filter: {
        status: { _eq: "success" }
      },
      fields: DONATION_READ_FIELDS,
      sort: "-created_at",
      limit: 500,
    });

    const queue = rows
      .filter((row) => {
        const rawRequest =
          row.raw_request &&
          typeof row.raw_request === "object"
            ? row.raw_request
            : {};

        const sourceChatId =
          rawRequest.thanks_chat_id ??
          rawRequest.source_chat_id ??
          null;

        const sourceMessageId =
          rawRequest.source_message_id ??
          null;

        const alreadySent =
          row.public_thanks_sent === true;

        return (
          sourceChatId !== null &&
          sourceMessageId !== null &&
          !alreadySent
        );
      })
      .slice(0, limit);

    return res.json({
      ok: true,
      data: queue,
    });
  } catch (error) {
    console.error(
      "DONATION THANKS QUEUE API ERROR:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      ok: false,
      error: "thanks_queue_failed",
      message: error.message,
    });
  }
});

router.get("/:id", requireInternalAuth, async (req, res) => {
  try {
    const rows = await directusGet({
      filter: { id: { _eq: req.params.id } },
      fields: DONATION_READ_FIELDS,
      limit: 1,
    });
    if (!rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
    return res.json({ ok: true, data: rows[0] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "donation_read_failed", message: error.message });
  }
});

router.patch("/:id", requireInternalAuth, async (req, res) => {
  try {
    const allowed = {};
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "raw_request")) {
      allowed.raw_request = req.body.raw_request;
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "public_thanks")) {
      allowed.public_thanks = req.body.public_thanks;
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "public_thanks_sent")) {
      allowed.public_thanks_sent = req.body.public_thanks_sent;
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "public_thanks_prompt_sent")) {
      allowed.public_thanks_prompt_sent = req.body.public_thanks_prompt_sent;
    }

    if (!Object.keys(allowed).length) {
      return res.status(400).json({ ok: false, error: "no_allowed_fields" });
    }

    const updated = await directusPatch(req.params.id, allowed);
    return res.json({ ok: true, data: updated });
  } catch (error) {
    console.error("DONATION PATCH API ERROR:", error.response?.data || error.message);
    return res.status(500).json({ ok: false, error: "donation_patch_failed", message: error.message });
  }
});

module.exports = router;
