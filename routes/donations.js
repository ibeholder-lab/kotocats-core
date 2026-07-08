const express = require("express");

const { createCatDonationPayment } = require("../lib/payments/mixplat");

const router = express.Router();

function normalizeText(value, maxLen = 500) {
  return String(value || "")
    .trim()
    .slice(0, maxLen);
}

function normalizeAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 300;
}

router.post("/create", async (req, res) => {
  try {
    const body = req.body || {};

    const animalId = normalizeText(body.animal_id || body.animalId, 100);

    const animalName = normalizeText(
      body.animal_name || body.animalName || "Кошка",
      200
    );

    if (!animalId) {
      return res.status(400).json({
        ok: false,
        error: "animal_id is required",
      });
    }

    const paymentType =
      normalizeText(body.payment_type || "donate", 20) === "feed"
        ? "feed"
        : "donate";

    const successUrl = normalizeText(
      body.success_url || body.successUrl,
      1000
    );

    const failureUrl = normalizeText(
      body.failure_url || body.failureUrl,
      1000
    );

    const payment = await createCatDonationPayment({
      animal: {
        id: animalId,
        name: animalName,
      },

      amountRub: normalizeAmount(body.amount),

      paymentType,

      source: normalizeText(
        body.source ||
          (paymentType === "feed"
            ? "koshkivgorode-site-feed"
            : "koshkivgorode-site"),
        100
      ),

      donorPhone: normalizeText(body.donor_phone, 50),

      comment: normalizeText(
        body.comment ||
          (paymentType === "feed"
            ? `Вкусняшка для ${animalName}`
            : `Донат кошке ${animalName}`),
        500
      ),

      // ВАЖНО: теперь используем URL, пришедшие с сайта
      successUrl,
      failureUrl,

      rawRequestExtra: {
        messenger: normalizeText(body.messenger, 30),
        success_url: successUrl,
        failure_url: failureUrl,
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
    console.error(
      "DONATION CREATE ERROR:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      ok: false,
      error: "donation_create_failed",
      message: error.message,
    });
  }
});

module.exports = router;