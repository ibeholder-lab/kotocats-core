const crypto = require("crypto");
const axios = require("axios");
const { createWebhookDebugLogger } = require("../webhook-debug-logger");

const MIXPLAT_API_URL = "https://api.mixplat.com/create_payment_form";
const DONATIONS_COLLECTION =
  process.env.MIXPLAT_DONATIONS_COLLECTION || "animals_donations";

function md5(value) {
  return crypto.createHash("md5").update(String(value)).digest("hex");
}

function boolEnv(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function mixplatDebugEnabled() {
  return boolEnv("MIXPLAT_DEBUG_WEBHOOK", false);
}

function mixplatDebugRawEnabled() {
  return boolEnv("MIXPLAT_DEBUG_WEBHOOK_RAW", false);
}

function directusUrl() {
  return String(process.env.DIRECTUS_URL || "").replace(/\/$/, "");
}

function directusHeaders(extra = {}) {
  if (!process.env.DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_TOKEN is required");
  }

  return {
    Authorization: `Bearer ${process.env.DIRECTUS_TOKEN}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function requireConfig() {
  if (!directusUrl()) throw new Error("DIRECTUS_URL is required");
  if (!process.env.DIRECTUS_TOKEN) throw new Error("DIRECTUS_TOKEN is required");
  if (!process.env.MIXPLAT_PROJECT_ID) throw new Error("MIXPLAT_PROJECT_ID is required");
  if (!process.env.MIXPLAT_API_KEY) throw new Error("MIXPLAT_API_KEY is required");
}

function externalWebhookUrl() {
  return String(
    process.env.MIXPLAT_WEBHOOK_EXTERNAL_URL ||
      process.env.MIXPLAT_CALLBACK_URL ||
      "",
  ).trim();
}

function maskLogValue(value, visibleStart = 6, visibleEnd = 4) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.length <= visibleStart + visibleEnd) return `${text.slice(0, 2)}***`;
  return `${text.slice(0, visibleStart)}...${text.slice(-visibleEnd)}`;
}

function safeWebhookUrlForLog(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw);

    for (const key of parsed.searchParams.keys()) {
      if (/secret|token|key|sign|signature/i.test(key)) {
        parsed.searchParams.set(key, "***");
      }
    }

    return parsed.toString();
  } catch (_) {
    return raw.replace(
      /([?&](?:secret|token|key|sign|signature)=)[^&\s]+/gi,
      "$1***",
    );
  }
}

function safeMixplatWebhookLog(payload, extra = {}) {
  return {
    event: "mixplat_webhook",
    payment_id: maskLogValue(payload?.payment_id),
    merchant_payment_id: maskLogValue(payload?.merchant_payment_id),
    transaction_id: maskLogValue(
      payload?.transaction_id || payload?.mixplat_transaction_id,
    ),
    status: payload?.status || null,
    ...extra,
  };
}

function safePayloadForDebug(payload) {
  try {
    return JSON.parse(
      JSON.stringify(payload || {}, (key, value) => {
        if (/card|pan|cvc|cvv|token|secret|sign|signature/i.test(String(key || ""))) {
          return "***";
        }

        return value;
      }),
    );
  } catch (_) {
    return { raw: String(payload || "") };
  }
}

async function directusGet(collection, params = {}) {
  const res = await axios.get(`${directusUrl()}/items/${collection}`, {
    headers: directusHeaders(),
    params,
    timeout: 30000,
  });

  return res.data.data;
}

async function directusPost(collection, data) {
  const res = await axios.post(`${directusUrl()}/items/${collection}`, data, {
    headers: directusHeaders(),
    timeout: 30000,
  });

  return res.data.data;
}

async function directusPatch(collection, id, data) {
  const res = await axios.patch(
    `${directusUrl()}/items/${collection}/${id}`,
    data,
    {
      headers: directusHeaders(),
      timeout: 30000,
    },
  );

  return res.data.data;
}

function amountToKopecks(amountRub) {
  const amount = Number(amountRub);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Некорректная сумма доната.");
  }

  return Math.round(amount * 100);
}

function normalizeAmountRub(value) {
  const clean = String(value || "")
    .replace(",", ".")
    .replace(/[^0-9.]/g, "");

  const amount = Number(clean || process.env.MIXPLAT_DONATE_DEFAULT_RUB || 300);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Некорректная сумма доната.");
  }

  const minAmount = Number(process.env.MIXPLAT_MIN_AMOUNT_RUB || 1);
  const maxAmount = Number(process.env.MIXPLAT_MAX_AMOUNT_RUB || 100000);

  if (amount < minAmount) {
    throw new Error(`Минимальная сумма доната: ${minAmount} ₽.`);
  }

  if (amount > maxAmount) {
    throw new Error(`Максимальная сумма доната: ${maxAmount} ₽.`);
  }

  return amount;
}

function createRequestId() {
  return `catdon-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function signCreatePayment({
  requestId,
  projectId,
  merchantPaymentId,
  apiKey,
}) {
  return md5(`${requestId}${projectId}${merchantPaymentId}${apiKey}`);
}

function verifyWebhookSignature(payload) {
  const paymentId = payload.payment_id || payload.merchant_payment_id || "";
  const signature = payload.signature || payload.sign || "";

  if (!paymentId || !signature) return false;

  const expected = md5(`${paymentId}${process.env.MIXPLAT_API_KEY}`);

  return String(signature).toLowerCase() === expected.toLowerCase();
}

function paymentStatusFromMixplat(statusValue) {
  const status = String(statusValue || "").toLowerCase();

  if (status === "success") return "success";
  if (["failure", "failed", "fail"].includes(status)) return "failure";
  if (status === "pending") return "pending";

  return null;
}

function catWebAppBaseUrl() {
  return String(
    process.env.CAT_WEBAPP_URL || process.env.CAT_WEBAPP_BASE_URL || "",
  ).trim();
}

function mixplatReturnUrl(
  baseUrl,
  { animalId = null, paymentStatus = null, paymentType = null } = {},
) {
  const rawBase = String(baseUrl || "").trim();

  if (!rawBase) return undefined;

  try {
    const url = new URL(rawBase);

    if (
      animalId &&
      !url.searchParams.get("animal") &&
      !url.searchParams.get("id")
    ) {
      url.searchParams.set("animal", String(animalId));
    }

    if (paymentStatus && !url.searchParams.get("payment")) {
      url.searchParams.set("payment", String(paymentStatus));
    }

    if (paymentType && !url.searchParams.get("kind")) {
      url.searchParams.set("kind", String(paymentType));
    }

    return url.toString();
  } catch (_) {
    return rawBase;
  }
}

function defaultMixplatDonateReturnUrl(animalId, paymentStatus) {
  const base = catWebAppBaseUrl();

  if (!base || !/^https?:\/\//i.test(base)) return undefined;

  return mixplatReturnUrl(`${base.replace(/\/$/, "")}/donate`, {
    animalId,
    paymentStatus,
  });
}

function defaultMixplatSuccessReturnUrl(animalId, paymentStatus) {
  const base = catWebAppBaseUrl();

  if (!base || !/^https?:\/\//i.test(base)) return undefined;

  return mixplatReturnUrl(`${base.replace(/\/$/, "")}/success`, {
    animalId,
    paymentStatus,
  });
}

async function createDonationPending({
  animal,
  amountRub,
  donorTelegramId,
  donorUsername,
  donorPhone = null,
  donorEmail = null,
  rawRequest,
  paymentType = "donate",
  comment = null,
}) {
  return directusPost(DONATIONS_COLLECTION, {
    animal_id: animal.id,
    payment_type: paymentType,
    amount: amountRub,
    currency: "RUB",
    status: "pending",
    telegram_id: donorTelegramId || null,
    donor_name: donorUsername || null,
    donor_phone: donorPhone || null,
    donor_email: donorEmail || null,
    comment:
      comment ||
      (paymentType === "feed"
        ? `Покормить кошку ${animal.name || animal.id}`
        : `Донат кошке ${animal.name || animal.id}`),
    raw_request: rawRequest || null,
  });
}

async function updateDonationCreated(donationId, { paymentId, rawResponse }) {
  return directusPatch(DONATIONS_COLLECTION, donationId, {
    payment_id: paymentId || null,
    raw_response: rawResponse || null,
  });
}

async function findDonationForWebhook(payload) {
  const paymentId = String(payload.payment_id || "").trim();
  const merchantPaymentId = String(payload.merchant_payment_id || "").trim();
  const merchantData = String(payload.merchant_data || "").trim();
  const merchantDataDonationId = merchantData.includes(":") ? merchantData.slice(merchantData.lastIndexOf(":") + 1).trim() : "";
  const filters = [];
  if (paymentId) filters.push({ payment_id: { _eq: paymentId } });
  if (merchantPaymentId) filters.push({ id: { _eq: merchantPaymentId } });
  if (merchantDataDonationId) filters.push({ id: { _eq: merchantDataDonationId } });
  if (!filters.length) return null;
  const rows = await directusGet(DONATIONS_COLLECTION, { filter: { _or: filters }, fields: "id,payment_id,mixplat_transaction_id,raw_response,status", limit: 1 });
  return rows[0] || null;
}

function safeWebhookResponse(payload) {
  const response = {
    received_at: new Date().toISOString(),
  };
  const fields = [
    "request",
    "request_id",
    "status",
    "status_extended",
    "payment_id",
    "merchant_payment_id",
    "merchant_data",
    "amount",
    "currency",
  ];

  fields.forEach((field) => {
    if (payload[field] !== undefined && payload[field] !== null) {
      response[field] = payload[field];
    }
  });

  return response;
}

async function updateDonationFromWebhook(donationId, payload) {
  const status = paymentStatusFromMixplat(payload.status);

  const patch = {
    status,
    mixplat_transaction_id:
      payload.transaction_id || payload.mixplat_transaction_id || null,
    raw_response: safeWebhookResponse(payload),
  };

  if (status === "success") {
    patch.paid_at = new Date().toISOString();
  }

  return directusPatch(DONATIONS_COLLECTION, donationId, patch);
}

async function createPaymentForm({
  donation,
  animal,
  amountRub,
  paymentType = "donate",
  needTitle = null,
  successUrl = null,
  failureUrl = null,
}) {
  const projectId = String(process.env.MIXPLAT_PROJECT_ID);
  const apiKey = String(process.env.MIXPLAT_API_KEY);
  const requestId = createRequestId();
  const merchantPaymentId = String(donation.id);

  const finalSuccessUrl =
    successUrl ||
    mixplatReturnUrl(
      defaultMixplatSuccessReturnUrl(animal?.id, "success") ||
        process.env.MIXPLAT_SUCCESS_URL,
      {
        animalId: animal?.id,
        paymentStatus: "success",
        paymentType,
      },
    );

  const finalFailureUrl =
    failureUrl ||
    mixplatReturnUrl(
      process.env.MIXPLAT_FAILURE_URL ||
        defaultMixplatDonateReturnUrl(animal?.id, "failed"),
      {
        animalId: animal?.id,
        paymentStatus: "failed",
        paymentType,
      },
    );

  const payload = {
    api_version: Number(process.env.MIXPLAT_API_VERSION || 3),
    request_id: requestId,
    project_id: projectId,
    merchant_payment_id: merchantPaymentId,
    amount: amountToKopecks(amountRub),
    description:
      `${needTitle ? "Помощь на нужду" : paymentType === "feed" ? "Покормить кошку" : "Донат кошке"} ${animal.name || ""}`.trim(),
    merchant_data: `cat_${paymentType}:${donation.id}`,
    merchant_fields: {
      donation_id: donation.id,
      animal_id: animal.id,
      animal_name: animal.name || "",
      source: "cat_site",
      payment_type: paymentType,
      need_title: needTitle || "",
    },
    url_success: finalSuccessUrl,
    url_failure: finalFailureUrl,
    test: boolEnv("MIXPLAT_TEST", true) ? 1 : 0,
  };

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) delete payload[key];
  });

  payload.signature = signCreatePayment({
    requestId,
    projectId,
    merchantPaymentId,
    apiKey,
  });

  const res = await axios.post(MIXPLAT_API_URL, payload, {
    headers: {
      "Content-Type": "application/json",
    },
    timeout: 30000,
  });

  return {
    request: payload,
    response: res.data,
    payment_id:
      res.data.payment_id || res.data.payment?.id || res.data.id || null,
    redirect_url:
      res.data.redirect_url || res.data.url || res.data.payment_url || null,
  };
}

async function createCatDonationPayment({
  animal,
  amountRub,
  donorTelegramId,
  donorUsername,
  donorPhone = null,
  donorEmail = null,
  paymentType = "donate",
  source = "cat_site",
  needId = null,
  needTitle = null,
  comment = null,
  publicThanks = null,
  askPublicThanksAfterPayment = false,
  sourceChatId = null,
  sourceMessageId = null,
  sourceThreadId = null,
  thanksChatId = null,
  thanksThreadId = null,
  donorFirstName = null,
  donorLastName = null,
  rawRequestExtra = null,
  successUrl = null,
  failureUrl = null,
}) {
  requireConfig();

  const amount = normalizeAmountRub(amountRub);

  const donation = await createDonationPending({
    animal,
    amountRub: amount,
    donorTelegramId,
    donorUsername,
    donorPhone,
    donorEmail,
    rawRequest: {
      source,
      payment_type: paymentType,
      animal_id: animal.id,
      animal_name: animal.name,
      amount,
      need_id: needId || null,
      need_title: needTitle || null,
      public_thanks: publicThanks,
      ask_public_thanks_after_payment: Boolean(askPublicThanksAfterPayment),
      source_chat_id: sourceChatId || null,
      source_message_id: sourceMessageId || null,
      source_thread_id: sourceThreadId || null,
      thanks_chat_id: thanksChatId || null,
      thanks_thread_id: thanksThreadId || null,
      donor_first_name: donorFirstName || null,
      donor_last_name: donorLastName || null,
      donor_telegram_id: donorTelegramId || null,
      donor_phone: donorPhone || null,
      donor_email: donorEmail || null,
      webhook_external_url: externalWebhookUrl() || null,
      success_url: successUrl || null,
      failure_url: failureUrl || null,
      ...(rawRequestExtra && typeof rawRequestExtra === "object"
        ? rawRequestExtra
        : {}),
    },
    paymentType,
    comment,
  });

  const payment = await createPaymentForm({
    donation,
    animal,
    amountRub: amount,
    paymentType,
    needTitle,
    successUrl,
    failureUrl,
  });

  await updateDonationCreated(donation.id, {
    paymentId: payment.payment_id,
    rawResponse: payment.response,
  });

  if (!payment.redirect_url) {
    throw new Error(
      "Mixplat не вернул ссылку оплаты. Посмотри raw_response в animals_donations.",
    );
  }

  return {
    donation_id: donation.id,
    amount,
    payment_id: payment.payment_id,
    redirect_url: payment.redirect_url,
  };
}

function mixplatJsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });

  res.end(JSON.stringify(payload));

  return payload;
}

function readRequestBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;

      if (size > limitBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }

      body += chunk.toString("utf8");
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function parseWebhookBody(rawBody, contentType = "") {
  const raw = String(rawBody || "").trim();

  if (!raw) return {};

  if (String(contentType).includes("application/json")) {
    return JSON.parse(raw);
  }

  const params = new URLSearchParams(raw);
  const payload = {};

  for (const [key, value] of params.entries()) {
    payload[key] = value;
  }

  return payload;
}

async function handleMixplatWebhook(req, res, urlObject, webhookLogger) {
  const logger = webhookLogger || createWebhookDebugLogger(req, res, { provider: "mixplat" });
  try {
    console.info("[mixplat] webhook received", {
      method: req.method,
      contentType: req.headers["content-type"] || null,
      remoteIp: req.ip || req.socket?.remoteAddress || null,
    });

    if (!boolEnv("MIXPLAT_ENABLED", false)) {
      return mixplatJsonResponse(res, 404, {
        ok: false,
        error: "mixplat disabled",
      });
    }

    requireConfig();

    const webhookSecret = process.env.MIXPLAT_WEBHOOK_SECRET || "";
    const querySecret = urlObject?.searchParams?.get("secret") || "";

    if (webhookSecret && querySecret !== webhookSecret) {
      return mixplatJsonResponse(res, 403, {
        ok: false,
        error: "forbidden",
      });
    }

    if (req.method !== "POST") {
      return mixplatJsonResponse(res, 405, {
        ok: false,
        error: "method not allowed",
      });
    }

    const rawBody = await readRequestBody(req);
    const payload = parseWebhookBody(
      rawBody,
      req.headers["content-type"] || "",
    );
    logger.received({ body: payload, rawBody });
    const signaturePresent = Boolean(payload.signature || payload.sign);
    logger.stage("required_fields_checked", {
      paymentIdPresent: Boolean(payload.payment_id),
      merchantPaymentIdPresent: Boolean(payload.merchant_payment_id),
      signaturePresent,
    });
    logger.stage("event_identified", {
      eventType: payload.event || payload.type || payload.request || null,
      paymentStatus: payload.status || null,
      paymentIdentifier: payload.payment_id || null,
      merchantIdentifier: payload.merchant_payment_id || null,
    });

    console.info("[mixplat] webhook payload received", {
      request: payload.request || payload.request_id || null,
      status: payload.status || null,
      statusExtended: payload.status_extended || null,
      projectId: payload.project_id || null,
      paymentId: payload.payment_id || null,
      merchantPaymentId: payload.merchant_payment_id || null,
      hasMerchantData: Boolean(payload.merchant_data),
      hasSignature: Boolean(payload.signature || payload.sign),
    });

    const signatureValid = verifyWebhookSignature(payload);
    logger.stage("signature_checked", { signaturePresent, signatureValid });

    if (!signatureValid) {
      console.warn("[mixplat] webhook rejected", {
        stage: "signature_invalid",
        hasSignature: Boolean(payload.signature || payload.sign),
        signatureValid: false,
      });
      console.warn(
        "MIXPLAT WEBHOOK:",
        safeMixplatWebhookLog(payload, {
          method: req.method,
          accepted: false,
          reason: "bad_signature",
        }),
      );

      return mixplatJsonResponse(res, 400, {
        ok: false,
        error: "bad signature",
      });
    }

    const donation = await findDonationForWebhook(payload);
    logger.stage("payment_lookup", {
      paymentFound: Boolean(donation),
      alreadyProcessed: Boolean(donation?.mixplat_transaction_id),
    });

    if (!donation) {
      console.log(
        "MIXPLAT WEBHOOK:",
        safeMixplatWebhookLog(payload, {
          method: req.method,
          accepted: true,
          ignored: true,
          reason: "donation_not_found",
        }),
      );

      return mixplatJsonResponse(res, 200, {
        result: "ok",
        ok: true,
        ignored: true,
        reason: "donation_not_found",
      });
    }

    const updated = await updateDonationFromWebhook(donation.id, payload);
    logger.stage("database_written", {
      result: "updated",
      donationId: updated.id,
      paymentStatus: updated.status,
    });
    logger.stage("thank_you", { sent: false, reason: "not_handled_by_mixplat_webhook" });

    console.log(
      "MIXPLAT WEBHOOK:",
      safeMixplatWebhookLog(payload, {
        method: req.method,
        accepted: true,
        ignored: false,
        donation_id: updated.id,
        donation_status: updated.status,
      }),
    );

    return mixplatJsonResponse(res, 200, {
      result: "ok",
      ok: true,
      donation_id: updated.id,
      status: updated.status,
    });
  } catch (error) {
    logger.error(error, { stage: "handling" });
    return mixplatJsonResponse(res, 500, {
      ok: false,
      error: error.message,
    });
  }
}

function initMixplatDonations() {
  if (!boolEnv("MIXPLAT_ENABLED", false)) {
    console.log("Mixplat donations disabled: MIXPLAT_ENABLED is not 1");
    return;
  }

  requireConfig();

  const webhookPath = process.env.MIXPLAT_WEBHOOK_PATH || "/mixplat/webhook";
  const externalUrl = externalWebhookUrl();

  console.log(
    `Mixplat donations enabled. Webhook is handled by Cat WebApp server on path ${webhookPath}`,
  );

  if (externalUrl) {
    console.log(
      `Mixplat external webhook URL for cabinet settings: ${safeWebhookUrlForLog(externalUrl)}`,
    );
  } else {
    console.log(
      "Mixplat external webhook URL is not set. Add MIXPLAT_WEBHOOK_EXTERNAL_URL to .env and set the same URL in Mixplat cabinet.",
    );
  }
}

module.exports = {
  initMixplatDonations,
  handleMixplatWebhook,
  createCatDonationPayment,
  normalizeAmountRub,
};
