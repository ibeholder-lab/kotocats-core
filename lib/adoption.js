const crypto = require("crypto");
const axios = require("axios");
const { loadCatBySlugOrId } = require("./directus-cats");

const REQUEST_TTL_MS = 90 * 1000;
const recentRequests = new Map();

class AdoptionError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AdoptionError";
    this.code = code;
    this.status = status;
  }
}

function clean(value, max) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function bool(value) {
  return ["1", "true", "yes", "on", "да"].includes(String(value || "").toLowerCase());
}

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) digits = digits.slice(1);
  return digits.length === 10 ? `+7${digits}` : "";
}

function normalizeEmail(value) {
  const email = String(value || "").trim();
  const at = email.lastIndexOf("@");
  return at < 1 ? email : `${email.slice(0, at)}@${email.slice(at + 1).toLowerCase()}`;
}

function publicNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `ADOPT-${date}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function directusConfig() {
  const url = String(process.env.DIRECTUS_URL || "").replace(/\/$/, "");
  const token = String(process.env.DIRECTUS_TOKEN || "").trim();
  if (!url || !token) throw new AdoptionError("CONFIGURATION_ERROR", "Сервис заявок временно недоступен.", 503);
  return { url, token };
}

function normalizeForm(formData = {}) {
  const form = {
    fullName: clean(formData.fullName ?? formData.full_name, 180),
    phone: normalizePhone(formData.phone),
    email: normalizeEmail(formData.email).slice(0, 180),
    hasOtherPets: bool(formData.hasOtherPets ?? formData.has_other_pets),
    hasChildren: bool(formData.hasChildren ?? formData.has_children),
    reason: clean(formData.reason, 3000),
    about: clean(formData.about, 5000),
    privacyConsent: bool(formData.privacyConsent ?? formData.privacy_consent),
  };
  const missing = [
    [form.fullName, "full_name"], [form.phone, "phone"], [form.email, "email"],
    [form.reason, "reason"], [form.about, "about"], [form.privacyConsent, "privacy_consent"],
  ].filter(([value]) => !value).map(([, field]) => field);
  if (missing.length) throw new AdoptionError("VALIDATION_ERROR", "Заполните обязательные поля и подтвердите согласие.");
  if (!form.phone) throw new AdoptionError("VALIDATION_ERROR", "Введите телефон в формате +7 (999) 999-99-99.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) throw new AdoptionError("VALIDATION_ERROR", "Введите корректный адрес электронной почты.");
  return form;
}

async function loadCat(slugOrId) {
  const cat = await loadCatBySlugOrId(clean(slugOrId, 120));
  if (!cat) throw new AdoptionError("CAT_NOT_AVAILABLE", "Эта кошка сейчас недоступна для усыновления.", 404);
  return cat;
}

function fingerprint(cat, form, sourceSite) {
  return crypto.createHash("sha256").update([cat.id, form.email, form.phone, sourceSite].join("|"), "utf8").digest("hex");
}

function cleanupRecent(now = Date.now()) {
  for (const [key, value] of recentRequests) if (now - value.createdAt > REQUEST_TTL_MS) recentRequests.delete(key);
}

async function createRequest({ animalSlugOrId, formData, sourceSite, sourceUrl, metadata = {} } = {}) {
  const source = clean(sourceSite, 80);
  if (!source) throw new AdoptionError("VALIDATION_ERROR", "Не указан источник заявки.");
  const cat = await loadCat(animalSlugOrId);
  const form = normalizeForm(formData);
  cleanupRecent();
  const key = fingerprint(cat, form, source);
  const previous = recentRequests.get(key);
  if (previous) throw new AdoptionError("DUPLICATE_REQUEST", "Заявка уже отправлена. Пожалуйста, подождите немного.", 409);

  const { url, token } = directusConfig();
  const number = publicNumber();
  const payload = {
    public_number: number,
    animal_id: cat.id,
    animal_slug: cat.slug || null,
    animal_name: cat.name,
    animal_location: cat.location || null,
    full_name: form.fullName,
    phone: form.phone,
    email: form.email,
    has_other_pets: form.hasOtherPets,
    has_children: form.hasChildren,
    reason: form.reason,
    about: form.about,
    privacy_consent: form.privacyConsent,
    source,
    page_url: clean(sourceUrl, 1000) || null,
    status: "new",
  };

  let response;
  try {
    response = await axios.post(`${url}/items/${process.env.DIRECTUS_ADOPT_COLLECTION || "adopt_requests"}`, payload, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      timeout: 15000,
    });
  } catch (error) {
    throw new AdoptionError("REQUEST_STORAGE_ERROR", "Не удалось отправить заявку. Попробуйте ещё раз.", 502);
  }
  const created = response.data?.data;
  if (!created?.id) throw new AdoptionError("REQUEST_STORAGE_ERROR", "Не удалось сохранить заявку. Попробуйте ещё раз.", 502);
  const result = { ok: true, request: { id: created.id, publicNumber: created.public_number || number, createdAt: created.created_at || created.date_created || new Date().toISOString() }, cat, form, metadata };
  recentRequests.set(key, { createdAt: Date.now(), result });
  return result;
}

module.exports = { AdoptionError, loadCatBySlugOrId: loadCat, normalizeForm, createRequest };
