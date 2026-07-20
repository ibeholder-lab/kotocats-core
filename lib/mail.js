const nodemailer = require("nodemailer");

let transporter;

function text(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function escapeHtml(value) {
  return text(value, 5000).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function getConfig() {
  const config = {
    host: text(process.env.SMTP_HOST, 255),
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE ?? "true").toLowerCase() === "true",
    user: text(process.env.SMTP_USER, 320),
    pass: String(process.env.SMTP_PASS || ""),
    from: text(process.env.SMTP_FROM || process.env.SMTP_USER, 320),
    contact: text(process.env.ADOPT_CONTACT_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER, 320),
  };
  if (!config.host || !config.user || !config.pass || !config.from) {
    throw new Error("smtp_configuration_missing");
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error("smtp_configuration_invalid");
  }
  return config;
}

function getTransporter() {
  if (!transporter) {
    const config = getConfig();
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }
  return transporter;
}

function safeUrl(value) {
  try {
    const url = new URL(text(value, 1000));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

async function sendAdoptConfirmationEmail(data) {
  const applicantName = text(data.fullName, 180);
  const catName = text(data.animalName, 180);
  const recipient = text(data.email, 320).toLowerCase();
  const catUrl = safeUrl(data.catUrl);
  if (!applicantName || !catName || !/^\S+@\S+\.\S+$/.test(recipient) || !catUrl) {
    throw new Error("invalid_adopt_email_payload");
  }

  const config = getConfig();
  const subject = `Мы получили анкету на усыновление — ${catName}`;
  const plainText = [
    `${applicantName}, здравствуйте!`,
    "",
    `Мы получили вашу анкету на знакомство с кошкой по имени ${catName}.`,
    "Команда изучит ответы и свяжется с вами по указанным контактам.",
    "Пожалуйста, не отправляйте анкету повторно.",
    "",
    `Страница котика: ${catUrl}`,
    `Контактный email проекта: ${config.contact}`,
    "",
    "Котики и Люди",
  ].join("\n");
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5efe4;color:#1d1b18;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:18px"><tr><td style="padding:36px 28px"><p style="margin:0 0 18px;font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Котики и Люди</p><h1 style="margin:0 0 24px;font-size:30px;line-height:1.2">Анкета получена</h1><p style="margin:0 0 16px;line-height:1.6">${escapeHtml(applicantName)}, здравствуйте!</p><p style="margin:0 0 16px;line-height:1.6">Мы получили вашу анкету на знакомство с кошкой по имени <strong>${escapeHtml(catName)}</strong>. Команда изучит ответы и свяжется с вами по указанным контактам.</p><p style="margin:0 0 24px;line-height:1.6">Пожалуйста, не отправляйте анкету повторно.</p><p style="margin:0 0 24px"><a href="${escapeHtml(catUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#ffd600;color:#151515;text-decoration:none;font-weight:700">Открыть страницу котика</a></p><p style="margin:0;line-height:1.6;color:#555">Вопросы можно отправить на <a href="mailto:${escapeHtml(config.contact)}">${escapeHtml(config.contact)}</a>.</p></td></tr></table></td></tr></table></body></html>`;

  const result = await getTransporter().sendMail({
    from: config.from,
    to: recipient,
    subject,
    text: plainText,
    html,
  });
  return { ok: true, messageId: result.messageId || null };
}

module.exports = { sendAdoptConfirmationEmail };
