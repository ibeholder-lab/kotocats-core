require('dotenv').config();

const createAnimalMediaModule =
  require("./lib/animal-media.module");

const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { initMixplatDonations, handleMixplatWebhook: handleMixplatWebhookBase, createCatDonationPayment } = require('./mixplat-payments');
const kotocatsCore = require('./kotocats-core-client');
const { createAnimalReviewsModule } = require('./animal-reviews.module');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Transform } = require('stream');
const sharp = require('sharp');

const createCatFeedModule =
  require('./lib/cat-feed.module');

const BOT_TOKEN = process.env.BOT_TOKEN;
const DIRECTUS_URL = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required');
if (!DIRECTUS_URL) throw new Error('DIRECTUS_URL is required');
if (!DIRECTUS_TOKEN) throw new Error('DIRECTUS_TOKEN is required');

const bot = new Telegraf(BOT_TOKEN);

const BUTTON_ADD_CAT = 'add_cat';
const BUTTON_EDIT_ANIMALS_PERMISSION_ID = 3;
const BUTTON_EDIT_OWN_ANIMALS_PERMISSION_ID = 17;
const BUTTON_PUBLISH_CAT_PERMISSION_ID = 14;
const BUTTON_DELETE_ANIMALS_PERMISSION_ID = 4;
const BUTTON_VIEW_ANIMALS_PERMISSION_ID = 1;
const BUTTON_CREATE_ANIMALS_PERMISSION_ID = 2;
const BUTTON_SEARCH_ANIMALS_PERMISSION_ID = 15;
const CAFE_EDIT_PERMISSION_ID = 18;
const ANIMAL_STATUS_LOGS_COLLECTION = String(process.env.ANIMAL_STATUS_LOGS_COLLECTION || 'animal_status_logs').trim();
const MANUAL_ANIMAL_STATUS_OPTIONS = [
  { value: 'looking_home', label: 'Ищет дом' },
  { value: 'adopted', label: 'Уже дома' },
];
const MANUAL_ANIMAL_STATUS_CALLBACK_CODES = {
  looking_home: 'lh',
  adopted: 'ad',
};
const GUEST_ROLE_ID = 4;
const ROLE_PERMISSIONS_CACHE_TTL_MS = 30 * 1000;
const MAX_GALLERY_PHOTOS = 20;
const PHOTO_DOWNLOAD_CONCURRENCY = envPositiveNumber('PHOTO_DOWNLOAD_CONCURRENCY', 4, { min: 1, max: 6 });
const CAT_PHOTOS_FOLDER_ID = process.env.CAT_PHOTOS_FOLDER_ID || process.env.CAT_FILES_FOLDER_ID || 'bc30df32-b757-42a3-b6a0-e66a0e369f50';
const CAT_VIDEOS_FOLDER_ID = process.env.CAT_VIDEOS_FOLDER_ID || '2578d71c-23f3-4886-a15a-a0f44b5cc7f6';
let BOT_USERNAME = String(process.env.BOT_USERNAME || '').replace(/^@/, '').toLowerCase();

const CAT_FEED_URL = process.env.CAT_FEED_URL || '';
const CAT_OPEKA_URL = process.env.CAT_OPEKA_URL || '';
const CAT_DONATE_URL = process.env.CAT_DONATE_URL || '';
const CAT_ADOPT_URL = process.env.CAT_ADOPT_URL || '';
const ANIMAL_MEDIA_SOURCE_FIELD = String(process.env.ANIMAL_MEDIA_SOURCE_FIELD || 'source').trim() || 'source';
const ANIMAL_MEDIA_SOURCE_OPTIONS = [
  { value: 'street', label: 'улица' },
  { value: 'kotocafe', label: 'котокафе' },
  { value: 'home', label: 'дома' },
];


// =========================
// ADMIN UI CLEAN LAYER
// =========================
function formatSex(sex) {
  if (!sex) return 'не указан';
  const v = String(sex).toLowerCase();
  if (['male','m','кот'].includes(v)) return 'кот';
  if (['female','f','кошка'].includes(v)) return 'кошка';
  return 'не указан';
}

const KOTOCAFE_MAP = {
  novokuznetskaya: {
    label: 'Новокузнецкая',
    url: 'https://kotocafe.ru/koteeshnaya',
    showHelp: true,
    showDonations: true,
    showFeed: true,
    showMapLink: true,
  },
  prospekt_mira: {
    label: 'Проспект Мира',
    url: 'https://cats.kotocafe.ru/1',
    showHelp: true,
    showDonations: true,
    showFeed: true,
    showMapLink: true,
  },
  tovarishcheskiy: {
    label: 'Таганка',
    address: 'Товарищеский переулок, 4с5',
    showHelp: false,
    showDonations: false,
    showFeed: false,
    showMapLink: false,
  },
};

KOTOCAFE_MAP.novokuznetskaya.mapUrl = process.env.KOTOCAFE_MAP_URL_NOVOKUZNETSKAYA || 'https://yandex.ru/maps/-/CCUqU2HvhB';
KOTOCAFE_MAP.prospekt_mira.mapUrl = process.env.KOTOCAFE_MAP_URL_PROSPEKT_MIRA || 'https://yandex.ru/maps/?text=%D0%BA%D0%BE%D1%82%D0%BE%D0%BA%D0%B0%D1%84%D0%B5%20%D0%9A%D0%BE%D1%82%D0%B8%D0%BA%D0%B8%20%D0%B8%20%D0%9B%D1%8E%D0%B4%D0%B8%20%D0%9F%D1%80%D0%BE%D1%81%D0%BF%D0%B5%D0%BA%D1%82%20%D0%9C%D0%B8%D1%80%D0%B0';

function formatLocation(location) {
  if (!location) return 'не указана';
  const loc = KOTOCAFE_MAP[location];
  if (loc) return loc.label;
  return location;
}

function getLocationConfig(location) {
  if (!location) return null;
  return KOTOCAFE_MAP[location] || null;
}

function locationAllowsHelp(location) {
  return getLocationConfig(location)?.showHelp !== false;
}

function locationAllowsDonations(location) {
  const loc = getLocationConfig(location);
  return loc?.showHelp !== false && loc?.showDonations !== false;
}

function locationAllowsFeed(location) {
  const loc = getLocationConfig(location);
  return loc?.showHelp !== false && loc?.showFeed !== false;
}

function locationShowsMapLink(location) {
  return getLocationConfig(location)?.showMapLink !== false;
}

function locationUrlKeyboard(location) {
  const loc = KOTOCAFE_MAP[location];
  if (!loc?.url) return undefined;
  return Markup.inlineKeyboard([[Markup.button.url(`🏠 ${loc.label}`, loc.url)]]);
}

function animalCardActionKeyboard(animal, options = {}) {
  const mediaRows = [
    [
      Markup.button.callback('📸 Фото', `gp:${animal.id}`),
      Markup.button.callback('🎥 Видео', `gv:${animal.id}`),
    ],
    [
      Markup.button.callback('📖 История', `gs:${animal.id}`),
      Markup.button.callback('💬 Отзывы', `gvr:${animal.id}`),
    ],
  ];
  const rows = [...mediaRows];
  if (locationAllowsHelp(animal.location)) {
    const helpRow = [Markup.button.callback('❤ Помочь', `gh:${animal.id}`)];
    if (options.showDonations === true && locationAllowsDonations(animal.location)) {
      helpRow.push(Markup.button.callback('💳 Донаты', `gd:${animal.id}`));
    }
    rows.push(helpRow);
  }
  if (SHARE_INVITES_ENABLED) rows.push([Markup.button.callback('🎁 Поделиться — скидка 50%', `share_cat:${animal.id}`)]);
  const loc = KOTOCAFE_MAP[animal.location];
  if (loc?.url) rows.push([Markup.button.url(`🏠 ${loc.label}`, loc.url)]);
  return Markup.inlineKeyboard(rows);
}

function formatStatus(status) {
  const map = {
    looking_home: 'Ищет дом',
    meeting: 'На знакомстве',
    reserved: 'Забронирована',
    adopted: 'Уже дома',
  };
  return map[status] || 'не указан';
}


function envPositiveNumber(name, fallback, options = {}) {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  const min = options.min ?? 1;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(value) || value < min) return fallback;
  return Math.min(value, max);
}

class TtlMap {
  constructor({ ttlMs, maxSize, cleanupIntervalMs = 60 * 1000 } = {}) {
    this.store = new Map();
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
    this.cleanupIntervalMs = cleanupIntervalMs;
    this.lastCleanupAt = 0;
  }

  expiresAt(now = Date.now()) {
    return this.ttlMs ? now + this.ttlMs : Number.POSITIVE_INFINITY;
  }

  isExpired(record, now = Date.now()) {
    return Boolean(record && record.expiresAt <= now);
  }

  maybeCleanup(now = Date.now(), force = false) {
    if (!force && now - this.lastCleanupAt < this.cleanupIntervalMs) return;
    this.lastCleanupAt = now;

    for (const [key, record] of this.store.entries()) {
      if (this.isExpired(record, now)) this.store.delete(key);
    }

    while (this.maxSize && this.store.size > this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }
  }

  set(key, value) {
    const now = Date.now();
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: this.expiresAt(now) });
    this.maybeCleanup(now);
    return this;
  }

  get(key) {
    const record = this.store.get(key);
    if (!record) return undefined;
    if (this.isExpired(record)) {
      this.store.delete(key);
      return undefined;
    }
    return record.value;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    return this.store.delete(key);
  }

  clear() {
    return this.store.clear();
  }

  get size() {
    this.maybeCleanup(Date.now(), true);
    return this.store.size;
  }

  *entries() {
    const now = Date.now();
    this.maybeCleanup(now);
    for (const [key, record] of this.store.entries()) {
      if (!this.isExpired(record, now)) yield [key, record.value];
    }
  }

  *keys() {
    for (const [key] of this.entries()) yield key;
  }

  *values() {
    for (const [, value] of this.entries()) yield value;
  }

  [Symbol.iterator]() {
    return this.entries();
  }
}

class TtlSet {
  constructor(options = {}) {
    this.map = new TtlMap(options);
  }

  add(value) {
    this.map.set(value, true);
    return this;
  }

  has(value) {
    return this.map.has(value);
  }

  delete(value) {
    return this.map.delete(value);
  }

  clear() {
    return this.map.clear();
  }

  get size() {
    return this.map.size;
  }

  *values() {
    for (const [value] of this.map.entries()) yield value;
  }

  *keys() {
    yield* this.values();
  }

  *entries() {
    for (const value of this.values()) yield [value, value];
  }

  [Symbol.iterator]() {
    return this.values();
  }
}

const CAT_WEBAPP_URL = process.env.CAT_WEBAPP_URL || process.env.CAT_WEBAPP_BASE_URL || '';
const CAT_WEBAPP_PORT = Number(process.env.CAT_WEBAPP_PORT || 3020);
const CAT_WEBAPP_HOST = String(process.env.CAT_WEBAPP_HOST || '127.0.0.1').trim() || '127.0.0.1';
const READY_CHECK_TIMEOUT_MS = envPositiveNumber('READY_CHECK_TIMEOUT_MS', 5000, { min: 500, max: 30000 });
const DIRECTUS_TIMEOUT_MS = envPositiveNumber('DIRECTUS_TIMEOUT_MS', 30000, { min: 1000, max: 120000 });
const DIRECTUS_UPLOAD_TIMEOUT_MS = envPositiveNumber('DIRECTUS_UPLOAD_TIMEOUT_MS', 120000, { min: 5000, max: 10 * 60 * 1000 });
const SESSION_TTL_MS = envPositiveNumber('SESSION_TTL_MS', 6 * 60 * 60 * 1000, { min: 5 * 60 * 1000, max: 7 * 24 * 60 * 60 * 1000 });
const SESSION_MAX_SIZE = envPositiveNumber('SESSION_MAX_SIZE', 1000, { min: 10, max: 100000 });
const AUTO_COMMENTED_MESSAGES_TTL_MS = envPositiveNumber('AUTO_COMMENTED_MESSAGES_TTL_MS', 24 * 60 * 60 * 1000, { min: 60 * 1000, max: 7 * 24 * 60 * 60 * 1000 });
const AUTO_COMMENTED_MESSAGES_MAX = envPositiveNumber('AUTO_COMMENTED_MESSAGES_MAX', 10000, { min: 100, max: 1000000 });
const THANKED_DONATION_IDS_TTL_MS = envPositiveNumber('THANKED_DONATION_IDS_TTL_MS', 7 * 24 * 60 * 60 * 1000, { min: 60 * 1000, max: 30 * 24 * 60 * 60 * 1000 });
const THANKED_DONATION_IDS_MAX = envPositiveNumber('THANKED_DONATION_IDS_MAX', 5000, { min: 100, max: 1000000 });
const MAX_EXTERNAL_IMAGE_BYTES = envPositiveNumber('MAX_EXTERNAL_IMAGE_BYTES', 15 * 1024 * 1024, { min: 1024 * 1024, max: 100 * 1024 * 1024 });
const ASSET_CACHE_MAX_AGE_SECONDS = envPositiveNumber('ASSET_CACHE_MAX_AGE_SECONDS', 24 * 60 * 60, { min: 60 * 60, max: 30 * 24 * 60 * 60 });
const AUTO_CAT_COMMENTS = String(process.env.AUTO_CAT_COMMENTS || 'false').toLowerCase() === 'true';
const VIDEO_TRANSCODE_ENABLED = String(process.env.VIDEO_TRANSCODE_ENABLED || 'true').toLowerCase() !== 'false';
const AUTO_COMMENT_MIN_TEXT_LENGTH = envPositiveNumber('GROUP_MIN_TEXT_LENGTH', 3, { min: 1, max: 1000 });
const AUTO_COMMENT_PROFILE_CACHE_TTL_MS = envPositiveNumber('AUTO_COMMENT_PROFILE_CACHE_TTL_MS', 24 * 60 * 60 * 1000, { min: 60 * 1000, max: 7 * 24 * 60 * 60 * 1000 });
const AUTO_COMMENT_PROFILE_CACHE_MAX = envPositiveNumber('AUTO_COMMENT_PROFILE_CACHE_MAX', 1000, { min: 10, max: 10000 });
const sessions = new TtlMap({ ttlMs: SESSION_TTL_MS, maxSize: SESSION_MAX_SIZE });
const autoCommentedMessages = new TtlSet({ ttlMs: AUTO_COMMENTED_MESSAGES_TTL_MS, maxSize: AUTO_COMMENTED_MESSAGES_MAX });
const ANIMAL_SHARE_INVITES_COLLECTION = process.env.ANIMAL_SHARE_INVITES_COLLECTION || 'animal_share_invites';
const SHARE_INVITE_TTL_DAYS = envPositiveNumber('SHARE_INVITE_TTL_DAYS', 30, { min: 1, max: 365 });
const SHARE_INVITES_ENABLED = String(process.env.SHARE_INVITES_ENABLED || 'false').toLowerCase() === 'true';
const TEAM_READ_FIELDS = 'id,full_name,phone,telegram_id,is_active,location,current_animal_id,current_chat_id,current_pin_message_id,role_id.id,role_id.code,role_id.title';
const ANIMAL_READ_FIELDS = 'id,name,slug,status,location,sex,birth_date,birth_date_approximate,color,color_note,good_with_cats,good_with_dogs,good_with_children,vaccinated,sterilized,chipped,parasite_treated,short_description,story,health_comment,character_comment,adoption_requirements_other,published,featured,socialized,admission_date,main_photo,gallery,kinescope_url,author_id,author_id.id,author_id.full_name,author_id.telegram_id,created_at,updated_at';
const DONATION_READ_FIELDS = 'id,animal_id,payment_id,mixplat_transaction_id,payment_type,amount,currency,status,telegram_id,donor_name,comment,raw_request,raw_response,created_at,paid_at';
const SHARE_INVITE_READ_FIELDS = 'id,token,animal_id,sharer_telegram_id,sharer_name,recipient_telegram_id,recipient_name,status,discount_percent,created_at,expires_at,opened_at';
const AUTO_DONATION_THANKS = String(process.env.AUTO_DONATION_THANKS || 'true').toLowerCase() !== 'false';
const DONATION_THANKS_WORKER_INTERVAL_MS = envPositiveNumber('DONATION_THANKS_WORKER_INTERVAL_MS', 60 * 1000, { min: 5 * 1000, max: 60 * 60 * 1000 });
const DONATION_THANKS_WORKER_LIMIT = envPositiveNumber('DONATION_THANKS_WORKER_LIMIT', 50, { min: 5, max: 500 });
// Куда публиковать публичные благодарности за донаты.
// Для канала лучше указать numeric id вида -1001234567890 или публичный @username канала.
const DONATION_THANKS_CHAT_ID = String(
  process.env.CAT_DONATION_THANKS_CHAT_ID ||
  process.env.DONATION_THANKS_CHAT_ID ||
  process.env.PUBLIC_DONATION_THANKS_CHAT_ID ||
  process.env.CAT_CHANNEL_ID ||
  ''
).trim();
const thankedDonationIds = new TtlSet({ ttlMs: THANKED_DONATION_IDS_TTL_MS, maxSize: THANKED_DONATION_IDS_MAX });
const donationDeepLinkContexts = new Map();
const donationSourceContexts = new Map();
const userDonationOriginContexts = new Map();
const autoCommentProfileCache = new Map();
const webAnimalPayloadCache = new Map();
const webAssetAccessCache = new Map();
const webAssetResponseCache = new Map();
const webAssetMetadataCache = new Map();
let webCatalogPayloadCache = null;
const WEB_ANIMAL_PAYLOAD_CACHE_MAX = envPositiveNumber('WEB_ANIMAL_PAYLOAD_CACHE_MAX', 500, { min: 10, max: 5000 });
const WEB_ASSET_ACCESS_CACHE_MAX = envPositiveNumber('WEB_ASSET_ACCESS_CACHE_MAX', 2000, { min: 100, max: 20000 });
const WEB_ASSET_RESPONSE_CACHE_MAX = envPositiveNumber('WEB_ASSET_RESPONSE_CACHE_MAX', 100, { min: 10, max: 1000 });
const WEB_ANIMAL_DISK_CACHE_TTL_MS = envPositiveNumber('WEB_ANIMAL_DISK_CACHE_TTL_MS', 60 * 60 * 1000, { min: 60 * 1000, max: 24 * 60 * 60 * 1000 });
const WEB_CATALOG_DISK_CACHE_TTL_MS = envPositiveNumber('WEB_CATALOG_DISK_CACHE_TTL_MS', 60 * 60 * 1000, { min: 60 * 1000, max: 24 * 60 * 60 * 1000 });
const WEB_ANIMAL_UNAVAILABLE_MESSAGE = 'Данная кошка не опубликована или не существует.';
const CACHE_INVALIDATE_TOKEN = String(process.env.CACHE_INVALIDATE_TOKEN || process.env.DIRECTUS_WEBHOOK_TOKEN || '').trim();
const WEB_CACHE_DIR = path.join(__dirname, '.cache');
const WEB_ANIMAL_CACHE_DIR = path.join(WEB_CACHE_DIR, 'web-animals');
const WEB_CATALOG_CACHE_FILE = path.join(WEB_CACHE_DIR, 'web-catalog.json');
function staticAssetVersion(files) {
  try {
    const hash = crypto.createHash('sha256');
    for (const file of files) hash.update(fs.readFileSync(path.join(__dirname, file)));
    return hash.digest('base64url').slice(0, 12);
  } catch (_) {
    return 'dev';
  }
}
const CAT_CARD_ASSET_VERSION = staticAssetVersion(['cat-card.min.css', 'cat-card.min.js']);
const CAT_CATALOG_ASSET_VERSION = staticAssetVersion(['cat-catalog.min.css', 'cat-catalog.min.js']);
const WEB_DONATE_QUICK_AMOUNTS = parseQuickDonateAmounts(process.env.WEB_DONATE_QUICK_AMOUNTS);

function parseQuickDonateAmounts(raw) {
  const items = String(raw || '')
    .split(',')
    .map((value) => Number(String(value || '').trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  const unique = [...new Set(items.map((value) => Math.round(value)))];
  return unique.length ? unique.slice(0, 3) : [50, 100, 300];
}

function renderQuickDonateButtons(amounts = WEB_DONATE_QUICK_AMOUNTS, activeAmount = null, className = 'support-amount') {
  return amounts.map((amount) => `<button class="${className}${Number(activeAmount) === Number(amount) ? ' active' : ''}" type="button" data-amount="${amount}">${amount} ₽</button>`).join('');
}

function invalidateWebAnimalPayloadCache(animalId = null) {
  const id = extractFileId(animalId) || animalId;
  if (id !== null && id !== undefined && String(id).trim()) {
    webAnimalPayloadCache.delete(String(id));
    try { fs.rmSync(webAnimalCacheFile(String(id)), { force: true }); } catch (_) {}
    return;
  }
  webAnimalPayloadCache.clear();
  try { fs.rmSync(WEB_ANIMAL_CACHE_DIR, { recursive: true, force: true }); } catch (_) {}
}

function invalidateWebCatalogPayloadCache() {
  webCatalogPayloadCache = null;
  try { fs.rmSync(WEB_CATALOG_CACHE_FILE, { force: true }); } catch (_) {}
}

function invalidateWebAssetAccessCache() {
  webAssetAccessCache.clear();
  webAssetResponseCache.clear();
  webAssetMetadataCache.clear();
}

function invalidateWebAnimalPayloadForMutation(collection, id, data = null) {
  if (collection === 'animals') {
    invalidateWebAnimalPayloadCache(id || data?.id);
    invalidateWebCatalogPayloadCache();
    invalidateWebAssetAccessCache();
    return;
  }
  if (collection === 'animals_donations') {
    invalidateWebAnimalPayloadCache(extractFileId(data?.animal_id) || data?.animal_id || null);
    return;
  }
  if (!['animal_media', 'animal_needs'].includes(collection)) return;
  const animalId = extractFileId(data?.animal_id) || data?.animal_id;
  // При patch/delete у нас часто есть только id связующей записи. Полная очистка
  // безопаснее, чем оставить одну устаревшую публичную анкету.
  invalidateWebAnimalPayloadCache(animalId || null);
  if (collection === 'animal_media') {
    invalidateWebCatalogPayloadCache();
    invalidateWebAssetAccessCache();
  }
}

function buildWebAppUrl(id) {
  if (kotocatsCore.coreModeEnabled()) return kotocatsCore.catPageUrl(id);
  const base = String(CAT_WEBAPP_URL || '').trim();
  if (!base || !/^https?:\/\//i.test(base)) return null;
  // Важно: не добавляем слеш перед ?animal.
  // Если CAT_WEBAPP_URL = https://site.ru/webapp, ссылка должна быть /webapp?animal=...
  // Иначе часть прокси/роутеров отдаёт пустоту или 404 на /webapp/.
  return `${base.replace(/\/$/, '')}?animal=${encodeURIComponent(id)}`;
}

function buildCatalogWebAppUrl() {
  if (kotocatsCore.coreModeEnabled()) return kotocatsCore.catalogUrl();
  const base = String(CAT_WEBAPP_URL || '').trim();
  if (!base || !/^https?:\/\//i.test(base)) return null;
  return `${base.replace(/\/$/, '')}`;
}

function publicUrl(pathname = '/') {
  if (kotocatsCore.coreModeEnabled()) {
    const url = kotocatsCore.buildUrl(pathname);
    if (url) return url;
  }
  const base = String(CAT_WEBAPP_URL || '').trim();
  if (!base || !/^https?:\/\//i.test(base)) return '';
  try {
    return new URL(pathname, `${base.replace(/\/$/, '')}/`).toString();
  } catch (_) {
    return '';
  }
}

function mixplatDonationsEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.MIXPLAT_ENABLED || '').trim().toLowerCase());
}

function buildDonateWebAppUrl(animal) {
  const id = animal?.id;
  if (kotocatsCore.coreModeEnabled()) return kotocatsCore.donateUrl(animal);
  const base = String(CAT_WEBAPP_URL || '').trim();
  if (!id) return null;
  if (!base || !/^https?:\/\//i.test(base)) return `/donate?animal=${encodeURIComponent(id)}`;
  return `${base.replace(/\/$/, '')}/donate?animal=${encodeURIComponent(id)}`;
}

function metaText(value, maxLength = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

function buildAnimalWebMeta(cacheRecord, animalId) {
  const payload = cacheRecord?.payload || {};
  const animal = payload.animal || {};
  const name = String(animal.name || '').trim() || 'Кошка';
  const sex = formatSex(animal.sex);
  const sexWord = sex === 'кот' ? 'кота' : 'кошки';
  const title = `${name} — анкета ${sexWord} Котокафе`;
  const description = metaText(
    animal.short_description ||
    payload.human_lead ||
    payload.life_lead ||
    `${name} ${payload.status_label ? `— ${payload.status_label.toLowerCase()}` : 'ждёт знакомства'} в Котокафе.`,
    220,
  );
  const id = encodeURIComponent(animal.id || animalId || '');
  const canonicalUrl = id ? publicUrl(`/?animal=${id}`) : publicUrl('/');
  const imageUrl = payload.main_photo_url ? publicUrl(payload.main_photo_url) : publicUrl('/favicon.png');

  return {
    title,
    description,
    canonicalUrl,
    imageUrl,
    imageAlt: `${name} — ${sexWord} из Котокафе`,
  };
}

function webAppOrCallbackButton(label, url, fallbackCallbackData) {
  // URL-кнопка стабильнее web_app в группах Telegram.
  // Если CAT_WEBAPP_URL не задан — остаётся старый callback fallback.
  if (url) return Markup.button.url(label, url);
  return Markup.button.callback(label, fallbackCallbackData);
}

function privateBotStartUrl(payload) {
  const username = String(BOT_USERNAME || '').replace(/^@/, '').trim();
  const value = String(payload || '').trim();
  if (!username || !value || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) return null;
  return `https://t.me/${username}?start=${encodeURIComponent(value)}`;
}

function webDonationUrl(animal) {
  const donateUrl = buildDonateWebAppUrl(animal);
  if (donateUrl) return donateUrl;
  return formatHelpUrl(CAT_DONATE_URL, animal) || privateBotStartUrl(`cat_h_${animal?.id}`);
}

function webFeedUrl(animal) {
  return formatHelpUrl(CAT_FEED_URL, animal);
}

function compactUuid(value) {
  const hex = String(value || '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return Buffer.from(hex, 'hex').toString('base64url');
}

function expandCompactUuid(value) {
  try {
    const hex = Buffer.from(String(value || ''), 'base64url').toString('hex');
    if (!/^[0-9a-f]{32}$/.test(hex)) return null;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch (_) {
    return null;
  }
}

function compactSignedInteger(value) {
  try {
    const number = BigInt(String(value));
    return `${number < 0n ? 'n' : 'p'}${(number < 0n ? -number : number).toString(36)}`;
  } catch (_) {
    return null;
  }
}

function expandCompactSignedInteger(value) {
  const match = String(value || '').match(/^([np])([0-9a-z]+)$/i);
  if (!match) return null;
  try {
    const absolute = BigInt(`0x${BigInt(parseInt(match[2], 36)).toString(16)}`);
    const signed = match[1].toLowerCase() === 'n' ? -absolute : absolute;
    const number = Number(signed);
    return Number.isSafeInteger(number) ? number : signed.toString();
  } catch (_) {
    return null;
  }
}

function compactPositiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number.toString(36) : null;
}

function expandCompactPositiveInteger(value) {
  const number = parseInt(String(value || ''), 36);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function privateAnimalKeyboard(animal, sourceContext = {}) {
  const animalCompact = compactUuid(animal.id);
  const chatCompact = compactSignedInteger(sourceContext.sourceChatId);
  const messageCompact = compactPositiveInteger(sourceContext.sourceMessageId);
  const threadCompact = compactPositiveInteger(sourceContext.sourceThreadId || sourceContext.sourceMessageId);
  const hasOrigin = animalCompact && chatCompact && messageCompact && threadCompact;
  const url = (action) => privateBotStartUrl(
    hasOrigin
      ? `catx_${action}_${animalCompact}_${chatCompact}_${messageCompact}_${threadCompact}`
      : `cat_${action}_${animal.id}`
  );
  const urls = {
    photo: url('p'),
    video: url('v'),
    story: url('s'),
    reviews: url('r'),
    text: url('t'),
    web: url('w'),
    help: url('h'),
  };
  if (Object.values(urls).some((value) => !value)) return null;
  const rows = [
    [
      Markup.button.url('📸 Фото', urls.photo),
      Markup.button.url('🎥 Видео', urls.video),
    ],
    [
      Markup.button.url('📖 История', urls.story),
      Markup.button.url('💬 Отзывы', urls.reviews),
    ],
    [
      Markup.button.url('🐱 Анкета', urls.text),
      Markup.button.url('✨ Красивая анкета', urls.web),
    ],
    [Markup.button.url('❤ Помочь', urls.help)],
  ];
  if (SHARE_INVITES_ENABLED) rows.push([Markup.button.callback('🎁 Поделиться — скидка 50%', `share_public:${animal.id}`)]);
  return Markup.inlineKeyboard(rows);
}



const MENU_ADD_CAT = '➕ Добавить кошку';
const MENU_FIND_CAT = '🔎 Найти кошку';
const MENU_LIST_CATS = '📋 Список кошек';
const MENU_CAFE_MEDIA = '🏠 Жизнь котокафе';
const MENU_AUTH_CONTACT = '📱 Поделиться номером';

const BOOLEAN_FIELDS = {
  good_with_cats: '🐱 С кошками',
  good_with_dogs: '🐶 С собаками',
  good_with_children: '👶 С детьми',
  vaccinated: '💉 Вакцинирована',
  sterilized: '✂️ Стерилизована',
  chipped: '🔘 Чипирована',
  parasite_treated: '🪲 Обработана от паразитов',
};

function apiHeaders(extra = {}) {
  return { Authorization: `Bearer ${DIRECTUS_TOKEN}`, ...extra };
}

function normalizePhone(phone) {
  let p = String(phone || '').replace(/[^\d+]/g, '');
  if (p.startsWith('8') && p.length === 11) p = '+7' + p.slice(1);
  if (p.startsWith('7') && p.length === 11) p = '+' + p;
  return p;
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/ё/g, 'e').replace(/й/g, 'i').replace(/ц/g, 'c')
    .replace(/у/g, 'u').replace(/к/g, 'k').replace(/е/g, 'e')
    .replace(/н/g, 'n').replace(/г/g, 'g').replace(/ш/g, 'sh')
    .replace(/щ/g, 'sch').replace(/з/g, 'z').replace(/х/g, 'h')
    .replace(/ъ/g, '').replace(/ф/g, 'f').replace(/ы/g, 'y')
    .replace(/в/g, 'v').replace(/а/g, 'a').replace(/п/g, 'p')
    .replace(/р/g, 'r').replace(/о/g, 'o').replace(/л/g, 'l')
    .replace(/д/g, 'd').replace(/ж/g, 'zh').replace(/э/g, 'e')
    .replace(/я/g, 'ya').replace(/ч/g, 'ch').replace(/с/g, 's')
    .replace(/м/g, 'm').replace(/и/g, 'i').replace(/т/g, 't')
    .replace(/ь/g, '').replace(/б/g, 'b').replace(/ю/g, 'yu')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function extractUrl(text) {
  const match = String(text || '').match(/https?:\/\/\S+/i);
  if (!match) return null;
  return match[0].replace(/[),.;!?]+$/g, '');
}

function extractUrls(text) {
  return String(text || '')
    .split(/\s+/)
    .map((item) => item.trim().replace(/[),.;!?]+$/g, ''))
    .filter((item) => /^https?:\/\//i.test(item));
}


function safeExternalUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (!parsed.hostname) return null;
    return parsed.href;
  } catch (_) {
    return null;
  }
}

function validateOptionalExternalUrl(value, label = 'Ссылка') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const safe = safeExternalUrl(raw);
  if (!safe) throw new Error(`${label} должна начинаться с http:// или https://`);
  return safe;
}

function isProbablyImageUrl(url) {
  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
  } catch (_) {
    return false;
  }
}

function filenameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const basename = path.basename(parsed.pathname);
    if (basename && basename.includes('.')) return basename;
  } catch (_) {}
  return `cat-${Date.now()}.jpg`;
}

function contentTypeFromUrl(url) {
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

function monthsToBirthDate(months) {
  const now = new Date();
  const birth = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  birth.setMonth(birth.getMonth() - months);
  return birth.toISOString().slice(0, 10);
}

function parseMonths(text) {
  const raw = String(text || '').trim().toLowerCase().replace(',', '.');
  const yearsMatch = raw.match(/^(\d+(?:\.\d+)?)\s*(год|года|лет|г)$/i);
  if (yearsMatch) return Math.round(Number(yearsMatch[1]) * 12);
  const monthsMatch = raw.match(/^(\d+)\s*(мес|месяц|месяца|месяцев|м)?$/i);
  if (monthsMatch) return Number(monthsMatch[1]);
  return NaN;
}

async function directusGet(collection, params = {}) {
  const res = await axios.get(`${DIRECTUS_URL}/items/${collection}`, {
    headers: apiHeaders(),
    params,
    timeout: DIRECTUS_TIMEOUT_MS,
  });
  return res.data.data;
}

async function directusPost(collection, data) {
  const res = await axios.post(`${DIRECTUS_URL}/items/${collection}`, data, {
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    timeout: DIRECTUS_TIMEOUT_MS,
  });
  invalidateWebAnimalPayloadForMutation(collection, null, data);
  return res.data.data;
}

async function directusPatch(collection, id, data) {
  const res = await axios.patch(`${DIRECTUS_URL}/items/${collection}/${id}`, data, {
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    timeout: DIRECTUS_TIMEOUT_MS,
  });
  if (collection === 'animals') autoCommentProfileCache.delete(String(id));
  invalidateWebAnimalPayloadForMutation(collection, id, data);
  return res.data.data;
}

async function directusDelete(collection, id) {
  await axios.delete(`${DIRECTUS_URL}/items/${collection}/${id}`, {
    headers: apiHeaders(),
    timeout: DIRECTUS_TIMEOUT_MS,
  });
  invalidateWebAnimalPayloadForMutation(collection, id);
  return true;
}

async function deleteAnimal(animalId) {
  return directusDelete('animals', animalId);
}

async function findTeamByTelegramId(telegramId) {
  const data = await directusGet('animals_team', {
    filter: { telegram_id: { _eq: telegramId }, is_active: { _eq: true } },
    fields: TEAM_READ_FIELDS,
    limit: 1,
  });
  return data[0] || null;
}

async function findTeamByPhone(phone) {
  const data = await directusGet('animals_team', {
    filter: { phone: { _eq: normalizePhone(phone) }, is_active: { _eq: true } },
    fields: TEAM_READ_FIELDS,
    limit: 1,
  });
  return data[0] || null;
}

async function bindTelegramId(teamId, telegramId) {
  return directusPatch('animals_team', teamId, { telegram_id: telegramId });
}

async function getCurrentUser(ctx) {
  return findTeamByTelegramId(ctx.from.id);
}

async function getAnimalById(id) {
  const data = await directusGet('animals', { filter: { id: { _eq: id } }, fields: ANIMAL_READ_FIELDS, limit: 1 });
  return data[0] || null;
}

function isGuestUser(user) {
  return !user || user.guest === true;
}

function publicAnimalsFilter(extra = {}) {
  return {
    ...(extra || {}),
    published: { _eq: true },
  };
}

function animalVisibleForCatalogUser(animal, user) {
  if (!animal) return false;
  if (isGuestUser(user)) {
    if (animal.is_archived === true || animal.archived === true) return false;
    return animal.published === true;
  }
  return true;
}

async function getAnimalForCatalogUser(animalId, user) {
  const animal = await getAnimalById(animalId);
  return animalVisibleForCatalogUser(animal, user) ? animal : null;
}

async function listAnimals(limit = 10, options = {}) {
  // Для гостей всегда показываем только опубликованные карточки.
  const filter = options.publicOnly ? publicAnimalsFilter() : {};
  if (options.location) {
    filter.location = { _eq: options.location };
  }
  const data = await directusGet('animals', {
    filter,
    fields: 'id,name,status,location,published',
    sort: 'name',
    limit,
  });
  return (data || []).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
}

async function searchAnimalsByName(query, limit = 10, options = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const data = await directusGet('animals', {
    filter: options.publicOnly
      ? publicAnimalsFilter({ name: { _icontains: q } })
      : { name: { _icontains: q } },
    fields: 'id,name,status,location,published',
    limit,
  });
  return data || [];
}

function catsListKeyboard(animals) {
  const catalogUrl = buildCatalogWebAppUrl();
  const rows = [];
  if (catalogUrl) rows.push([Markup.button.url('🐾 Открыть каталог с фото', catalogUrl)]);
  rows.push(...animals.map((animal) => [
    Markup.button.callback(`${animal.name || 'Без имени'} · ${formatStatus(animal.status)}`, `open_cat:${animal.id}`),
  ]));
  rows.push([Markup.button.callback('🏠 Выбрать площадку', 'welcome_list_cats')]);
  rows.push([Markup.button.callback('🔎 Новый поиск', 'welcome_find_cat')]);
  return Markup.inlineKeyboard(rows);
}

async function listAnimalLocations(options = {}) {
  const data = await directusGet('animals', {
    filter: options.publicOnly ? publicAnimalsFilter() : undefined,
    fields: 'location',
    limit: 500,
  });
  const configuredLocations = Object.keys(KOTOCAFE_MAP || {});
  const locations = [...new Set([
    ...configuredLocations,
    ...(data || []).map((animal) => String(animal.location || '').trim()).filter(Boolean),
  ])];
  return locations.sort((a, b) => formatLocation(a).localeCompare(formatLocation(b), 'ru'));
}

function catsLocationKeyboard(locations) {
  const catalogUrl = buildCatalogWebAppUrl();
  const rows = [];
  if (catalogUrl) rows.push([Markup.button.url('🐾 Открыть каталог с фото', catalogUrl)]);
  rows.push([Markup.button.callback('Все площадки', 'list_cats_location:all')]);
  for (const location of locations || []) {
    rows.push([Markup.button.callback(formatLocation(location), `list_cats_location:${location}`)]);
  }
  rows.push([Markup.button.callback('🔎 Поиск по имени', 'welcome_find_cat')]);
  return Markup.inlineKeyboard(rows);
}

async function showCatsLocationPicker(ctx) {
  const user = await ensureViewAnimalsAccess(ctx);
  if (!user) return;
  const locations = await listAnimalLocations({ publicOnly: isGuestUser(user) });
  return ctx.reply('📋 Список кошек\n\nСначала выберите площадку:', catsLocationKeyboard(locations));
}

async function showCatsList(ctx, options = {}) {
  const user = await ensureViewAnimalsAccess(ctx);
  if (!user) return;
  const location = options.location && options.location !== 'all' ? options.location : null;
  const animals = await listAnimals(100, { publicOnly: isGuestUser(user), location });
  if (!animals.length) return ctx.reply('Кошек пока не найдено.', await welcomeInlineMenu(await getCurrentUser(ctx)));
  const title = location ? `📋 Кошки · ${formatLocation(location)}` : '📋 Кошки · все площадки';
  return ctx.reply(title, catsListKeyboard(animals));
}

async function startFindCat(ctx) {
  const user = await ensureSearchAnimalsAccess(ctx);
  if (!user) return;
  sessions.set(ctx.from.id, { step: 'find_cat', data: {} });
  return ctx.reply('Напишите имя кошки или часть имени.');
}

function isGroupChat(ctx) {
  return ['group', 'supergroup'].includes(ctx.chat?.type);
}

function isPrivateChat(ctx) {
  return ctx.chat?.type === 'private';
}

function isChannelChat(ctx) {
  return ctx.chat?.type === 'channel';
}

function currentMessage(ctx) {
  return ctx.message || ctx.channelPost || ctx.editedMessage || ctx.editedChannelPost || {};
}

function commandReplyExtra(ctx, extra = {}) {
  const result = { ...extra };
  const message = currentMessage(ctx);

  // Для обычных групп, форумных тем и комментариев к постам канала отвечаем
  // именно в текущий thread. В личке и канале эти поля не добавляем.
  if (isGroupChat(ctx)) {
    if (message?.message_thread_id) result.message_thread_id = message.message_thread_id;
    if (message?.message_id) result.reply_to_message_id = message.message_id;
  }

  return result;
}


async function safeAnswerCbQuery(ctx, text = undefined, extra = undefined) {
  try {
    if (extra !== undefined) return await ctx.answerCbQuery(text, extra);
    if (text !== undefined) return await ctx.answerCbQuery(text);
    return await ctx.answerCbQuery();
  } catch (error) {
    const description = error?.response?.description || error?.message || '';
    // Telegram callback_query живёт недолго. Если кнопку нажали давно,
    // не валим основной сценарий: галерея/видео всё равно должны отправиться.
    if (/query is too old|response timeout expired|query ID is invalid/i.test(description)) {
      console.warn('ANSWER CALLBACK QUERY EXPIRED:', description);
      return null;
    }
    console.error('ANSWER CALLBACK QUERY ERROR:', error.response?.data || description);
    return null;
  }
}


function isChannelDiscussionPost(ctx) {
  const message = currentMessage(ctx);
  return Boolean(
    message.is_automatic_forward ||
    message.sender_chat?.type === 'channel' ||
    message.forward_from_chat?.type === 'channel' ||
    message.forward_origin?.type === 'channel'
  );
}

function autoCommentReplyExtra(ctx, extra = {}) {
  const result = { ...extra };
  const message = currentMessage(ctx);
  if (!isGroupChat(ctx)) return result;

  // Автокомментирование срабатывает на автопересланный пост канала
  // в linked discussion group. Достаточно reply_to_message_id: так Telegram
  // прикрепляет ответ к комментариям поста канала. message_thread_id оставляем
  // только когда Telegram прислал его явно, например для форумной темы.
  if (message?.message_thread_id) result.message_thread_id = message.message_thread_id;
  if (message?.message_id) result.reply_to_message_id = message.message_id;
  result.allow_sending_without_reply = false;

  return result;
}


function getMessageText(message) {
  return String(message?.text || message?.caption || '').trim();
}

function normalizeForSearch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`.,!?;:#()\[\]{}<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function botUsername(ctx) {
  return String(BOT_USERNAME || ctx.botInfo?.username || ctx.telegram?.botInfo?.username || '').replace(/^@/, '').toLowerCase();
}

async function ensureBotUsername(ctx) {
  if (BOT_USERNAME) return BOT_USERNAME;
  try {
    const me = await ctx.telegram.getMe();
    BOT_USERNAME = String(me?.username || '').replace(/^@/, '').toLowerCase();
    console.log('BOT USERNAME DETECTED:', BOT_USERNAME || '(empty)');
  } catch (error) {
    console.error('GET ME ERROR:', error.response?.data || error.message);
  }
  return BOT_USERNAME;
}

function messageMentionsBot(ctx, text) {
  if (!isGroupChat(ctx)) return false;

  const raw = String(text || '').trim();
  const username = botUsername(ctx);
  const lower = raw.toLowerCase();

  if (username && lower.includes(`@${username}`)) return true;
  if (/^@\w+/i.test(raw)) return true;

  const entities = [
    ...(ctx.message?.entities || []),
    ...(ctx.message?.caption_entities || []),
  ];

  if (entities.some((entity) => {
    if (entity.type !== 'mention') return false;
    const mention = raw.slice(entity.offset, entity.offset + entity.length).replace(/^@/, '').toLowerCase();
    return username && mention === username;
  })) return true;

  const replyFrom = ctx.message?.reply_to_message?.from;
  if (replyFrom?.is_bot && username && String(replyFrom.username || '').toLowerCase() === username) return true;

  return false;
}

function groupHelpText(ctx) {
  const username = botUsername(ctx) || 'catru_bot';
  return [
    'Я умею искать кошек в каталоге.',
    '',
    `@${username} фото Имя кошки`,
    `@${username} анкета Имя кошки`,
    `@${username} инфо Имя кошки`,
    `@${username} отзыв Имя кошки`,
    `@${username} донаты Имя кошки`,
    `@${username} история Имя кошки`,
    `@${username} видео Имя кошки`,
    '',
    'Пример:',
    `@${username} фото Мандарин`,
  ].join('\n');
}

function parseGroupCommand(ctx, text) {
  const raw = String(text || '').trim();
  if (!raw) return { addressed: false, command: null, query: '' };

  let addressed = false;
  let rest = raw;

  // В группах считаем обращением к боту любое сообщение, которое:
  // 1) начинается с @любое_имя_бота
  // 2) начинается с /photo, /фото и т.п.
  // 3) начинается с одной из явных команд: фото / анкета / история / видео
  // Не проверяем BOT_USERNAME: это уже ломалось, когда username не был задан/не определился.
  const mentionMatch = rest.match(/^@[A-Za-z0-9_]+\s*/i);
  if (mentionMatch) {
    addressed = true;
    rest = rest.slice(mentionMatch[0].length).trim();
  }

  const slashMatch = rest.match(/^\/(photo|photos|anketa|card|info|review|reviews|donations|donates|story|history|video|фото|анкета|инфо|отзыв|отзывы|донаты|донат|история|видео)(@[A-Za-z0-9_]+)?(?=\s|$)\s*/i);
  if (slashMatch) {
    addressed = true;
    rest = rest.slice(slashMatch[0].length).trim();
    return { addressed, command: normalizeGroupCommand(slashMatch[1]), query: rest };
  }

  if (!rest) return { addressed, command: null, query: '' };

  const firstWordMatch = rest.match(/^(фото|анкета|инфо|отзыв|отзывы|донаты|донат|история|видео|photo|photos|anketa|card|info|review|reviews|donations|donates|story|history|video)(?=\s|$)\s*/i);
  if (firstWordMatch) {
    addressed = true;
    rest = rest.slice(firstWordMatch[0].length).trim();
    return { addressed, command: normalizeGroupCommand(firstWordMatch[1]), query: rest };
  }

  if (addressed) return { addressed: true, command: null, query: rest };
  return { addressed: false, command: null, query: '' };
}

function shouldHandleGroupMessage(ctx) {
  if (!isGroupChat(ctx)) return false;
  const text = getMessageText(ctx.message);
  if (!text) return false;
  return /^@[A-Za-z0-9_]+(?=\s|$)/i.test(text)
    || /^\/(photo|photos|anketa|card|info|review|reviews|donations|donates|story|history|video|фото|анкета|инфо|отзыв|отзывы|донаты|донат|история|видео)(@[A-Za-z0-9_]+)?(?=\s|$)/i.test(text)
    || /^(фото|анкета|инфо|отзыв|отзывы|донаты|донат|история|видео|photo|photos|anketa|card|info|review|reviews|donations|donates|story|history|video)(?=\s|$)/i.test(text);
}

function normalizeGroupCommand(command) {
  const value = String(command || '').trim().toLowerCase().replace(/ё/g, 'е');
  const map = {
    'фото': 'photo',
    'фотки': 'photo',
    'фотку': 'photo',
    'photo': 'photo',
    'photos': 'photo',
    'анкета': 'card',
    'анкету': 'card',
    'инфо': 'card',
    'info': 'card',
    'отзыв': 'review',
    'отзывы': 'review',
    'донаты': 'donations',
    'donations': 'donations',
    'donates': 'donations',
    'review': 'review',
    'reviews': 'review',
    'card': 'card',
    'anketa': 'card',
    'история': 'story',
    'историю': 'story',
    'story': 'story',
    'history': 'story',
    'видео': 'video',
    'video': 'video',
  };
  return map[value] || null;
}

function cleanupPhotoQuery(ctx, text) {
  const parsed = parseGroupCommand(ctx, text);
  return parsed.query || '';
}

function extractFileId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value.id || value.directus_files_id || value.file_id || null;
  return null;
}

const ANIMAL_MEDIA_BASE_READ_FIELDS = 'id,animal_id,type,file_id,is_main,sort,caption';
let animalMediaOptionalReadFields = ['telegram_file_id', 'original_file_id', 'web_file_id', 'webm_file_id'];

function animalMediaReadFields() {
  return [ANIMAL_MEDIA_BASE_READ_FIELDS, ...animalMediaOptionalReadFields].filter(Boolean).join(',');
}

async function getAnimalMedia(animalId, type, limit = 10) {
  const params = {
    filter: {
      animal_id: { _eq: animalId },
      type: { _eq: type },
    },
    fields: animalMediaReadFields(),
    sort: type === 'video' ? '-is_main,sort' : '-is_main,sort',
    limit,
  };
  try {
    const rows = await directusGet('animal_media', params);
    return rows || [];
  } catch (error) {
    const description = JSON.stringify(error.response?.data || error.message || '');
    const missingOptionalField = animalMediaOptionalReadFields.find((field) => description.includes(field));
    if (missingOptionalField) {
      animalMediaOptionalReadFields = animalMediaOptionalReadFields.filter((field) => field !== missingOptionalField);
      const rows = await directusGet('animal_media', { ...params, fields: animalMediaReadFields() });
      return rows || [];
    }
    throw error;
  }
}

function getAnimalMediaWebFileId(row) {
  if (!row) return null;
  return extractFileId(row.web_file_id) || extractFileId(row.file_id);
}

function getAnimalMediaWebmFileId(row) {
  if (!row) return null;
  return extractFileId(row.webm_file_id) || null;
}

function getAnimalMediaFileIds(rows) {
  return (rows || []).map((row) => extractFileId(row.file_id)).filter(Boolean);
}

async function getActiveAnimalNeeds(animalId) {
  const rows = await directusGet('animal_needs', {
    filter: {
      animal_id: { _eq: animalId },
      is_active: { _eq: true },
    },
    fields: 'id,title,url,is_active,created_at',
    sort: 'created_at',
    limit: 50,
  });
  return (rows || []).map((need) => ({
    ...need,
    url: safeExternalUrl(need?.url),
  }));
}

function formatNeedLine(need) {
  const title = String(need?.title || '').trim() || 'Нужда';
  const url = String(need?.url || '').trim();
  return url ? `• ${title}\n  🔗 ${url}` : `• ${title}`;
}

function formatNeedsBlock(needs) {
  if (!needs?.length) return null;
  return ['🙏 Сейчас нужно:', ...needs.map(formatNeedLine)].join('\n');
}

const EDIT_ANIMAL_PERMISSION_ID = 3;

async function canManageNeeds(user) {
  if (!user) {
    console.log("[PERM] canManageNeeds: user is null");
    return false;
  }

  const result = hasRolePermission(user, {
    id: EDIT_ANIMAL_PERMISSION_ID,
  });

  console.log("[PERM] ===== canManageNeeds =====");
  console.log("[PERM] user.id:", user.id);
  console.log("[PERM] role_id:", user.role_id);
  console.log("[PERM] username:", user.username);
  console.log("[PERM] permission id:", EDIT_ANIMAL_PERMISSION_ID);
  console.log("[PERM] permissions:", JSON.stringify(user.permissions, null, 2));
  console.log("[PERM] result:", result);
  console.log("[PERM] ==========================");

  return result;
}

async function ensureNeedsAccess(ctx) {
  const user = await getCurrentUser(ctx);
  if (!user) {
    await ctx.reply('Нет доступа. Напишите /start для авторизации.');
    return null;
  }
  if (!(await canManageNeeds(user))) {
    await ctx.reply('У вас нет прав на управление нуждами кошки.');
    return null;
  }
  return user;
}

async function ensureCafeEditAccess(ctx) {
  const user = await getCurrentUser(ctx);
  if (!user || !(await hasRolePermission(user, { id: CAFE_EDIT_PERMISSION_ID }))) {
    await safeAnswerCbQuery(ctx, 'Нет прав', { show_alert: true });
    await ctx.reply('Редактировать галерею котокафе может только администратор.');
    return null;
  }
  return user;
}

async function canViewCafeMedia(user) {
  return Boolean(user) && await hasRolePermission(user, { id: BUTTON_VIEW_ANIMALS_PERMISSION_ID });
}

async function createAnimalNeed(animalId, title, url = null) {
  return directusPost('animal_needs', {
    animal_id: animalId,
    title,
    url: validateOptionalExternalUrl(url, 'Ссылка нужды'),
    is_active: true,
  });
}

async function deactivateAnimalNeed(needId) {
  return directusPatch('animal_needs', needId, { is_active: false });
}


async function getAnimalIdByNeedId(needId) {
  const rows = await directusGet('animal_needs', {
    filter: { id: { _eq: needId } },
    fields: 'id,animal_id',
    limit: 1,
  });
  const need = rows?.[0];
  return extractFileId(need?.animal_id) || need?.animal_id || null;
}

async function getAnimalNeedById(needId) {
  const rows = await directusGet('animal_needs', {
    filter: { id: { _eq: needId }, is_active: { _eq: true } },
    fields: 'id,title,url,animal_id,is_active',
    limit: 1,
  });
  const need = rows?.[0] || null;
  return need ? { ...need, url: safeExternalUrl(need.url) } : null;
}

function shortButtonText(text, maxLength = 46) {
  const value = String(text || '').trim().replace(/\s+/g, ' ');
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}


function needsManagerKeyboard(animal, needs) {
  const rows = [];
  rows.push([Markup.button.callback('➕ Добавить нужду', `add_need:${animal.id}`)]);
  for (const need of needs || []) {
    const title = String(need.title || 'Нужда').slice(0, 45);
    rows.push([Markup.button.callback(`✅ Закрыть: ${title}`, `close_need:${need.id}`)]);
  }
  rows.push([Markup.button.callback('⬅️ Назад к редактированию', `open_cat:${animal.id}`)]);
  return Markup.inlineKeyboard(rows);
}

async function showAnimalNeedsManager(ctx, animal) {
  const needs = await getActiveAnimalNeeds(animal.id);
  const text = [
    `🙏 Нужды: ${animal.name || 'Кошка'}`,
    '',
    needs.length ? needs.map((need, index) => `${index + 1}. ${String(need.title || 'Нужда').trim()}${need.url ? `\n   🔗 ${need.url}` : ''}`).join('\n') : 'Активных нужд нет.',
  ].join('\n');
  return ctx.reply(text, needsManagerKeyboard(animal, needs));
}

async function nextAnimalMediaSort(animalId, type) {
  const rows = await directusGet('animal_media', {
    filter: { animal_id: { _eq: animalId }, type: { _eq: type } },
    fields: 'sort',
    sort: '-sort',
    limit: 1,
  });
  return Number(rows?.[0]?.sort || 0) + 10;
}

async function clearAnimalMainPhoto(animalId) {
  const rows = await directusGet('animal_media', {
    filter: { animal_id: { _eq: animalId }, type: { _eq: 'photo' }, is_main: { _eq: true } },
    fields: 'id',
    limit: 50,
  });
  for (const row of rows || []) {
    await directusPatch('animal_media', row.id, { is_main: false });
  }
}

async function clearAnimalMainVideo(animalId) {
  const rows = await directusGet('animal_media', {
    filter: { animal_id: { _eq: animalId }, type: { _eq: 'video' }, is_main: { _eq: true } },
    fields: 'id',
    limit: 50,
  });
  for (const row of rows || []) {
    await directusPatch('animal_media', row.id, { is_main: false });
  }
}

async function clearAnimalAvatar(animalId) {
  const rows = await directusGet('animal_media', {
    filter: { animal_id: { _eq: animalId }, type: { _eq: 'avatar' } },
    fields: 'id',
    sort: 'sort',
    limit: 50,
  });
  for (const row of rows || []) {
    await animalMedia.deleteAnimalMedia(row.id);
  }
}

async function createAnimalMedia(animalId, fileId, type = 'photo', options = {}) {
  const isMain = Boolean(options.is_main);
  if (type === 'photo' && isMain) await clearAnimalMainPhoto(animalId);
  if (type === 'video' && isMain) await clearAnimalMainVideo(animalId);
  if (type === 'avatar') await clearAnimalAvatar(animalId);
  const sort = options.sort ?? await nextAnimalMediaSort(animalId, type);
  const payload = {
    animal_id: animalId,
    file_id: fileId,
    type,
    is_main: isMain,
    sort,
    caption: options.caption || null,
  };
  if (options.source) payload[ANIMAL_MEDIA_SOURCE_FIELD] = options.source;
  if (options.original_file_id) payload.original_file_id = options.original_file_id;
  if (options.web_file_id) payload.web_file_id = options.web_file_id;
  if (options.webm_file_id) payload.webm_file_id = options.webm_file_id;
  try {
    return await directusPost('animal_media', payload);
  } catch (error) {
    const message = JSON.stringify(error?.response?.data || error?.message || '');
    if (!options.source || !message.includes(ANIMAL_MEDIA_SOURCE_FIELD)) throw error;
    console.warn('ANIMAL MEDIA SOURCE FIELD MISSING, RETRY WITHOUT SOURCE');
    const fallbackPayload = { ...payload };
    delete fallbackPayload[ANIMAL_MEDIA_SOURCE_FIELD];
    return directusPost('animal_media', fallbackPayload);
  }
}



async function addAnimalAvatar(animalId, fileId, options = {}) {
  return createAnimalMedia(animalId, fileId, 'avatar', options);
}

async function ensureAnimalAvatarFromPhoto(animalId, fileId, options = {}) {
  const existing = await getAnimalMedia(animalId, 'avatar', 1);
  if (existing.length) return existing[0];
  return addAnimalAvatar(animalId, fileId, {
    caption: options.caption || null,
    source: options.source || 'auto_from_photo',
    original_file_id: options.original_file_id,
    web_file_id: options.web_file_id,
  });
}

async function getAnimalMediaById(mediaId) {
  const rows = await directusGet('animal_media', {
    filter: { id: { _eq: mediaId } },
    fields: 'id,type,file_id,animal_id,caption,is_main,sort',
    limit: 1,
  });
  return rows?.[0] || null;
}



async function getAllAnimalMedia(animalId, limit = 500) {
  const rows = await directusGet('animal_media', {
    filter: { animal_id: { _eq: animalId } },
    fields: 'id,type,file_id,animal_id,caption,is_main,sort',
    sort: 'sort',
    limit,
  });
  return rows || [];
}

async function getAnimalMediaFileUsage(fileId, limit = 20) {
  const id = extractFileId(fileId);
  if (!id) return [];
  const rows = await directusGet('animal_media', {
    filter: { file_id: { _eq: id } },
    fields: 'id,animal_id,file_id',
    limit,
  });
  return rows || [];
}

async function deleteDirectusFile(fileId) {
  const id = extractFileId(fileId);
  if (!id) return false;
  await axios.delete(`${DIRECTUS_URL}/files/${encodeURIComponent(id)}`, {
    headers: apiHeaders(),
    timeout: DIRECTUS_UPLOAD_TIMEOUT_MS,
  });
  return true;
}

// Media for the two physical cafes is deliberately kept separate from animal_media:
// cafe_id is the stable location key already used throughout the bot.
const CAFE_MEDIA_CAFES = {
  novokuznetskaya: '\u041d\u043e\u0432\u043e\u043a\u0443\u0437\u043d\u0435\u0446\u043a\u0430\u044f',
  prospekt_mira: '\u041f\u0440\u043e\u0441\u043f\u0435\u043a\u0442 \u041c\u0438\u0440\u0430',
};

function cafeMediaCafeName(cafeId) {
  return CAFE_MEDIA_CAFES[cafeId] || '\u041a\u043e\u0442\u043e\u043a\u0430\u0444\u0435';
}

async function getCafeMedia(cafeId, type = null, limit = 100) {
  const filter = { cafe_code: { _eq: cafeId } };
  if (type) filter.type = { _eq: type };
  return (await directusGet('cafe_media', {
    filter,
    fields: 'id,cafe_code,type,file,sort,caption',
    sort: 'sort',
    limit,
  })) || [];
}

async function nextCafeMediaSort(cafeId, type) {
  const rows = await getCafeMedia(cafeId, type, 1);
  // getCafeMedia sorts ascending; fetch the last value when a gallery grows.
  const all = await directusGet('cafe_media', {
    filter: { cafe_code: { _eq: cafeId }, type: { _eq: type } },
    fields: 'sort', sort: '-sort', limit: 1,
  });
  return Number(all?.[0]?.sort || rows?.[0]?.sort || 0) + 10;
}

async function createCafeMedia(cafeId, fileId, type, caption = null) {
  return directusPost('cafe_media', {
    cafe_code: cafeId,
    file: fileId,
    type,
    section: 'atmosphere',
    status: 'published',
    sort: await nextCafeMediaSort(cafeId, type),
    caption: caption || null,
  });
}

async function getCafeMediaById(mediaId) {
  const rows = await directusGet('cafe_media', {
    filter: { id: { _eq: mediaId } },
    fields: 'id,cafe_code,type,file,sort,caption', limit: 1,
  });
  return rows?.[0] || null;
}

async function deleteCafeMediaWithOwnedFile(media) {
  const fileId = extractFileId(media?.file);
  await directusDelete('cafe_media', media.id);
  if (!fileId) return { fileDeleted: false, fileSkipped: true };
  const [cafeUsage, animalUsage] = await Promise.all([
    directusGet('cafe_media', { filter: { file: { _eq: fileId } }, fields: 'id', limit: 1 }),
    getAnimalMediaFileUsage(fileId, 1),
  ]);
  if (cafeUsage?.length || animalUsage?.length) return { fileDeleted: false, fileSkipped: true };
  await deleteDirectusFile(fileId);
  return { fileDeleted: true, fileSkipped: false };
}

function cafeMediaHomeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('\u{1F3E0} \u041d\u043e\u0432\u043e\u043a\u0443\u0437\u043d\u0435\u0446\u043a\u0430\u044f', 'cafe_media:novokuznetskaya')],
    [Markup.button.callback('\u{1F3E0} \u041f\u0440\u043e\u0441\u043f\u0435\u043a\u0442 \u041c\u0438\u0440\u0430', 'cafe_media:prospekt_mira')],
  ]);
}

function cafeMediaKeyboard(cafeId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('\u{1F4F8} \u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0444\u043e\u0442\u043e', 'cafe_upload:photo:' + cafeId), Markup.button.callback('\u{1F3A5} \u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0432\u0438\u0434\u0435\u043e', 'cafe_upload:video:' + cafeId)],
    [Markup.button.callback('\u{1F5D1} \u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0444\u043e\u0442\u043e', 'cafe_delete:photo:' + cafeId), Markup.button.callback('\u{1F5D1} \u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0432\u0438\u0434\u0435\u043e', 'cafe_delete:video:' + cafeId)],
    [Markup.button.callback('\u25C0\uFE0F \u0412\u044b\u0431\u0440\u0430\u0442\u044c \u0434\u0440\u0443\u0433\u043e\u0435 \u043a\u043e\u0442\u043e\u043a\u0430\u0444\u0435', 'cafe_media_home')],
    [Markup.button.callback('\u{1F3E0} \u0413\u043b\u0430\u0432\u043d\u043e\u0435 \u043c\u0435\u043d\u044e', 'cafe_media_exit')],
  ]);
}

function cafeMediaViewKeyboard(cafeId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('\u{1F4F8} \u041f\u0440\u043e\u0441\u043c\u043e\u0442\u0440 \u0444\u043e\u0442\u043e', 'cafe_view:photo:' + cafeId), Markup.button.callback('\u{1F3A5} \u041f\u0440\u043e\u0441\u043c\u043e\u0442\u0440 \u0432\u0438\u0434\u0435\u043e', 'cafe_view:video:' + cafeId)],
    [Markup.button.callback('\u25C0\uFE0F \u0412\u044b\u0431\u0440\u0430\u0442\u044c \u0434\u0440\u0443\u0433\u043e\u0435 \u043a\u043e\u0442\u043e\u043a\u0430\u0444\u0435', 'cafe_media_home')],
    [Markup.button.callback('\u{1F3E0} \u0413\u043b\u0430\u0432\u043d\u043e\u0435 \u043c\u0435\u043d\u044e', 'cafe_media_exit')],
  ]);
}



async function getAnimalDeleteBlockers(animalId) {
  const [needs, reviews, donations, shareInvites] = await Promise.all([
    countDirectusItems('animal_needs', { animal_id: { _eq: animalId } }).catch(() => 0),
    countDirectusItems('animal_reviews', { animal_id: { _eq: animalId } }).catch(() => 0),
    countDirectusItems('animals_donations', { animal_id: { _eq: animalId } }).catch(() => 0),
    countDirectusItems('animal_share_invites', { animal_id: { _eq: animalId } }).catch(() => 0),
  ]);
  return [
    needs ? `нужды: ${needs}` : null,
    reviews ? `отзывы: ${reviews}` : null,
    donations ? `донаты: ${donations}` : null,
    shareInvites ? `приглашения: ${shareInvites}` : null,
  ].filter(Boolean);
}

function mediaTypeLabel(type) {
  if (type === 'video') return 'видео';
  if (type === 'avatar') return 'аватар';
  return 'фото';
}

function mediaTypeEmoji(type) {
  if (type === 'video') return '🎥';
  if (type === 'avatar') return '🖼';
  return '📸';
}

function mediaItemTitle(row, index, type) {
  const caption = String(row?.caption || '').trim();
  if (caption) return caption.length > 52 ? `${caption.slice(0, 51)}…` : caption;
  return `${mediaTypeLabel(type)} ${index + 1}`;
}

function manageAnimalMediaKeyboard(animal, type, rows) {
  const keyboardRows = [];
  for (let i = 0; i < (rows || []).length; i += 1) {
    const row = rows[i];
    const title = `${row?.is_main ? '★ ' : ''}${i + 1}. ${mediaItemTitle(row, i, type)}`;
    const mainLabel = type === 'avatar'
      ? '✅ Текущий'
      : row?.is_main
      ? (type === 'video' ? '✅ Первое' : '✅ Главное')
      : (type === 'video' ? '🎬 Сделать первым' : '⭐ Сделать главным');
    const mainAction = type === 'avatar'
      ? `noop_main:${row.id}`
      : row?.is_main
        ? `noop_main:${row.id}`
        : (type === 'video' ? `svm:${row.id}` : `smm:${row.id}`);
    keyboardRows.push([
      Markup.button.callback(title, `noop_main:${row.id}`),
      Markup.button.callback(mainLabel, mainAction),
    ]);
  }
  keyboardRows.push([Markup.button.callback('◀️ Назад к медиа', `edit_media:${animal.id}`)]);
  return Markup.inlineKeyboard(keyboardRows);
}

function confirmDeleteMediaKeyboard(mediaRow, animalId) {
  const type = mediaRow?.type === 'video' ? 'video' : (mediaRow?.type === 'avatar' ? 'avatar' : 'photo');
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Да, удалить', `cdm:${mediaRow.id}`)],
    [Markup.button.callback('❌ Нет, назад', `mm:${type}:${animalId}`)],
  ]);
}

async function showAnimalMediaManager(ctx, animal, type) {
  const rows = await getAnimalMedia(animal.id, type, 50);
  const label = mediaTypeLabel(type);
  const emoji = mediaTypeEmoji(type);
  const title = type === 'avatar'
    ? `${emoji} Просмотр аватара: ${animal.name || 'Кошка'}`
    : `${emoji} Управление ${label}: ${animal.name || 'Кошка'}`;

  if (!rows.length) {
    return ctx.reply([title, '', `У этой кошки пока нет ${label}`].join('\n'),
      Markup.inlineKeyboard([[Markup.button.callback('◀️ Назад к медиа', `edit_media:${animal.id}`)]]));
  }

  if (type === 'avatar') {
    const currentAvatar = rows[0];
    const fileId = extractFileId(currentAvatar?.file_id);
    const caption = [
      title,
      '',
      'Ниже текущий аватар.',
      'Удаление отключено: аватар можно только посмотреть или заменить.',
    ].join('\n');
    if (!fileId) return ctx.reply(caption);
    if (currentAvatar?.telegram_file_id) {
      return ctx.replyWithPhoto(currentAvatar.telegram_file_id, commandReplyExtra(ctx, { caption }));
    }
    return sendDirectusPhoto(ctx, fileId, caption, commandReplyExtra(ctx, { caption }));
  }

  const lines = [title, '', 'Выберите действие:', ''];
  rows.forEach((row, index) => {
    const itemTitle = mediaItemTitle(row, index, type);
    const marker = row?.is_main ? (type === 'video' ? ' [первое]' : ' [главное]') : '';
    lines.push(`${index + 1}. ${itemTitle}${marker}`);
  });
  lines.push('', 'Кнопка "Удалить" сначала покажет подтверждение. Если файл больше нигде не используется, он тоже удалится из Directus.');

  return ctx.reply(lines.join('\n'), manageAnimalMediaKeyboard(animal, type, rows));
}

function getAnimalPhotoIds(animal) {
  return [];
}

async function getDirectusPhotoInput(fileId) {
  const response = await axios.get(`${DIRECTUS_URL}/assets/${fileId}`, {
    headers: apiHeaders(),
    responseType: 'stream',
    timeout: 30000,
  });
  return { source: response.data, filename: `${fileId}.jpg` };
}

async function downloadDirectusPhotoToTemp(fileId) {
  const safeId = String(fileId).replace(/[^a-z0-9_-]/ig, '');
  const filePath = path.join(os.tmpdir(), `catbot-${safeId}-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`);
  const response = await axios.get(`${DIRECTUS_URL}/assets/${fileId}`, {
    headers: apiHeaders(),
    responseType: 'arraybuffer',
    timeout: 30000,
  });
  await fs.promises.writeFile(filePath, Buffer.from(response.data));
  return filePath;
}

async function safeUnlink(filePath) {
  try {
    if (filePath) await fs.promises.unlink(filePath);
  } catch (_) {}
}

async function sendDirectusPhoto(ctx, fileId, caption = '', extra = {}) {
  const input = await getDirectusPhotoInput(fileId);
  const options = { ...extra, caption };
  if (!options.reply_markup) delete options.reply_markup;
  return ctx.replyWithPhoto(input, options);
}

function animalPhotoCaption(animal, count) {
  return [
    `🐱 ${animal.name || 'Кошка'}`,
    animal.status ? `Статус: ${formatStatus(animal.status)}` : null,
    animal.location ? `Котокафе: ${formatLocation(animal.location)}` : null,
    count ? `Фото: ${count}` : null,
  ].filter(Boolean).join('\n');
}

function telegramPhotoFileId(message) {
  const photos = message?.photo;
  return Array.isArray(photos) && photos.length ? photos[photos.length - 1]?.file_id || null : null;
}

async function cacheTelegramPhotoId(mediaRow, message) {
  if (!mediaRow?.id || !Object.prototype.hasOwnProperty.call(mediaRow, 'telegram_file_id')) return;
  const telegramFileId = telegramPhotoFileId(message);
  if (!telegramFileId || telegramFileId === mediaRow.telegram_file_id) return;
  try {
    await directusPatch('animal_media', mediaRow.id, { telegram_file_id: telegramFileId });
  } catch (error) {
    console.error('CACHE TELEGRAM PHOTO ID ERROR:', error.response?.data || error.message);
  }
}

function isWrongTelegramFileIdentifierError(error) {
  const description = String(error?.response?.description || error?.description || error?.message || '');
  return /Wrong file identifier|HTTP URL specified/i.test(description);
}

async function clearCachedTelegramPhotoId(mediaRow) {
  if (!mediaRow?.id || !Object.prototype.hasOwnProperty.call(mediaRow, 'telegram_file_id')) return;
  if (!mediaRow.telegram_file_id) return;
  try {
    await directusPatch('animal_media', mediaRow.id, { telegram_file_id: null });
  } catch (error) {
    console.error('CLEAR TELEGRAM PHOTO ID ERROR:', error.response?.data || error.message);
  }
}

function withoutCachedTelegramPhotoIds(mediaRows) {
  return (mediaRows || []).map((row) => {
    if (!row || !Object.prototype.hasOwnProperty.call(row, 'telegram_file_id')) return row;
    return { ...row, telegram_file_id: null };
  });
}

async function sendAnimalPhotoAlbum(ctx, animal, mediaRows) {
  const items = mediaRows.slice(0, 10).map((row) => ({
    row,
    directusFileId: extractFileId(row.file_id),
    telegramFileId: String(row.telegram_file_id || '').trim() || null,
    localFilePath: null,
  })).filter((item) => item.telegramFileId || item.directusFileId);
  const tempFiles = [];

  try {
    const pending = items.filter((item) => !item.telegramFileId);
    for (let start = 0; start < pending.length; start += PHOTO_DOWNLOAD_CONCURRENCY) {
      const batch = pending.slice(start, start + PHOTO_DOWNLOAD_CONCURRENCY);
      await Promise.all(batch.map(async (item) => {
        const filePath = await downloadDirectusPhotoToTemp(item.directusFileId);
        item.localFilePath = filePath;
        tempFiles.push(filePath);
      }));
    }

    const media = items.map((item, index) => ({
      type: 'photo',
      media: item.telegramFileId || { source: item.localFilePath, filename: `${item.directusFileId}.jpg` },
      ...(index === 0 ? { caption: animalPhotoCaption(animal, items.length) } : {}),
    }));
    const sentMessages = await ctx.replyWithMediaGroup(media, commandReplyExtra(ctx));
    await Promise.all(items.map((item, index) => cacheTelegramPhotoId(item.row, sentMessages?.[index])));
    return sentMessages;
  } finally {
    await Promise.all(tempFiles.map(safeUnlink));
  }
}


function ageFromBirthDate(birthDate) {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  if (now.getDate() < birth.getDate()) months -= 1;
  if (months < 0) return null;
  if (months < 12) return `${months} мес.`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? `${years} г. ${rest} мес.` : `${years} г.`;
}


function humanAgeFromBirthDate(birthDate) {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;

  const now = new Date();
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  if (now.getDate() < birth.getDate()) months -= 1;
  if (months < 0) return null;

  if (months < 12) {
    if (months === 1) return '1 месяц';
    if ([2, 3, 4].includes(months)) return `${months} месяца`;
    return `${months} месяцев`;
  }

  const years = Math.floor(months / 12);
  const rest = months % 12;

  let yearsText = `${years} лет`;
  if (years % 10 === 1 && years % 100 !== 11) yearsText = `${years} год`;
  else if ([2, 3, 4].includes(years % 10) && ![12, 13, 14].includes(years % 100)) yearsText = `${years} года`;

  if (!rest) return yearsText;

  let monthsText = `${rest} месяцев`;
  if (rest === 1) monthsText = '1 месяц';
  else if ([2, 3, 4].includes(rest)) monthsText = `${rest} месяца`;

  return `${yearsText} и ${monthsText}`;
}

function colorHumanLabel(color, note, sex) {
  if (note) return String(note).trim();

  const isFemale = formatSex(sex) === 'кошка';
  const map = {
    black: isFemale ? 'чёрная' : 'чёрный',
    white: isFemale ? 'белая' : 'белый',
    gray: isFemale ? 'серая' : 'серый',
    ginger: isFemale ? 'рыжая' : 'рыжий',
    cream: isFemale ? 'кремовая' : 'кремовый',
    tabby: isFemale ? 'полосатая' : 'полосатый',
    bicolor: isFemale ? 'двухцветная' : 'двухцветный',
    tricolor: isFemale ? 'трёхцветная' : 'трёхцветный',
    tortie: isFemale ? 'черепаховая' : 'черепаховый',
    colorpoint: 'колор-пойнт',
    other: null,
  };

  return map[color] || null;
}

function animalHumanLead(animal) {
  const sex = formatSex(animal?.sex);
  const isMale = sex === 'кот';
  const isFemale = sex === 'кошка';
  const genderWord = isMale ? 'мальчик' : isFemale ? 'девочка' : 'кошка';
  const color = colorHumanLabel(animal?.color, animal?.color_note, animal?.sex);
  const age = humanAgeFromBirthDate(animal?.birth_date);
  const location = formatLocation(animal?.location);
  const status = formatStatus(animal?.status);

  const firstLineParts = [
    color ? `${color} ${genderWord}` : genderWord,
    age,
  ].filter(Boolean);

  const lines = [];
  if (firstLineParts.length) {
    const first = firstLineParts.join(', ');
    lines.push(`${first.charAt(0).toUpperCase()}${first.slice(1)}.`);
  }

  if (location && location !== 'не указана') {
    const statusTail = status === 'Ищет дом' ? ' и ищет дом' : '';
    lines.push(`Живёт в котокафе на ${location}${statusTail}.`);
  } else if (status === 'Ищет дом') {
    lines.push('Ищет дом.');
  }

  return lines.join('\n');
}

function animalLifeLead(animal) {
  const parts = [];

  if (animal?.good_with_cats === true) parts.push('с кошками общается хорошо');
  else if (animal?.good_with_cats === false) parts.push('с кошками не ладит');
  else parts.push('опыта общения с кошками не было');

  if (animal?.good_with_children === true) parts.push('с детьми ладит');
  else if (animal?.good_with_children === false) parts.push('с детьми не ладит');
  else parts.push('опыта общения с детьми не было');

  if (animal?.good_with_dogs === true) parts.push('с собаками общается хорошо');
  else if (animal?.good_with_dogs === false) parts.push('с собаками не ладит');
  else parts.push('опыта общения с собаками не было');

  const text = parts.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function animalHealthLead(animal) {
  const isMale = formatSex(animal?.sex) === 'кот';
  const parts = [];

  if (animal?.vaccinated === true) parts.push(isMale ? 'вакцинирован' : 'вакцинирована');
  else if (animal?.vaccinated === false) parts.push(isMale ? 'не вакцинирован' : 'не вакцинирована');

  if (animal?.sterilized === true) parts.push(isMale ? 'кастрирован' : 'стерилизована');
  else if (animal?.sterilized === false) parts.push(isMale ? 'не кастрирован' : 'не стерилизована');

  if (animal?.chipped === true) parts.push(isMale ? 'чипирован' : 'чипирована');
  else if (animal?.chipped === false) parts.push('без чипа');

  if (animal?.parasite_treated === true) parts.push(isMale ? 'обработан от паразитов' : 'обработана от паразитов');
  else if (animal?.parasite_treated === false) parts.push(isMale ? 'не обработан от паразитов' : 'не обработана от паразитов');

  if (!parts.length) return 'Информация о здоровье пока уточняется.';

  const text = parts.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function normalizeRequirementText(text) {
  return String(text || '').trim().replace(/^[-—–]$/, '');
}

function normalizeCommentText(text) {
  return String(text || '').trim().replace(/^[-—–]$/, '');
}

function escapeTelegramHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function adoptionRequirementsText(animal) {
  const base = 'Сетки на окнах, отсутствие самовыгула, заключение договора.';
  const extra = normalizeRequirementText(animal?.adoption_requirements_other);
  if (!extra) return base;
  return `${base}\n${extra}`;
}


function yesNo(value) {
  if (value === true) return 'да';
  if (value === false) return 'нет';
  return 'не указано';
}

function buildAnimalCardText(freshAnimal, needs = []) {
  const h = escapeTelegramHtml;
  const needLines = (needs || []).map((need) => {
    const title = String(need?.title || '').trim() || 'Нужда';
    const url = String(need?.url || '').trim();
    return url ? `• ${h(title)}\n  🔗 ${h(url)}` : `• ${h(title)}`;
  });

  return [
    `🐱 <b>${h(freshAnimal.name || 'Кошка')}</b>`,
    '',
    `Статус: ${h(formatStatus(freshAnimal.status))}`,
    h(animalHumanLead(freshAnimal)),
    '',
    `<b>Характер и быт</b>`,
    h(animalLifeLead(freshAnimal)),
    normalizeCommentText(freshAnimal.character_comment) ? h(normalizeCommentText(freshAnimal.character_comment)) : null,
    '',
    `<b>Требования к пристройству</b>`,
    h(adoptionRequirementsText(freshAnimal)),
    '',
    `<b>Здоровье</b>`,
    h(animalHealthLead(freshAnimal)),
    normalizeCommentText(freshAnimal.health_comment) ? h(normalizeCommentText(freshAnimal.health_comment)) : null,
    freshAnimal.short_description ? `\n<b>Описание</b>\n${h(freshAnimal.short_description)}` : null,
    needLines.length ? `\n<b>🙏 Сейчас нужно</b>\n${needLines.join('\n')}` : null,
  ].filter(Boolean).join('\n');
}

async function getMainAnimalPhotoId(animalId) {
  const rows = await getAnimalMedia(animalId, 'photo', 10);
  const main = (rows || []).find((row) => row.is_main);
  return extractFileId(main?.file_id) || getAnimalMediaFileIds(rows)[0] || null;
}

async function sendAnimalTextCard(ctx, animal, options = {}) {
  const freshAnimal = await getAnimalById(animal.id);
  if (!freshAnimal) return ctx.reply('Кошка не найдена.');
  const needs = await getActiveAnimalNeeds(freshAnimal.id);
  const keyboard = animalCardActionKeyboard(freshAnimal, options);
  return ctx.reply(buildAnimalCardText(freshAnimal, needs), commandReplyExtra(ctx, {
    parse_mode: 'HTML',
    reply_markup: keyboard?.reply_markup,
  }));
}

async function sendAnimalCard(ctx, animal, options = {}) {
  const freshAnimal = await getAnimalById(animal.id);
  if (!freshAnimal) return ctx.reply('Кошка не найдена.');

  const needs = await getActiveAnimalNeeds(freshAnimal.id);
  const text = buildAnimalCardText(freshAnimal, needs);
  const mainPhotoId = await getMainAnimalPhotoId(freshAnimal.id);
  const keyboard = animalCardActionKeyboard(freshAnimal, options);

  if (!mainPhotoId) {
    return ctx.reply(text, commandReplyExtra(ctx, {
      parse_mode: 'HTML',
      reply_markup: keyboard?.reply_markup
    }));
  }

  try {
    // Красивая анкета: главное фото кошки + анкета в подписи.
    // Если текст слишком длинный для подписи Telegram, отправляем фото и анкету отдельным сообщением.
    if (text.length <= 1000) {
      return sendDirectusPhoto(ctx, mainPhotoId, text, commandReplyExtra(ctx, {
        parse_mode: 'HTML',
        reply_markup: keyboard?.reply_markup
      }));
    }
    await sendDirectusPhoto(ctx, mainPhotoId, `🐱 ${freshAnimal.name || 'Кошка'}`, commandReplyExtra(ctx, {
      reply_markup: keyboard?.reply_markup
    }));
    return ctx.reply(text, commandReplyExtra(ctx, { parse_mode: 'HTML' }));
  } catch (error) {
    console.error('SEND BEAUTIFUL CARD ERROR:', error.response?.data || error.message);
    return ctx.reply(text, commandReplyExtra(ctx, {
      parse_mode: 'HTML',
      reply_markup: keyboard?.reply_markup
    }));
  }
}

async function sendAnimalStory(ctx, animal) {
  const freshAnimal = await getAnimalById(animal.id);
  if (!freshAnimal) return ctx.reply('Кошка не найдена.', commandReplyExtra(ctx));
  if (!freshAnimal.story) return ctx.reply(`У ${freshAnimal.name || 'этой кошки'} пока нет истории.`, commandReplyExtra(ctx));
  return ctx.reply(`📖 ${freshAnimal.name || 'История'}\n\n${freshAnimal.story}`, commandReplyExtra(ctx));
}

async function getAnimalVideoIds(animalId) {
  const rows = await getAnimalMedia(animalId, 'video', 10);
  return getAnimalMediaFileIds(rows);
}

async function sendDirectusVideo(ctx, fileId, caption = '') {
  const response = await axios.get(`${DIRECTUS_URL}/assets/${fileId}`, {
    headers: apiHeaders(),
    responseType: 'stream',
    timeout: 120000,
  });

  const extra = commandReplyExtra(ctx, caption ? { caption } : {});
  try {
    return await ctx.replyWithVideo({ source: response.data, filename: `${fileId}.mp4` }, extra);
  } catch (error) {
    console.error('REPLY WITH VIDEO ERROR:', error.response?.data || error.message);
    // Если Telegram не смог принять именно video, пробуем отправить как файл.
    const fallback = await axios.get(`${DIRECTUS_URL}/assets/${fileId}`, {
      headers: apiHeaders(),
      responseType: 'stream',
      timeout: 120000,
    });
    return ctx.replyWithDocument({ source: fallback.data, filename: `${fileId}.mp4` }, extra);
  }
}

const animalMedia = createAnimalMediaModule({
  directusPatch,
  directusDelete,
  deleteDirectusFile,
  getAnimalById,
  createAnimalMedia,
  ensureAnimalAvatarFromPhoto,
  getAnimalMediaById,
  extractFileId,
  clearAnimalMainPhoto,
  clearAnimalMainVideo,
  getAnimalMediaFileUsage,
  getAnimalMedia,
  getAnimalMediaFileIds,
  commandReplyExtra,
  animalPhotoCaption,
  sendDirectusPhoto,
  cacheTelegramPhotoId,
  sendAnimalPhotoAlbum,
  isWrongTelegramFileIdentifierError,
  clearCachedTelegramPhotoId,
  withoutCachedTelegramPhotoIds,
  getAnimalVideoIds,
  sendDirectusVideo,
  getAllAnimalMedia,
});


async function getAnimalSuccessfulDonations(animalId, limit = 10) {
  try {
    const rows = await directusGet('animals_donations', {
      filter: {
        animal_id: { _eq: animalId },
        status: { _eq: 'success' },
      },
      fields: DONATION_READ_FIELDS,
      sort: '-created_at',
      limit,
    });
    return rows || [];
  } catch (error) {
    console.error('GET ANIMAL DONATIONS ERROR:', error.response?.data || error.message);
    return [];
  }
}

function donationDateParts(donation) {
  const raw = donation?.created_at || donation?.date_created || donation?.paid_at || donation?.updated_at;
  if (!raw) return { date: 'дата не указана', time: '' };

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    const value = String(raw);
    return { date: value.slice(0, 10), time: value.slice(11, 16) };
  }

  return {
    date: d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  };
}

function donationAmountText(donation) {
  const value = donation?.amount ?? donation?.amount_rub ?? donation?.sum ?? donation?.total ?? 0;
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n)) return String(value || '0');
  return formatRub(n);
}

function donationDonorText(donation) {
  return String(
    donation?.donor_name ||
    donation?.donor_username ||
    donation?.donor_telegram_username ||
    donation?.donor ||
    donation?.name ||
    'Аноним'
  ).trim();
}

function donationCommentText(donation) {
  const raw = String(donation?.comment || donation?.need_title || donation?.payment_type || '').trim();
  if (!raw) return '';
  if (raw === 'donate') return 'Донат';
  if (raw === 'feed') return 'Покормить';
  return raw;
}

function donationRankEmoji(index) {
  if (index === 0) return '🥇';
  if (index === 1) return '🥈';
  if (index === 2) return '🥉';
  return '▪️';
}

function donationStatsLines(animal, donations) {
  const lines = [];

  if (animal.donation_total !== undefined && animal.donation_total !== null) {
    lines.push(`Собрано: ${formatRub(animal.donation_total)} ₽`);
  }
  if (animal.donation_count !== undefined && animal.donation_count !== null) {
    lines.push(`Платежей: ${animal.donation_count}`);
  }
  if (animal.feed_count !== undefined && animal.feed_count !== null) {
    lines.push(`Кормлений: ${animal.feed_count}`);
  }

  if (!lines.length && donations?.length) {
    const shownTotal = donations.reduce((sum, donation) => {
      const amount = Number(String(donation?.amount ?? donation?.amount_rub ?? donation?.sum ?? donation?.total ?? 0).replace(',', '.'));
      return Number.isFinite(amount) ? sum + amount : sum;
    }, 0);
    lines.push(`Показано платежей: ${donations.length}`);
    lines.push(`Сумма показанных: ${formatRub(shownTotal)} ₽`);
  }

  return lines;
}

async function sendAnimalDonations(ctx, animal) {
  const freshAnimal = await getAnimalById(animal.id);
  if (!freshAnimal) return ctx.reply('Кошка не найдена.', commandReplyExtra(ctx));

  const donations = await getAnimalSuccessfulDonations(freshAnimal.id, 10);
  const name = freshAnimal.name || 'кошки';
  const lines = [`💳 Донаты для ${name}`, ''];

  const stats = donationStatsLines(freshAnimal, donations);
  if (stats.length) {
    lines.push(...stats);
    lines.push('');
    lines.push('━━━━━━━━━━━━');
    lines.push('');
  }

  if (!donations.length) {
    lines.push('💛 Никто ещё не задонатил этой кошке.');
    lines.push('');
    lines.push('Хотите помочь ей найти дом?');
    return ctx.reply(lines.join('\n').trim().slice(0, 3900), commandReplyExtra(ctx, Markup.inlineKeyboard([
      [Markup.button.callback('🍪 Оставить донат', `hx:feed:${freshAnimal.id}`)],
      [Markup.button.callback('⬅️ Назад', `gm:${freshAnimal.id}`)],
    ])));
  } else {
    lines.push('Последние успешные платежи:');
    lines.push('');

    donations.forEach((donation, index) => {
      const { date, time } = donationDateParts(donation);
      const amount = donationAmountText(donation);
      const donor = donationDonorText(donation);
      const comment = donationCommentText(donation);
      const dateLine = [date, time].filter(Boolean).join(' • ');

      lines.push(`${donationRankEmoji(index)} ${dateLine}`);
      lines.push(`💰 ${amount} ₽`);
      lines.push(`👤 ${donor}`);
      if (comment) lines.push(`📝 ${comment}`);
      lines.push('');
    });

    lines.push(`Показано последних: ${donations.length}`);
  }

  return ctx.reply(lines.join('\n').trim().slice(0, 3900), commandReplyExtra(ctx));
}

async function findAnimalFromText(text, options = {}) {
  const cleaned = String(text || '').trim();
  if (!cleaned) return { animals: [], source: 'empty' };

  const bySearch = await searchAnimalsByName(cleaned, 10, options);
  if (bySearch.length) return { animals: bySearch, source: 'search' };

  const haystack = normalizeForSearch(cleaned);
  const animals = await listAnimals(100, options);
  const byMention = animals.filter((animal) => {
    const name = normalizeForSearch(animal.name);
    return name && haystack.includes(name);
  });

  return { animals: byMention, source: 'mention' };
}

async function runCatalogCommand(ctx, options = {}) {
  const message = currentMessage(ctx);
  const currentText = getMessageText(message);
  const replyText = getMessageText(message?.reply_to_message);
  const parsed = parseGroupCommand(ctx, currentText);

  if (!parsed.addressed || !parsed.command) return false;

  const accessUser = await ensureSearchAnimalsAccess(ctx);
  if (!accessUser) return true;

  let sourceText = parsed.query;
  if (!sourceText && replyText) sourceText = replyText;

  if (!sourceText) {
    const example = parsed.command === 'review' ? 'отзыв Мандарин' : (parsed.command === 'donations' ? 'донаты Мандарин' : 'фото Мандарин');
    await ctx.reply(`Напишите команду и имя кошки. Например: ${example}`, commandReplyExtra(ctx));
    return true;
  }

  console.log('CATALOG COMMAND:', {
    chat_type: ctx.chat?.type,
    command: parsed.command,
    query: sourceText,
    message_thread_id: message?.message_thread_id || null,
  });

  const publicOnly = isGuestUser(accessUser);

  if (parsed.command === 'donations' && publicOnly) {
    await ctx.reply('История донатов доступна только сотрудникам фонда.', commandReplyExtra(ctx));
    return true;
  }

  const result = await findAnimalFromText(sourceText, { publicOnly });
  const animals = result.animals;

  if (!animals.length) {
    await ctx.reply('Не нашёл кошку. Напишите имя явно, например: донаты Мандарин', commandReplyExtra(ctx));
    return true;
  }

  if (animals.length > 1) {
    await ctx.reply('Нашёл несколько кошек. Уточните имя:', commandReplyExtra(ctx, catsListKeyboard(animals.slice(0, 10))));
    return true;
  }

  if (parsed.command === 'photo') await animalMedia.sendAnimalPhotos(ctx, animals[0]);
  else if (parsed.command === 'card') await sendAnimalCard(ctx, animals[0], { showDonations: !isGuestUser(accessUser) });
  else if (parsed.command === 'review') await animalReviews.startLeaveReview(ctx, animals[0].id);
  else if (parsed.command === 'donations') await sendAnimalDonations(ctx, animals[0]);
  else if (parsed.command === 'story') await sendAnimalStory(ctx, animals[0]);
  else if (parsed.command === 'video') await animalMedia.sendAnimalVideos(ctx, animals[0]);
  else await ctx.reply(groupHelpText(ctx), commandReplyExtra(ctx));

  return true;
}

async function handleGroupCatCommand(ctx) {
  if (!shouldHandleGroupMessage(ctx)) return false;
  return runCatalogCommand(ctx);
}

function shouldHandlePrivateCatMessage(ctx) {
  if (!isPrivateChat(ctx)) return false;
  const text = getMessageText(currentMessage(ctx));
  if (!text) return false;
  return /^(фото|анкета|инфо|отзыв|отзывы|донаты|донат|история|видео|photo|photos|anketa|card|info|review|reviews|donations|donates|story|history|video)(?=\s|$)/i.test(text);
}

async function handlePrivateCatCommand(ctx) {
  if (!shouldHandlePrivateCatMessage(ctx)) return false;
  return runCatalogCommand(ctx);
}

async function handleChannelCatalogCommand(ctx) {
  if (!isChannelChat(ctx)) return false;
  const text = getMessageText(currentMessage(ctx));
  if (!text) return false;
  return runCatalogCommand(ctx);
}


function formatHelpUrl(template, animal) {
  const raw = String(template || '').trim();
  if (!raw) return null;
  const replacements = {
    id: animal?.id || '',
    name: encodeURIComponent(animal?.name || ''),
    slug: encodeURIComponent(animal?.slug || slugify(animal?.name || '')),
  };

  let url = raw
    .replace(/\{id\}/g, replacements.id)
    .replace(/\{name\}/g, replacements.name)
    .replace(/\{slug\}/g, replacements.slug);

  if (!/[?&](cat|animal|id)=/i.test(url)) {
    const sep = url.includes('?') ? '&' : '?';
    url += `${sep}cat=${replacements.slug || replacements.id}`;
  }
  return url;
}

function actionButtonOrUrl(label, callbackData, url) {
  if (url) return Markup.button.url(label, url);
  return Markup.button.callback(label, callbackData);
}

function foundCatKeyboard(animal, options = {}) {
  const id = animal.id;
  const rows = [
    [
      Markup.button.callback('📸 Фото', `gp:${id}`),
      Markup.button.callback('🎥 Видео', `gv:${id}`),
    ],
    [
      Markup.button.callback('📖 История', `gs:${id}`),
      Markup.button.callback('💬 Отзывы', `gvr:${id}`),
    ],
    [
      Markup.button.callback('🐱 Анкета', `gt:${id}`),
      webAppOrCallbackButton('✨ Красивая анкета', buildWebAppUrl(id), `ga:${id}`),
    ],
  ];
  if (locationAllowsHelp(animal.location)) {
    const helpRow = [Markup.button.callback('❤ Помочь', `gh:${id}`)];
    if (options.showDonations === true && locationAllowsDonations(animal.location)) {
      helpRow.push(Markup.button.callback('💳 Донаты', `gd:${id}`));
    }
    rows.push(helpRow);
  }
  if (SHARE_INVITES_ENABLED) rows.push([Markup.button.callback('🎁 Поделиться — скидка 50%', `share_cat:${id}`)]);
  return Markup.inlineKeyboard(rows);
}

function helpCatKeyboard(animal, needs = []) {
  const id = animal.id;
  const rows = [];

  // Нужды открываем отдельным диалогом, даже если у нужды уже есть ссылка.
  // Так человек сначала получает понятную инструкцию: заказать по ссылке,
  // доставить в ближайший ПВЗ и потом прислать QR получения в поддержку.
  for (const need of (needs || []).slice(0, 8)) {
    const title = shortButtonText(need.title || 'Нужда');
    rows.push([Markup.button.callback(`🙏 ${title}`, `hn:${need.id}`)]);
  }

  rows.push([
    Markup.button.callback('🍪 Дать вкусняшку', `hx:feed:${id}`),
  ]);

  const adoptUrl = formatHelpUrl(CAT_ADOPT_URL, animal);
  if (adoptUrl) rows.push([Markup.button.url('🏠 Взять домой', adoptUrl)]);
  rows.push([Markup.button.callback('⬅️ Назад', `gm:${id}`)]);

  return Markup.inlineKeyboard(rows);
}

function needDonateAmountsKeyboard(need) {
  const id = need.id;
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('300 ₽', `hnd:${id}:300`),
      Markup.button.callback('500 ₽', `hnd:${id}:500`),
      Markup.button.callback('1000 ₽', `hnd:${id}:1000`),
    ],
    [Markup.button.callback('Другая сумма', `hnd_custom:${id}`)],
    [Markup.button.callback('⬅️ Назад', `gh:${extractFileId(need.animal_id) || need.animal_id}`)],
  ]);
}

function needOrderKeyboard(need) {
  const rows = [];
  const url = safeExternalUrl(need?.url);
  if (url) rows.push([Markup.button.url('🔗 Открыть ссылку на нужду', url)]);
  rows.push([Markup.button.callback('💳 Помочь деньгами', `hn_pay:${need.id}`)]);
  rows.push([Markup.button.callback('⬅️ Назад', `gh:${extractFileId(need.animal_id) || need.animal_id}`)]);
  return Markup.inlineKeyboard(rows);
}

function donateAmountsKeyboard(animal, paymentType = 'feed') {
  const id = animal.id;
  const kind = paymentType === 'donate' ? 'donate' : 'feed';
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('50 ₽', `hd:${kind}:${id}:50`),
      Markup.button.callback('100 ₽', `hd:${kind}:${id}:100`),
      Markup.button.callback('300 ₽', `hd:${kind}:${id}:300`),
    ],
    [
      Markup.button.callback('Другая сумма', `hd_custom:${kind}:${id}`),
    ],
    [Markup.button.callback('⬅️ Назад', `gh:${id}`)],
  ]);
}

function containsAnimalName(postText, animalName) {
  const haystack = ` ${normalizeForSearch(postText)} `;
  const needle = ` ${normalizeForSearch(animalName)} `;
  if (!needle.trim()) return false;
  return haystack.includes(needle);
}

async function findAnimalsMentionedInPost(text) {
  const normalized = normalizeForSearch(text);
  if (!normalized || normalized.length < 3) return [];
  const animals = await listAnimals(100, { publicOnly: true });
  return (animals || [])
    .filter((animal) => animal?.name && containsAnimalName(normalized, animal.name))
    .sort((a, b) => String(b.name || '').length - String(a.name || '').length);
}

async function countDirectusItems(collection, filter) {
  const rows = await directusGet(collection, {
    filter,
    aggregate: { count: '*' },
  });
  const count = Number(rows?.[0]?.count || 0);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

async function getQualityAnimalsWithMediaCounts() {
  const [animals, mediaRows] = await Promise.all([
    directusGet('animals', {
      fields: 'id,name,status,location,published',
      sort: 'name',
      limit: 500,
    }),
    directusGet('animal_media', {
      filter: { type: { _in: ['photo', 'video'] } },
      fields: 'id,animal_id,type',
      limit: 5000,
    }),
  ]);
  const counts = new Map();
  for (const row of mediaRows || []) {
    const animalId = String(extractFileId(row.animal_id) || row.animal_id || '');
    if (!animalId) continue;
    const item = counts.get(animalId) || { photo: 0, video: 0 };
    if (row.type === 'photo') item.photo += 1;
    if (row.type === 'video') item.video += 1;
    counts.set(animalId, item);
  }
  return (animals || []).map((animal) => ({
    ...animal,
    media_counts: counts.get(String(animal.id)) || { photo: 0, video: 0 },
  }));
}

function qualityAnimalListKeyboard(items, sourceAnimalId) {
  const rows = [];
  for (const item of (items || []).slice(0, 25)) {
    rows.push([Markup.button.callback(`Открыть: ${item.name || 'Кошка'}`, `open_cat:${item.id}`)]);
  }
  rows.push([Markup.button.callback('◀️ Назад к качеству', `edit_quality:${sourceAnimalId}`)]);
  return Markup.inlineKeyboard(rows);
}

async function getQualityVideoIssues() {
  const animals = await getQualityAnimalsWithMediaCounts();
  return animals
    .filter((animal) => Number(animal.media_counts?.video || 0) <= 1)
    .sort((a, b) => Number(a.media_counts.video) - Number(b.media_counts.video) || String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
}

async function getQualityPhotoIssues() {
  const animals = await getQualityAnimalsWithMediaCounts();
  return animals
    .filter((animal) => Number(animal.media_counts?.photo || 0) < 4)
    .sort((a, b) => Number(a.media_counts.photo) - Number(b.media_counts.photo) || String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
}

async function getFreshPendingReviews(limit = 20) {
  const reviews = await directusGet('animal_reviews', {
    filter: { is_public: { _eq: false } },
    fields: 'id,animal_id,reviewer_name,review_text,created_at',
    sort: '-created_at',
    limit,
  });
  const animalIds = [...new Set((reviews || []).map((review) => extractFileId(review.animal_id) || review.animal_id).filter(Boolean))];
  const animals = animalIds.length
    ? await directusGet('animals', {
      filter: { id: { _in: animalIds } },
      fields: 'id,name,status,location,published',
      limit: animalIds.length,
    })
    : [];
  const animalById = new Map((animals || []).map((animal) => [String(animal.id), animal]));
  return (reviews || []).map((review) => {
    const animalId = extractFileId(review.animal_id) || review.animal_id;
    return { ...review, animal_id_value: animalId, animal: animalById.get(String(animalId)) || null };
  });
}

function qualityReviewKeyboard(reviews, sourceAnimalId) {
  const rows = [];
  for (const review of reviews || []) {
    rows.push([
      Markup.button.callback('✅ Опубликовать', `pub_review:${review.id}`),
      Markup.button.callback('Открыть кошку', `open_cat:${review.animal_id_value}`),
    ]);
  }
  rows.push([Markup.button.callback('◀️ Назад к качеству', `edit_quality:${sourceAnimalId}`)]);
  return Markup.inlineKeyboard(rows);
}

function qualityReviewExcerpt(text, limit = 140) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function firstWords(text, limit = 100) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const excerpt = words.slice(0, limit).join(' ');
  return words.length > limit ? `${excerpt}…` : excerpt;
}

function russianReviewCount(count) {
  const value = Math.abs(Number(count) || 0);
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${value} отзывов`;
  if (mod10 === 1) return `${value} отзыв`;
  if (mod10 >= 2 && mod10 <= 4) return `${value} отзыва`;
  return `${value} отзывов`;
}

function cleanupAutoCommentProfileCache(now = Date.now()) {
  for (const [key, entry] of autoCommentProfileCache.entries()) {
    if (!entry?.expiresAt || entry.expiresAt <= now) autoCommentProfileCache.delete(key);
  }
  while (autoCommentProfileCache.size >= AUTO_COMMENT_PROFILE_CACHE_MAX) {
    const oldestKey = autoCommentProfileCache.keys().next().value;
    if (!oldestKey) break;
    autoCommentProfileCache.delete(oldestKey);
  }
}

async function getAutoCommentProfile(animal) {
  const cacheKey = String(animal.id);
  const cached = autoCommentProfileCache.get(cacheKey);
  if (cached?.expiresAt > Date.now()) return cached.profile;

  const freshAnimal = await getAnimalById(animal.id);
  const cat = freshAnimal || animal;
  const cafe = KOTOCAFE_MAP[cat.location];
  const cafeText = cafe?.url
    ? `<a href="${cafe.url}">${escapeTelegramHtml(cafe.label)}</a>`
    : escapeTelegramHtml(formatLocation(cat.location));
  const story = firstWords(cat.story, 100);
  const storyIsTruncated = String(cat.story || '').trim().split(/\s+/).filter(Boolean).length > 100;
  const profile = {
    intro: `🐱 <b>${escapeTelegramHtml(cat.name || 'Кошка')}</b> живёт в котокафе ${cafeText} и ждёт семью.`,
    story: story ? escapeTelegramHtml(story) : null,
    storyHint: storyIsTruncated ? 'Нажмите кнопку «📖 История», чтобы прочитать полную историю.' : null,
  };

  cleanupAutoCommentProfileCache();
  autoCommentProfileCache.set(cacheKey, {
    profile,
    expiresAt: Date.now() + AUTO_COMMENT_PROFILE_CACHE_TTL_MS,
  });
  return profile;
}

async function buildAutoCommentText(animal) {
  const [profile, donationCount, reviewCount] = await Promise.all([
    getAutoCommentProfile(animal),
    countDirectusItems('animals_donations', {
      animal_id: { _eq: animal.id },
      status: { _eq: 'success' },
    }),
    countDirectusItems('animal_reviews', {
      animal_id: { _eq: animal.id },
      is_public: { _eq: true },
    }),
  ]);

  return [
    profile.intro,
    profile.story ? `\n${profile.story}` : null,
    profile.storyHint,
    '',
    `💛 Мне задонатили ${donationCount} раз`,
    `💬 Обо мне оставили ${russianReviewCount(reviewCount)}`,
    '',
    '<b>Что показать?</b>',
  ].filter((line) => line !== null).join('\n');
}

function shouldTryAutoComment(ctx) {
  if (!isGroupChat(ctx)) return false;
  // Автопересланный пост канала приходит в связанную группу от служебного
  // Telegram-аккаунта/канала. Его обрабатываем, остальных ботов игнорируем.
  if (ctx.from?.is_bot && !isChannelDiscussionPost(ctx)) return false;
  const text = getMessageText(currentMessage(ctx));
  if (!text || text.length < AUTO_COMMENT_MIN_TEXT_LENGTH) return false;
  if (shouldHandleGroupMessage(ctx)) return false;
  return true;
}

function autoCommentSearchableText(text) {
  return normalizeForSearch(text).replace(/\s+/g, '');
}

function autoCommentDebug(event, details = {}) {
  if (String(process.env.AUTO_CAT_COMMENTS_DEBUG || 'true').toLowerCase() === 'false') return;
  console.log('AUTO COMMENT DEBUG:', {
    event,
    ...details,
  });
}

function autoCommentMessageInfo(ctx) {
  const message = currentMessage(ctx);
  const text = getMessageText(message);
  return {
    chat_id: ctx.chat?.id || null,
    chat_type: ctx.chat?.type || null,
    message_id: message?.message_id || null,
    thread_id: message?.message_thread_id || null,
    from_bot: ctx.from?.is_bot === true,
    automatic_forward: message?.is_automatic_forward === true,
    sender_chat_type: message?.sender_chat?.type || null,
    forward_from_chat_type: message?.forward_from_chat?.type || null,
    forward_origin_type: message?.forward_origin?.type || null,
    text_len: text.length,
    text_sample: text.slice(0, 120),
  };
}

async function handleAutoCatPost(ctx) {
  const message = currentMessage(ctx);
  const text = getMessageText(message);
  const searchableText = autoCommentSearchableText(text);

  if (!AUTO_CAT_COMMENTS) {
    autoCommentDebug('skip_disabled', autoCommentMessageInfo(ctx));
    return false;
  }
  if (!isGroupChat(ctx)) {
    autoCommentDebug('skip_not_group', autoCommentMessageInfo(ctx));
    return false;
  }
  if (ctx.from?.is_bot && !isChannelDiscussionPost(ctx)) {
    autoCommentDebug('skip_bot_message', autoCommentMessageInfo(ctx));
    return false;
  }
  if (!text || (text.length < AUTO_COMMENT_MIN_TEXT_LENGTH && searchableText.length < 3)) {
    autoCommentDebug('skip_no_text', {
      ...autoCommentMessageInfo(ctx),
      searchable_len: searchableText.length,
      searchable_sample: searchableText.slice(0, 120),
    });
    return false;
  }
  if (shouldHandleGroupMessage(ctx)) {
    autoCommentDebug('skip_group_command', autoCommentMessageInfo(ctx));
    return false;
  }

  const key = `${ctx.chat.id}:${message.message_id}`;
  if (autoCommentedMessages.has(key)) {
    autoCommentDebug('skip_duplicate', autoCommentMessageInfo(ctx));
    return false;
  }

  const animals = await findAnimalsMentionedInPost(text);
  if (animals.length !== 1) {
    autoCommentDebug('skip_animals_match', {
      ...autoCommentMessageInfo(ctx),
      animals_count: animals.length,
      animals: animals.slice(0, 5).map((animal) => animal.name || animal.id),
    });
    return false;
  }

  const animal = animals[0];
  autoCommentedMessages.add(key);

  if (!BOT_USERNAME) await ensureBotUsername(ctx);
  const keyboard = privateAnimalKeyboard(animal, sourcePostContextFromCtx(ctx));
  if (!keyboard) {
    autoCommentedMessages.delete(key);
    console.error('AUTO COMMENT ERROR: BOT_USERNAME is required for private deep links');
    return false;
  }

  const commentText = await buildAutoCommentText(animal);
  autoCommentDebug('send', {
    ...autoCommentMessageInfo(ctx),
    animal_id: animal.id,
    animal_name: animal.name,
  });
  try {
    const sentMessage = await ctx.reply(commentText, autoCommentReplyExtra(ctx, {
      parse_mode: 'HTML',
      ...keyboard,
    }));
    autoCommentDebug('sent', {
      ...autoCommentMessageInfo(ctx),
      animal_id: animal.id,
      animal_name: animal.name,
      sent_chat_id: sentMessage?.chat?.id || null,
      sent_message_id: sentMessage?.message_id || null,
      sent_thread_id: sentMessage?.message_thread_id || null,
    });
  } catch (error) {
    autoCommentedMessages.delete(key);
    throw error;
  }
  return true;
}

function shareCouponCode(token) {
  return `PAIR-${String(token || '').slice(0, 8).toUpperCase()}`;
}

function telegramDisplayName(user) {
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || user?.username || 'Гость';
}

async function createAnimalShareInvite(ctx, animal) {
  const token = crypto.randomBytes(18).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SHARE_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  return directusPost(ANIMAL_SHARE_INVITES_COLLECTION, {
    token,
    animal_id: animal.id,
    sharer_telegram_id: String(ctx.from.id),
    sharer_name: telegramDisplayName(ctx.from),
    recipient_telegram_id: null,
    recipient_name: null,
    status: 'pending',
    discount_percent: 50,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    opened_at: null,
  });
}

async function buildAnimalSharePrompt(ctx, animal) {
  const invite = await createAnimalShareInvite(ctx, animal);
  const inviteUrl = privateBotStartUrl(`share_${invite.token}`);
  if (!inviteUrl) throw new Error('Не удалось сформировать ссылку приглашения');
  const shareText = [
    `Посмотри карточку кошки ${animal.name || ''} 🐱`,
    'Приходи со мной в котокафе — при посещении вдвоём получим скидку 50% на общий чек.',
  ].join('\n');
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent(shareText)}`;
  return {
    text: [
      `🎁 Поделитесь карточкой ${animal.name || 'кошки'} с другом или подругой.`,
      '',
      'Когда друг откроет персональную ссылку, бот подтвердит, что карточкой поделились.',
      'После этого вы сможете прийти вдвоём и получить скидку 50% на общий чек.',
    ].join('\n'),
    keyboard: Markup.inlineKeyboard([[Markup.button.url('Поделиться карточкой', shareUrl)]]),
  };
}

async function showAnimalShareInvite(ctx, animal) {
  if (!SHARE_INVITES_ENABLED) return ctx.reply('Функция «Поделиться» временно отключена.');
  if (!isPrivateChat(ctx)) return ctx.reply('Поделиться карточкой можно в личном чате с ботом.');
  const prompt = await buildAnimalSharePrompt(ctx, animal);
  return ctx.reply(prompt.text, prompt.keyboard);
}

async function handleShareStartPayload(ctx, payload) {
  const match = String(payload || '').match(/^share_([A-Za-z0-9_-]{20,40})$/);
  if (!match || !isPrivateChat(ctx)) return false;
  if (!SHARE_INVITES_ENABLED) {
    await ctx.reply('Функция приглашений и скидок временно отключена.');
    return true;
  }
  const rows = await directusGet(ANIMAL_SHARE_INVITES_COLLECTION, {
    filter: { token: { _eq: match[1] } },
    fields: SHARE_INVITE_READ_FIELDS,
    limit: 1,
  });
  const invite = rows?.[0];
  if (!invite) {
    await ctx.reply('Приглашение не найдено или больше не действует.');
    return true;
  }
  if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) {
    await ctx.reply('Срок действия приглашения закончился.');
    return true;
  }
  if (String(invite.sharer_telegram_id) === String(ctx.from.id)) {
    await ctx.reply('Эту ссылку нужно отправить другу или подруге — открыть её должен второй человек.');
    return true;
  }

  const animalId = extractFileId(invite.animal_id) || invite.animal_id;
  const animal = animalId ? await getAnimalById(animalId) : null;
  if (!animal || !isAnimalPublicForWeb(animal)) {
    await ctx.reply('Карточка кошки сейчас недоступна.');
    return true;
  }

  if (invite.status !== 'opened') {
    await directusPatch(ANIMAL_SHARE_INVITES_COLLECTION, invite.id, {
      recipient_telegram_id: String(ctx.from.id),
      recipient_name: telegramDisplayName(ctx.from),
      status: 'opened',
      opened_at: new Date().toISOString(),
    });
  } else if (invite.recipient_telegram_id && String(invite.recipient_telegram_id) !== String(ctx.from.id)) {
    await ctx.reply('Это приглашение уже активировано другим человеком.');
    return true;
  }

  const coupon = shareCouponCode(invite.token);
  const confirmation = [
    '🎉 Карточкой успешно поделились!',
    '',
    `Скидка: 50% на общий чек при посещении вдвоём.`,
    `Код подтверждения: ${coupon}`,
    '',
    'Покажите это сообщение сотруднику котокафе, когда придёте вместе.',
  ].join('\n');
  await ctx.reply(confirmation, foundCatKeyboard(animal, { showDonations: false }));

  try {
    await bot.telegram.sendMessage(invite.sharer_telegram_id, [
      '🎉 Друг открыл вашу карточку кошки.',
      'Приглашение активировано: скидка 50% на общий чек при посещении вдвоём.',
      `Код подтверждения: ${coupon}`,
    ].join('\n'));
  } catch (error) {
    console.error('SHARE INVITE NOTIFY ERROR:', error.response?.data || error.message);
  }
  return true;
}

async function handleCatalogStartPayload(ctx, payload) {
  const raw = String(payload || '');
  const originMatch = raw.match(/^catx_(p|v|s|r|t|w|h|q)_([A-Za-z0-9_-]{22})_([np][0-9a-z]+)_([0-9a-z]+)_([0-9a-z]+)$/i);
  const legacyMatch = raw.match(/^cat_(?:(p|v|s|r|t|w|h|q)_)?([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
  if ((!originMatch && !legacyMatch) || !isPrivateChat(ctx)) return false;

  const action = String(originMatch?.[1] || legacyMatch?.[1] || 'menu').toLowerCase();
  const animalId = originMatch ? expandCompactUuid(originMatch[2]) : legacyMatch[2];
  if (!animalId) return false;

  const userContextKey = String(ctx.from?.id || '');
  if (originMatch) {
    const sourceChatId = expandCompactSignedInteger(originMatch[3]);
    const sourceMessageId = expandCompactPositiveInteger(originMatch[4]);
    const sourceThreadId = expandCompactPositiveInteger(originMatch[5]);
    if (!sourceChatId || !sourceMessageId || !sourceThreadId) return false;
    userDonationOriginContexts.set(userContextKey, {
      sourceChatId,
      sourceMessageId,
      sourceThreadId,
      createdAt: Date.now(),
    });
  } else {
    userDonationOriginContexts.delete(userContextKey);
  }

  const user = await getCurrentUser(ctx);
  const accessUser = user || guestUser();
  if (!(await canViewAnimals(accessUser))) {
    await ctx.reply('У вас нет прав на просмотр кошек.');
    return true;
  }

  const animal = await getAnimalForCatalogUser(animalId, accessUser);
  if (!animal) {
    await ctx.reply('Кошка не найдена.');
    return true;
  }

  if (action === 'p') await animalMedia.sendAnimalPhotos(ctx, animal);
  else if (action === 'v') await animalMedia.sendAnimalVideos(ctx, animal);
  else if (action === 's') await sendAnimalStory(ctx, animal);
  else if (action === 'r') await animalReviews.sendReviews(ctx, animal);
  else if (action === 't') await sendAnimalTextCard(ctx, animal, { showDonations: !isGuestUser(accessUser) });
  else if (action === 'w') {
    const webUrl = buildWebAppUrl(animal.id);
    if (webUrl) {
      await ctx.reply(
        `✨ Красивая анкета: ${animal.name}`,
        Markup.inlineKeyboard([[Markup.button.url('Открыть анкету', webUrl)]])
      );
    } else {
      await sendAnimalCard(ctx, animal, { showDonations: !isGuestUser(accessUser) });
    }
  } else if (action === 'h') {
    const needs = await getActiveAnimalNeeds(animal.id);
    const text = needs.length
      ? [`Чем помочь ${animal.name}?`, '', 'Активные нужды:', ...needs.slice(0, 8).map((need) => `• ${need.title || 'Нужда'}`)].join('\n')
      : `Как помочь ${animal.name}?`;
    await ctx.reply(text, helpCatKeyboard(animal, needs));
  } else if (action === 'q') {
    await showAnimalShareInvite(ctx, animal);
  } else {
    await ctx.reply(
      [`🐱 Нашёл карточку: ${animal.name}`, '', 'Что показать?'].join('\n'),
      foundCatKeyboard(animal, { showDonations: !isGuestUser(accessUser) })
    );
  }
  return true;
}

async function setCurrentAnimal(teamId, animalId, chatId, pinMessageId) {
  return directusPatch('animals_team', teamId, {
    current_animal_id: animalId,
    current_chat_id: chatId,
    current_pin_message_id: pinMessageId,
  });
}

async function clearCurrentAnimal(teamId) {
  return directusPatch('animals_team', teamId, {
    current_animal_id: null,
    current_chat_id: null,
    current_pin_message_id: null,
  });
}

async function clearCurrentAnimalAndUnpin(ctx, user) {
  if (user?.current_chat_id && user?.current_pin_message_id) {
    try {
      await ctx.telegram.unpinChatMessage(user.current_chat_id, user.current_pin_message_id);
    } catch (error) {
      console.error('UNPIN ERROR:', error.response?.data || error.message);
    }
  }
  if (user?.id) await clearCurrentAnimal(user.id);
}

const MENU_PERMISSION_IDS_BY_CODE = {
  [BUTTON_ADD_CAT]: BUTTON_CREATE_ANIMALS_PERMISSION_ID,
  find_cat: BUTTON_SEARCH_ANIMALS_PERMISSION_ID,
  list_cats: BUTTON_VIEW_ANIMALS_PERMISSION_ID,
};

const rolePermissionsCache = new Map();

function guestUser() {
  return {
    guest: true,
    full_name: 'Гость',
    role_id: { id: GUEST_ROLE_ID, code: 'user', title: 'Пользователь' },
  };
}

function userRoleId(user) {
  return Number(user?.role_id?.id || user?.role_id || (isGuestUser(user) ? GUEST_ROLE_ID : 0));
}

function normalizeRolePermission(row) {
  const permission = row?.permission_id || row?.permission || row;
  if (!permission) return null;
  if (typeof permission === 'number' || typeof permission === 'string') {
    return { id: Number(permission) || permission, code: null, title: null };
  }
  return {
    id: permission.id ?? null,
    code: permission.code || null,
    title: permission.title || null,
  };
}

async function getRolePermissions(user) {
  const roleId = userRoleId(user);
  if (!roleId) return [];

  const cached = rolePermissionsCache.get(roleId);
  if (cached?.expiresAt > Date.now()) return cached.permissions;

  try {
    const rows = await directusGet('animals_role_permissions', {
      filter: { role_id: { _eq: roleId } },
      fields: 'id,permission_id.id,permission_id.code,permission_id.title',
      limit: 200,
    });
    const permissions = (rows || []).map(normalizeRolePermission).filter(Boolean);
    rolePermissionsCache.set(roleId, {
      permissions,
      expiresAt: Date.now() + ROLE_PERMISSIONS_CACHE_TTL_MS,
    });
    return permissions;
  } catch (error) {
    console.error('ROLE PERMISSIONS READ ERROR:', error.response?.data || error.message);
    return [];
  }
}

async function getMenuButtonsForUser(user) {
  const accessUser = user || guestUser();
  const rows = [];
  if (await hasRolePermission(accessUser, { id: BUTTON_CREATE_ANIMALS_PERMISSION_ID })) {
    rows.push({ id: BUTTON_CREATE_ANIMALS_PERMISSION_ID, code: BUTTON_ADD_CAT, title: MENU_ADD_CAT, sort: 10 });
  }
  if (await hasRolePermission(accessUser, { id: BUTTON_SEARCH_ANIMALS_PERMISSION_ID })) {
    rows.push({ id: BUTTON_SEARCH_ANIMALS_PERMISSION_ID, code: 'find_cat', title: MENU_FIND_CAT, sort: 20 });
  }
  if (await hasRolePermission(accessUser, { id: BUTTON_VIEW_ANIMALS_PERMISSION_ID })) {
    rows.push({ id: BUTTON_VIEW_ANIMALS_PERMISSION_ID, code: 'list_cats', title: MENU_LIST_CATS, sort: 30 });
  }
  return rows.sort((a, b) => Number(a.sort || 100) - Number(b.sort || 100));
}

async function getButtonByTitleForUser(user, title) {
  const buttons = await getMenuButtonsForUser(user);
  return buttons.find((button) => button.title === title) || null;
}

function permissionMatches(grantedPermission, requiredPermission = {}) {
  if (!grantedPermission) return false;
  if (requiredPermission.id && Number(grantedPermission.id) === Number(requiredPermission.id)) return true;
  if (requiredPermission.code && String(grantedPermission.code || '').trim() === String(requiredPermission.code).trim()) return true;
  return false;
}

async function hasRolePermission(user, permission = {}) {
  const permissions = await getRolePermissions(user || guestUser());
  return permissions.some((grantedPermission) => permissionMatches(grantedPermission, permission));
}

async function ensureButtonAccess(ctx, code) {
  const user = await getCurrentUser(ctx);
  if (!user) {
    await ctx.reply('Нет доступа. Напишите /start для авторизации.');
    return null;
  }

  const permissionId = MENU_PERMISSION_IDS_BY_CODE[String(code || '').trim()];
  const allowed = permissionId
    ? await hasRolePermission(user, { id: permissionId })
    : await hasRolePermission(user, { code });

  if (!allowed) {
    await ctx.reply('У вас нет прав на это действие.');
    return null;
  }

  return user;
}

async function canViewAnimals(user) {
  if (await hasRolePermission(user, { id: BUTTON_VIEW_ANIMALS_PERMISSION_ID })) return true;
  return canEditAnimalCards(user);
}

async function ensureViewAnimalsAccess(ctx) {
  const user = await getCurrentUser(ctx) || guestUser();

  if (!(await canViewAnimals(user))) {
    if (ctx.callbackQuery) await safeAnswerCbQuery(ctx, 'Недостаточно прав', { show_alert: true });
    await ctx.reply('У вас нет прав на просмотр кошек.');
    return null;
  }
  return user;
}

async function canSearchAnimals(user) {
  if (await hasRolePermission(user, { id: BUTTON_SEARCH_ANIMALS_PERMISSION_ID })) return true;
  return canViewAnimals(user);
}

async function ensureSearchAnimalsAccess(ctx) {
  const user = await getCurrentUser(ctx) || guestUser();

  if (!(await canSearchAnimals(user))) {
    if (ctx.callbackQuery) await safeAnswerCbQuery(ctx, 'Недостаточно прав', { show_alert: true });
    await ctx.reply('У вас нет прав на просмотр и поиск кошек.');
    return null;
  }
  return user;
}

async function getVisibleAnimalOrReply(ctx, animalId, user, text = 'Кошка не найдена.') {
  const animal = await getAnimalForCatalogUser(animalId, user);
  if (!animal) {
    if (ctx.callbackQuery) await safeAnswerCbQuery(ctx, text);
    await ctx.reply(text, commandReplyExtra(ctx));
    return null;
  }
  return animal;
}

async function canEditAnimalCards(user) {
  if (!user) return false;
  if (await hasRolePermission(user, { id: BUTTON_EDIT_ANIMALS_PERMISSION_ID })) return true;
  if (await hasRolePermission(user, { id: BUTTON_EDIT_OWN_ANIMALS_PERMISSION_ID })) return true;
  return isAdminRole(user);
}

async function canEditSpecificAnimal(user, animal) {
  if (!user || !animal) return false;
  if (await hasRolePermission(user, { id: BUTTON_EDIT_ANIMALS_PERMISSION_ID })) return true;
  if (isAdminRole(user)) return true;
  if (await hasRolePermission(user, { id: BUTTON_EDIT_OWN_ANIMALS_PERMISSION_ID })) {
    return userCanOwnAnimal(user, animal);
  }
  return false;
}

async function ensureEditAnimalAccess(ctx) {
  const user = await getCurrentUser(ctx);
  if (!user) {
    if (ctx.callbackQuery) await safeAnswerCbQuery(ctx, 'Нет доступа', { show_alert: true });
    await ctx.reply('Нет доступа. Напишите /start для авторизации.');
    return null;
  }

  if (!(await canEditAnimalCards(user))) {
    if (ctx.callbackQuery) await safeAnswerCbQuery(ctx, 'Недостаточно прав', { show_alert: true });
    await ctx.reply('У вас нет прав на редактирование карточек кошек.');
    return null;
  }

  return user;
}

async function getEditableAnimalOrReply(ctx, animalId, user, options = {}) {
  const notFoundText = options.notFoundText || 'Кошка не найдена.';
  const deniedText = options.deniedText || 'У вас нет прав на редактирование этой кошки.';
  const animal = await getAnimalById(animalId);
  if (!animal) {
    if (ctx.callbackQuery) await safeAnswerCbQuery(ctx, notFoundText, { show_alert: true });
    await ctx.reply(notFoundText, commandReplyExtra(ctx));
    return null;
  }
  if (!(await canEditSpecificAnimal(user, animal))) {
    if (ctx.callbackQuery) await safeAnswerCbQuery(ctx, 'Недостаточно прав', { show_alert: true });
    await ctx.reply(deniedText, commandReplyExtra(ctx));
    return null;
  }
  return animal;
}

async function canToggleAnimalPublication(user) {
  return hasRolePermission(user, { id: BUTTON_PUBLISH_CAT_PERMISSION_ID });
}

async function canDeleteAnimalCards(user) {
  return hasRolePermission(user, { id: BUTTON_DELETE_ANIMALS_PERMISSION_ID });
}

function roleCodeOrTitle(user) {
  return `${user?.role_id?.code || ''} ${user?.role_id?.title || ''}`.trim().toLowerCase();
}

function isAdminRole(user) {
  const roleText = roleCodeOrTitle(user);
  if (!roleText) return false;
  if (/\badmin\b|админ|администратор/.test(roleText)) return true;
  return false;
}

function animalAuthorId(animal) {
  return String(
    animal?.author_id?.id
      || animal?.author?.id
      || animal?.author_user_id
      || animal?.author_id
      || animal?.author
      || ''
  ).trim();
}

function userCanOwnAnimal(user, animal) {
  const userId = String(user?.id || '').trim();
  const authorId = animalAuthorId(animal);
  return Boolean(userId && authorId && userId === authorId);
}

async function canChangeAnimalStatus(user) {
  if (!user) return false;
  if (await canEditAnimalCards(user)) return true;
  return isAdminRole(user);
}

async function ensureChangeAnimalStatusAccess(ctx) {
  const user = await getCurrentUser(ctx);
  if (!user) {
    await safeAnswerCbQuery(ctx, 'Нет доступа', { show_alert: true });
    await ctx.reply('Нет доступа. Напишите /start для авторизации.');
    return null;
  }

  if (!(await canChangeAnimalStatus(user))) {
    await safeAnswerCbQuery(ctx, 'Недостаточно прав', { show_alert: true });
    await ctx.reply('У вас нет прав на смену статуса кошки.');
    return null;
  }

  return user;
}

async function ensurePublishAnimalAccess(ctx) {
  const user = await getCurrentUser(ctx);
  if (!user) {
    await safeAnswerCbQuery(ctx, 'Нет доступа', { show_alert: true });
    await ctx.reply('Нет доступа. Напишите /start для авторизации.');
    return null;
  }

  if (!(await canToggleAnimalPublication(user))) {
    await safeAnswerCbQuery(ctx, 'Недостаточно прав', { show_alert: true });
    await ctx.reply('У вас нет прав на публикацию карточек кошек.');
    return null;
  }

  return user;
}

async function ensureDeleteAnimalAccess(ctx) {
  const user = await getCurrentUser(ctx);
  if (!user) {
    await safeAnswerCbQuery(ctx, 'Нет доступа', { show_alert: true });
    await ctx.reply('Нет доступа. Напишите /start для авторизации.');
    return null;
  }

  if (!(await canDeleteAnimalCards(user))) {
    await safeAnswerCbQuery(ctx, 'Недостаточно прав', { show_alert: true });
    await ctx.reply('У вас нет прав на удаление кошек.');
    return null;
  }

  return user;
}

function animalPublicationLabel(animal) {
  return animal?.published === true ? '🌐 Опубликована' : '🔒 Не опубликована';
}

function authMenu() {
  return Markup.keyboard([
    [Markup.button.contactRequest('📱 Поделиться телефоном')],
    [MENU_FIND_CAT, MENU_LIST_CATS],
  ]).resize();
}

async function mainMenu(user) {
  const accessUser = user || guestUser();
  const rows = [];
  if (await hasRolePermission(accessUser, { id: BUTTON_CREATE_ANIMALS_PERMISSION_ID })) rows.push([MENU_ADD_CAT]);
  const row = [];
  if (await hasRolePermission(accessUser, { id: BUTTON_SEARCH_ANIMALS_PERMISSION_ID })) row.push(MENU_FIND_CAT);
  if (await hasRolePermission(accessUser, { id: BUTTON_VIEW_ANIMALS_PERMISSION_ID })) row.push(MENU_LIST_CATS);
  if (row.length) rows.push(row);
  if (user && await canEditAnimalCards(accessUser)) rows.push([MENU_CAFE_MEDIA]);
  if (!user) rows.push([MENU_AUTH_CONTACT]);
  return Markup.keyboard(rows).resize();
}

async function welcomeInlineMenu(user = null) {
  const accessUser = user || guestUser();
  const rows = [];
  if (user && await hasRolePermission(accessUser, { id: BUTTON_CREATE_ANIMALS_PERMISSION_ID })) {
    rows.push([Markup.button.callback('➕ Добавить кошку', 'welcome_add_cat')]);
  }
  if (await hasRolePermission(accessUser, { id: BUTTON_SEARCH_ANIMALS_PERMISSION_ID })) {
    rows.push([Markup.button.callback('🔎 Найти кошку', 'welcome_find_cat')]);
  }
  if (await hasRolePermission(accessUser, { id: BUTTON_VIEW_ANIMALS_PERMISSION_ID })) {
    const catalogUrl = buildCatalogWebAppUrl();
    if (catalogUrl) rows.push([Markup.button.url('🐾 Открыть каталог', catalogUrl)]);
    rows.push([Markup.button.callback('📋 Список кошек', 'welcome_list_cats')]);
  }
  if (user && await canEditAnimalCards(accessUser)) rows.push([Markup.button.callback('🏠 Жизнь котокафе', 'cafe_media_home')]);
  if (!user) rows.push([Markup.button.callback('📱 Поделиться номером', 'welcome_auth_contact')]);
  return Markup.inlineKeyboard(rows.length ? rows : [[Markup.button.callback('🔎 Найти кошку', 'welcome_find_cat')]]);
}

function editMenuKeyboard(animal) {
  const publishLabel = animal?.published === true ? '🟢 На сайте' : '🔴 Не на сайте';
  return Markup.inlineKeyboard([
    [Markup.button.callback(publishLabel, `toggle_publish_menu:${animal.id}`)],
    [
      Markup.button.callback('👀 Просмотр', `edit_view:${animal.id}`),
      Markup.button.callback('✏️ Тексты', `edit_texts:${animal.id}`),
    ],
    [
      Markup.button.callback('📸 Медиа', `edit_media:${animal.id}`),
      Markup.button.callback('⚙️ Данные', `edit_data:${animal.id}`),
    ],
    [
      Markup.button.callback('🧪 Качество', `edit_quality:${animal.id}`),
      Markup.button.callback('⚡ Действия', `edit_actions:${animal.id}`),
    ],
    [Markup.button.callback('❌ Завершить работу', 'finish_work')],
  ]);
}
function editViewKeyboard(animal) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🐱 Анкета', `gt:${animal.id}`),
      webAppOrCallbackButton('✨ Красивая анкета', buildWebAppUrl(animal.id), `ga:${animal.id}`),
    ],
    [
      Markup.button.callback('🖼 Посмотреть аватар', `manage_media:avatar:${animal.id}`),
      Markup.button.callback('🖼 Просмотр фото', `gp:${animal.id}`),
    ],
    [
      Markup.button.callback('🎬 Просмотр видео', `gv:${animal.id}`),
      Markup.button.callback('📖 Просмотр истории', `gs:${animal.id}`),
    ],
    [Markup.button.callback('◀️ Назад', `open_cat:${animal.id}`)],
  ]);
}

function editTextsKeyboard(animal) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📝 Короткое описание', `edit_short:${animal.id}`)],
    [Markup.button.callback('📖 История', `edit_story:${animal.id}`)],
    [Markup.button.callback('❤ Здоровье', `edit_health_comment:${animal.id}`)],
    [Markup.button.callback('😺 Характер', `edit_character_comment:${animal.id}`)],
    [Markup.button.callback('🏠 Пристройство', `edit_adopt_req:${animal.id}`)],
    [Markup.button.callback('◀️ Назад', `open_cat:${animal.id}`)],
  ]);
}

function editMediaKeyboard(animal) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📸 Добавить фото', `edit_gallery:${animal.id}`),
      Markup.button.callback('🎥 Добавить видео', `edit_video:${animal.id}`),
    ],
    [Markup.button.callback('🖼 Сменить аватар', `edit_avatar:${animal.id}`)],
    [
      Markup.button.callback('⭐ Управление фото', `manage_media:photo:${animal.id}`),
      Markup.button.callback('🎬 Управление видео', `manage_media:video:${animal.id}`),
    ],
    [
      Markup.button.callback('🗑 Удалить фото', `mm:photo:${animal.id}`),
    ],
    [
      Markup.button.callback('🗑 Удалить видео', `mm:video:${animal.id}`),
    ],
    [Markup.button.callback('◀️ Назад', `open_cat:${animal.id}`)],
  ]);
}

function editDataKeyboard(animal, options = {}) {
  const rows = [
    [Markup.button.callback('🎂 Возраст', `edit_age:${animal.id}`)],
    [Markup.button.callback('✅ Признаки', `edit_traits:${animal.id}`)],
    [Markup.button.callback('🙏 Нужды', `edit_needs:${animal.id}`)],
    [Markup.button.callback('💬 Отзывы', `edit_reviews:${animal.id}`)],
  ];
  const donationUrl = webDonationUrl(animal);
  if (donationUrl) rows.push([Markup.button.url('💳 Донаты', donationUrl)]);

  rows.push([Markup.button.callback('◀️ Назад', `open_cat:${animal.id}`)]);
  return Markup.inlineKeyboard(rows);
}

function editActionsKeyboard(animal, options = {}) {
  const rows = [];

  if (options.canChangeStatus) {
    rows.push([Markup.button.callback('🔄 Сменить статус', `change_status_menu:${animal.id}`)]);
  }

  if (options.canPublish) {
    rows.push([
      Markup.button.callback(
        animal?.published === true ? '🔒 Снять с публикации' : '🌐 Опубликовать',
        `toggle_publish:${animal.id}`
      ),
    ]);
  }

  if (options.canDelete) {
    rows.push([Markup.button.callback('🗑 Удалить кошку', `delete_cat:${animal.id}`)]);
  }

  if (!rows.length) rows.push([Markup.button.callback('Нет доступных действий', `open_cat:${animal.id}`)]);
  rows.push([Markup.button.callback('◀️ Назад', `open_cat:${animal.id}`)]);
  return Markup.inlineKeyboard(rows);
}

function changeAnimalStatusKeyboard(animal) {
  const rows = MANUAL_ANIMAL_STATUS_OPTIONS.map((item) => {
    const isCurrent = animal?.status === item.value;
    const callbackCode = MANUAL_ANIMAL_STATUS_CALLBACK_CODES[item.value] || item.value;
    return [Markup.button.callback(`${isCurrent ? '✅ ' : ''}${item.label}`, `set_animal_status:${animal.id}:${callbackCode}`)];
  });
  rows.push([Markup.button.callback('◀️ Назад', `edit_actions:${animal.id}`)]);
  return Markup.inlineKeyboard(rows);
}

function editQualityKeyboard(animal) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🎥 Нет или 1 видео', `quality_video:${animal.id}`)],
    [Markup.button.callback('📸 Мало фото (<4)', `quality_photos:${animal.id}`)],
    [Markup.button.callback('💬 Свежие отзывы', `quality_reviews:${animal.id}`)],
    [Markup.button.callback('◀️ Назад', `open_cat:${animal.id}`)],
  ]);
}

function deleteAnimalConfirmKeyboard(animal) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Да, удалить кошку', `confirm_delete_cat:${animal.id}`)],
    [Markup.button.callback('↩️ Нет, оставить', `cancel_delete_cat:${animal.id}`)],
  ]);
}

function galleryDoneKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('✅ Готово', 'gallery_done')]]);
}

async function uploadStreamToDirectus(stream, filename, contentType, folderId = CAT_PHOTOS_FOLDER_ID) {
  const form = new FormData();
  form.append('file', stream, { filename, contentType });
  if (folderId) form.append('folder', folderId);
  const uploaded = await axios.post(`${DIRECTUS_URL}/files`, form, {
    headers: apiHeaders(form.getHeaders()),
    timeout: DIRECTUS_UPLOAD_TIMEOUT_MS,
  });
  return uploaded.data.data.id;
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${command} exited with ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

function downloadStreamToFile(stream, filePath) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(filePath);
    stream.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    stream.pipe(out);
  });
}

async function transcodeVideoForWeb(inputPath, outputPath) {
  await runProcess('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-vf', 'scale=-2:720',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '28',
    '-maxrate', '1800k',
    '-bufsize', '3600k',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-ac', '2',
    outputPath,
  ], { timeout: DIRECTUS_UPLOAD_TIMEOUT_MS });
}

async function transcodeVideoForWebm(inputPath, outputPath) {
  await runProcess('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-vf', 'scale=-2:720',
    '-c:v', 'libvpx-vp9',
    '-b:v', '0',
    '-crf', '34',
    '-row-mt', '1',
    '-deadline', 'good',
    '-cpu-used', '2',
    '-c:a', 'libopus',
    '-b:a', '96k',
    outputPath,
  ], { timeout: DIRECTUS_UPLOAD_TIMEOUT_MS });
}

async function uploadTelegramPhoto(ctx, fileId) {
  const fileLink = await ctx.telegram.getFileLink(fileId);
  const response = await axios.get(fileLink.href, { responseType: 'stream' });
  return uploadStreamToDirectus(
    response.data,
    `cat-${Date.now()}.jpg`,
    response.headers['content-type'] || 'image/jpeg',
    CAT_PHOTOS_FOLDER_ID
  );
}

function isPrivateIp(address) {
  const value = String(address || '').trim().toLowerCase();
  if (!value) return true;
  const ipv4 = value.startsWith('::ffff:') ? value.slice(7) : value;
  if (net.isIPv4(ipv4)) {
    const parts = ipv4.split('.').map((x) => Number(x));
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168);
  }
  if (net.isIPv6(value)) {
    return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab][0-9a-f]:/i.test(value);
  }
  return true;
}

async function lookupPublicHostname(hostname) {
  const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error('Не удалось проверить адрес изображения.');
  if (records.some((record) => isPrivateIp(record.address))) {
    throw new Error('Нельзя загружать изображения с локальных или внутренних адресов.');
  }
  return records;
}

function makeSafeLookup(allowedAddresses) {
  const allowed = new Set((allowedAddresses || []).map((record) => record.address));
  return async (hostname, options, callback) => {
    try {
      const records = await dns.promises.lookup(hostname, { all: true, verbatim: true, family: options?.family || 0 });
      const safe = records.filter((record) => allowed.has(record.address) && !isPrivateIp(record.address));
      if (!safe.length) throw new Error('DNS address changed to an unsafe address.');
      const record = safe[0];
      callback(null, record.address, record.family);
    } catch (error) {
      callback(error);
    }
  };
}

function limitReadableStream(stream, maxBytes, label = 'Файл') {
  let total = 0;
  return stream.pipe(new Transform({
    transform(chunk, encoding, callback) {
      total += chunk.length;
      if (total > maxBytes) callback(new Error(`${label} слишком большой.`));
      else callback(null, chunk);
    },
  }));
}

async function uploadPhotoFromUrl(url) {
  if (!isProbablyImageUrl(url)) throw new Error('Ссылка должна вести на изображение jpg, png, webp или gif.');
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Разрешены только http/https ссылки на изображения.');
  const allowedRecords = await lookupPublicHostname(parsed.hostname);
  const lookup = makeSafeLookup(allowedRecords);
  const agentOptions = { lookup };
  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 30000,
    maxRedirects: 0,
    httpAgent: new http.Agent(agentOptions),
    httpsAgent: new https.Agent(agentOptions),
    headers: { 'User-Agent': 'cat-bot/1.0' },
    validateStatus: (status) => status >= 200 && status < 300,
  });
  const contentLength = Number(response.headers['content-length'] || 0);
  if (contentLength && Number.isFinite(contentLength) && contentLength > MAX_EXTERNAL_IMAGE_BYTES) {
    response.data.destroy();
    throw new Error(`Изображение слишком большое. Максимум: ${Math.round(MAX_EXTERNAL_IMAGE_BYTES / 1024 / 1024)} МБ.`);
  }
  const contentType = response.headers['content-type'] || contentTypeFromUrl(url);
  if (!String(contentType).startsWith('image/')) throw new Error('По ссылке не изображение.');
  const limitedStream = limitReadableStream(response.data, MAX_EXTERNAL_IMAGE_BYTES, 'Изображение');
  return uploadStreamToDirectus(limitedStream, filenameFromUrl(url), contentType, CAT_PHOTOS_FOLDER_ID);
}

async function findAnimalByExactName(name) {
  const value = String(name || '').trim();
  if (!value) return null;
  const rows = await directusGet('animals', {
    filter: { name: { _eq: value } },
    fields: 'id,name,status,location',
    limit: 1,
  });
  return rows?.[0] || null;
}

async function createAnimal(data) {
  return directusPost('animals', data);
}

function nullableIntegerId(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const num = Number(raw);
  return Number.isSafeInteger(num) ? num : null;
}

async function createAnimal(data) {
  return directusPost('animals', data);
}

async function logAnimalStatusChange({ animalId, oldStatus, newStatus, user, source = 'telegram_bot' }) {
  if (!ANIMAL_STATUS_LOGS_COLLECTION) return null;
  const actorName = user?.full_name || user?.username || user?.phone || String(user?.telegram_id || user?.id || '').trim() || 'Unknown';
  return directusPost(ANIMAL_STATUS_LOGS_COLLECTION, {
    animal_id: animalId,
    old_status: oldStatus || null,
    new_status: newStatus || null,
    actor_user_id: nullableIntegerId(user?.id),
    actor_role_id: nullableIntegerId(user?.role_id?.id || user?.role_id),
    actor_name: actorName,
    actor_telegram_id: user?.telegram_id || null,
    source,
  });
}

async function logAnimalPublicationChange({ animalId, oldPublished, newPublished, user, source = 'telegram_publish_action' }) {
  return logAnimalStatusChange({
    animalId,
    oldStatus: oldPublished === true ? 'published' : 'unpublished',
    newStatus: newPublished === true ? 'published' : 'unpublished',
    user,
    source,
  });
}


function colorLabel(color, note) {
  if (note) return note;

  const map = {
    black: 'Чёрный',
    white: 'Белый',
    gray: 'Серый',
    ginger: 'Рыжий',
    cream: 'Кремовый',
    tabby: 'Полосатый',
    bicolor: 'Двухцветный',
    tricolor: 'Трёхцветный',
    tortie: 'Черепаховый',
    colorpoint: 'Колор-пойнт',
    other: 'Другой',
  };

  return map[color] || color || 'не указан';
}

function boolLabel(value) {
  if (value === true) return 'да';
  if (value === false) return 'нет';
  return '?';
}

function nextBoolValue(value) {
  if (value === null || value === undefined) return true;
  if (value === true) return false;
  return null;
}

function boolEditKeyboard(animal) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(`${BOOLEAN_FIELDS.good_with_cats}: ${boolLabel(animal.good_with_cats)}`, `tb:${animal.id}:good_with_cats`),
      Markup.button.callback(`${BOOLEAN_FIELDS.good_with_dogs}: ${boolLabel(animal.good_with_dogs)}`, `tb:${animal.id}:good_with_dogs`),
    ],
    [Markup.button.callback(`${BOOLEAN_FIELDS.good_with_children}: ${boolLabel(animal.good_with_children)}`, `tb:${animal.id}:good_with_children`)],
    [
      Markup.button.callback(`${BOOLEAN_FIELDS.vaccinated}: ${boolLabel(animal.vaccinated)}`, `tb:${animal.id}:vaccinated`),
      Markup.button.callback(`${BOOLEAN_FIELDS.sterilized}: ${boolLabel(animal.sterilized)}`, `tb:${animal.id}:sterilized`),
    ],
    [Markup.button.callback(`${BOOLEAN_FIELDS.chipped}: ${boolLabel(animal.chipped)}`, `tb:${animal.id}:chipped`)],
    [Markup.button.callback(`${BOOLEAN_FIELDS.parasite_treated}: ${boolLabel(animal.parasite_treated)}`, `tb:${animal.id}:parasite_treated`)],
    [Markup.button.callback('⬅️ Назад к редактированию', `open_cat:${animal.id}`)],
  ]);
}

function animalEditText(animal) {
  return [
    `🐱 ${animal.name}`,
    '',
    `Статус: ${formatStatus(animal.status)}`,
    `Котокафе: ${formatLocation(animal.location)}`,
    '',
    `${BOOLEAN_FIELDS.good_with_cats}: ${boolLabel(animal.good_with_cats)}`,
    `${BOOLEAN_FIELDS.good_with_dogs}: ${boolLabel(animal.good_with_dogs)}`,
    `${BOOLEAN_FIELDS.good_with_children}: ${boolLabel(animal.good_with_children)}`,
    `${BOOLEAN_FIELDS.vaccinated}: ${boolLabel(animal.vaccinated)}`,
    `${BOOLEAN_FIELDS.sterilized}: ${boolLabel(animal.sterilized)}`,
    `${BOOLEAN_FIELDS.chipped}: ${boolLabel(animal.chipped)}`,
    `${BOOLEAN_FIELDS.parasite_treated}: ${boolLabel(animal.parasite_treated)}`,
    '',
    `Комментарий о здоровье: ${animal.health_comment || 'не указан'}`,
    `Комментарий о характере: ${animal.character_comment || 'не указан'}`,
    `Другие требования к пристройству: ${animal.adoption_requirements_other || 'не указаны'}`,
  ].join('\n');
}

function resetSession(userId) {
  sessions.delete(userId);
}

async function showEditMenu(ctx, animal) {
  return ctx.reply([`📌 Работаем с кошкой: ${animal.name}`, '', animalPublicationLabel(animal), '', 'Что редактируем?'].join('\n'), editMenuKeyboard(animal));
}
async function showAnimalTraitsEditor(ctx, animal) {
  return ctx.reply(animalEditText(animal), boolEditKeyboard(animal));
}

async function pinCurrentAnimalMessage(ctx, user, animal) {
  const message = await ctx.reply(
    `📌 Работаем с кошкой: ${animal.name}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Открыть меню редактирования', `open_cat:${animal.id}`)],
      [Markup.button.callback('❌ Завершить работу', 'finish_work')],
    ])
  );
  try {
    await ctx.pinChatMessage(message.message_id, { disable_notification: true });
  } catch (error) {
    console.error('PIN ERROR:', error.response?.data || error.message);
    await ctx.reply('Не удалось закрепить сообщение. Возможно, у бота нет прав на закрепление. Работу с кошкой можно продолжать.');
  }
  await setCurrentAnimal(user.id, animal.id, ctx.chat.id, message.message_id);
}

async function createAnimalFromSession(ctx, user, mainPhotoId) {
  const session = sessions.get(ctx.from.id);
  if (!session) return ctx.reply('Сессия создания не найдена. Начните заново.');

  const payload = {
    ...session.data,
    author_id: user?.id || null,
    short_description: null,
    story: null,
    published: false,
    featured: false,
    vaccinated: true,
    sterilized: true,
    chipped: true,
    parasite_treated: true,
    adoption_requirements_other: null,
    health_comment: null,
    character_comment: null,
    good_with_cats: null,
    good_with_dogs: null,
    good_with_children: null,
  };

  delete payload.creatingAnimal;

  const animal = await createAnimal(payload);
  resetSession(ctx.from.id);
  await animalMedia.addAnimalPhoto(animal.id, mainPhotoId, { is_main: true, sort: 10 });
  await ensureAnimalAvatarFromPhoto(animal.id, mainPhotoId, { source: 'auto_from_photo' });
  await logAnimalStatusChange({
    animalId: animal.id,
    oldStatus: null,
    newStatus: payload.status || animal.status || null,
    user,
    source: 'telegram_bot_create',
  });
  const savedAnimal = await getAnimalById(animal.id) || animal;

  await ctx.reply(
    [
      'Кошка создана ✅',
      '',
      `Имя: ${savedAnimal.name}`,
      `Slug: ${savedAnimal.slug}`,
      `Статус: ${formatStatus(savedAnimal.status)}`,
      `Котокафе: ${formatLocation(savedAnimal.location)}`,
    ].join('\n'),
    await mainMenu(user)
  );

  await pinCurrentAnimalMessage(ctx, user, savedAnimal);
  return showEditMenu(ctx, savedAnimal);
}

async function startCreateCat(ctx, user) {
  resetSession(ctx.from.id);
  if (user?.current_animal_id) await clearCurrentAnimalAndUnpin(ctx, user);
  sessions.set(ctx.from.id, { step: 'cat_name', data: { creatingAnimal: true } });
  return ctx.reply('📌 Завожу новую кошку\n\nИмя кошки?');
}

async function startGalleryEdit(ctx, animal, source = null) {
  sessions.set(ctx.from.id, {
    step: 'edit_gallery',
    data: { animal_id: animal.id, added_count: 0, media_source: source || null },
  });

  return ctx.reply(
    [
      `📸 Галерея: ${animal.name}`,
      source ? `Тип медиа: ${mediaSourceLabel(source)}` : null,
      '',
      'Отправьте фото или ссылки на фото.',
      `Можно до ${MAX_GALLERY_PHOTOS} фото.`,
      '',
      'Когда закончите, нажмите «✅ Готово».',
    ].join('\n'),
    galleryDoneKeyboard()
  );
}

async function startAvatarEdit(ctx, animal) {
  sessions.set(ctx.from.id, {
    step: 'edit_avatar',
    data: { animal_id: animal.id },
  });

  return ctx.reply(
    [
      `🖼 Аватар: ${animal.name}`,
      '',
      'Отправьте одно фото или прямую ссылку на изображение.',
      'Новый аватар заменит текущий.',
    ].join('\n')
  );
}

async function finishGalleryEdit(ctx, user) {
  const session = sessions.get(ctx.from.id);
  const animalId = session?.data?.animal_id;
  if (!animalId) return ctx.reply('Не найдена кошка для галереи.');

  const animal = await getAnimalById(animalId);
  const count = Number(session.data.added_count || 0);
  resetSession(ctx.from.id);

  await ctx.reply(`Галерея сохранена ✅\nДобавлено фото: ${count}`, await mainMenu(user));
  return showEditMenu(ctx, animal);
}



bot.command('ping', async (ctx) => {
  return ctx.reply(`pong: ${ctx.chat?.type || 'chat'}, @${ctx.botInfo?.username || BOT_USERNAME || 'bot'}`);
});

bot.command('photo', async (ctx) => {
  try {
    if (await handleGroupCatCommand(ctx)) return;
    return ctx.reply('Напишите /photo Имя кошки или ответьте /photo на пост с именем кошки.');
  } catch (error) {
    console.error('PHOTO COMMAND ERROR:', error.response?.data || error.message);
    return ctx.reply('Не получилось выполнить команду. Посмотри логи catbot.', commandReplyExtra(ctx));
  }
});

function mixplatPaymentButton(ctx, url) {
  // Mixplat стабильнее открывать обычной URL-кнопкой.
  // Telegram WebApp для внешней платёжной страницы иногда требует повторного нажатия
  // или зависит от домена WebApp, поэтому для оплаты используем URL во всех чатах.
  return Markup.button.url('Оплатить', url);
}

function rubToKopecks(value) {
  const amount = Number(String(value || 0).replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 100);
}

function kopecksToRub(value) {
  const kopecks = Number(value || 0);
  if (!Number.isFinite(kopecks) || kopecks <= 0) return 0;
  return kopecks / 100;
}

function formatRub(value) {
  const amount = Number(String(value || 0).replace(',', '.'));
  if (!Number.isFinite(amount)) return String(value || '');
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/\.00$/, '').replace('.', ',');
}

function paymentKindLabel(paymentType) {
  if (paymentType === 'feed') return 'Дать вкусняшку';
  return 'Донат';
}

function paymentKindEmoji(paymentType) {
  if (paymentType === 'feed') return '🍪';
  return '💳';
}

function parseDonateStartPayload(payload) {
  const raw = String(payload || '').trim();

  const contextMatch = raw.match(/^ctx_([a-z0-9]+)_(\d+)$/i);
  if (contextMatch) {
    const context = takeDonationDeepLinkContext(contextMatch[1]);
    if (!context) {
      return { expired: true, amountRub: kopecksToRub(contextMatch[2]) };
    }
    return {
      paymentType: context.paymentType === 'feed' ? 'feed' : 'donate',
      animalId: context.animalId,
      needId: context.needId || null,
      needTitle: context.needTitle || null,
      amountRub: kopecksToRub(contextMatch[2]),
      source: context.source || 'telegram_group_deeplink',
      sourceChatId: context.sourceChatId || null,
      sourceMessageId: context.sourceMessageId || null,
      sourceThreadId: context.sourceThreadId || null,
    };
  }

  const needMatch = raw.match(/^need_([0-9a-fA-F-]{8,})_(\d+)$/);
  if (needMatch) {
    return {
      paymentType: 'donate',
      needId: needMatch[1],
      amountRub: kopecksToRub(needMatch[2]),
    };
  }

  const match = raw.match(/^(donate|feed)_([0-9a-fA-F-]{8,})_(\d+)$/);
  if (!match) return null;
  return {
    paymentType: match[1] === 'feed' ? 'feed' : 'donate',
    animalId: match[2],
    amountRub: kopecksToRub(match[3]),
  };
}

function donationThanksConfiguredChatId() {
  return DONATION_THANKS_CHAT_ID || null;
}

function donationThanksChannelLabel() {
  return 'ответьте под тем постом, откуда вы перешли';
}

function randomDonationContextToken() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}


function donationSourceKey(chatId, messageId) {
  if (!chatId || !messageId) return null;
  return `${chatId}:${messageId}`;
}

function rememberDonationSourceForMessage(message, source) {
  if (!message?.chat?.id || !message?.message_id || !source?.sourceChatId) return;
  const key = donationSourceKey(message.chat.id, message.message_id);
  if (!key) return;
  donationSourceContexts.set(key, { ...source, createdAt: Date.now() });

  const ttlMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const [ctxKey, value] of donationSourceContexts.entries()) {
    if (!value?.createdAt || now - value.createdAt > ttlMs) donationSourceContexts.delete(ctxKey);
  }
}

function rememberedDonationSourceFromMessage(message) {
  const key = donationSourceKey(message?.chat?.id, message?.message_id);
  if (!key) return null;
  const source = donationSourceContexts.get(key);
  return source ? { ...source } : null;
}

function sourcePostIdFromMessage(message) {
  const replyTo = message?.reply_to_message || null;
  return replyTo?.message_id || message?.message_thread_id || message?.message_id || null;
}

function sourcePostContextFromCtx(ctx) {
  const message = ctx.callbackQuery?.message || currentMessage(ctx);
  if (!message?.chat?.id) return {};

  // В личном чате источником считается только ранее открытый deep link из поста.
  // Саму личку нельзя использовать как адрес публичной благодарности.
  if (isPrivateChat(ctx)) {
    const origin = userDonationOriginContexts.get(String(ctx.from?.id || ''));
    if (!origin || !origin.createdAt || Date.now() - origin.createdAt > 24 * 60 * 60 * 1000) {
      if (ctx.from?.id) userDonationOriginContexts.delete(String(ctx.from.id));
      return {};
    }
    return {
      sourceChatId: origin.sourceChatId,
      sourceMessageId: origin.sourceMessageId,
      sourceThreadId: origin.sourceThreadId,
    };
  }

  // Когда пользователь проходит меню «Помочь → сумма», callback приходит уже
  // от отредактированного сообщения бота. У него может не быть reply_to_message,
  // поэтому держим исходный пост в памяти по message_id этого меню.
  const remembered = rememberedDonationSourceFromMessage(message);
  if (remembered?.sourceChatId) return remembered;

  const replyTo = message.reply_to_message || null;
  const sourceMessageId = sourcePostIdFromMessage(message);
  const sourceThreadId = message.message_thread_id || replyTo?.message_thread_id || sourceMessageId || null;

  return {
    sourceChatId: message.chat.id,
    sourceMessageId,
    sourceThreadId,
  };
}

function saveDonationDeepLinkContext(ctx, animal, amountRub, paymentType = 'donate', options = {}) {
  const token = randomDonationContextToken();
  const sourcePost = sourcePostContextFromCtx(ctx);
  donationDeepLinkContexts.set(token, {
    animalId: animal?.id || null,
    amountRub,
    paymentType,
    needId: options.needId || null,
    needTitle: options.needTitle || null,
    source: options.source || 'telegram_group_deeplink',
    ...sourcePost,
    createdAt: Date.now(),
  });

  // Простая чистка старых контекстов, чтобы Map не рос бесконечно.
  const ttlMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const [key, value] of donationDeepLinkContexts.entries()) {
    if (!value?.createdAt || now - value.createdAt > ttlMs) donationDeepLinkContexts.delete(key);
  }

  return token;
}

function takeDonationDeepLinkContext(token) {
  const ctxData = donationDeepLinkContexts.get(token);
  if (ctxData) donationDeepLinkContexts.delete(token);
  return ctxData || null;
}

function donationPermissionText(animal, amountRub, paymentType = 'donate', options = {}) {
  const needTitle = options.needTitle ? String(options.needTitle).trim() : '';
  return [
    needTitle ? `🙏 Помощь на нужду для ${animal.name || 'кошки'}` : `${paymentKindEmoji(paymentType)} ${paymentKindLabel(paymentType)} для ${animal.name || 'кошки'}`,
    needTitle ? `Нужда: ${needTitle}` : null,
    `Сумма: ${formatRub(amountRub)} ₽`,
  ].filter(Boolean).join('\n');
}

function donationPermissionKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Да, можно', 'donation_public_thanks_yes')],
    [Markup.button.callback('🙈 Нет, анонимно', 'donation_public_thanks_no')],
  ]);
}

async function askDonationThanksPermission(ctx, animal, amountRub, paymentType = 'donate', options = {}) {
  const inheritedSource = sourcePostContextFromCtx(ctx);
  const sourceContext = {
    sourceChatId: options.sourceChatId || inheritedSource.sourceChatId || null,
    sourceMessageId: options.sourceMessageId || inheritedSource.sourceMessageId || null,
    sourceThreadId: options.sourceThreadId || inheritedSource.sourceThreadId || null,
  };

  console.log('DONATION PAYMENT CONTEXT:', {
    chat_type: ctx.chat?.type || null,
    animal_id: animal.id,
    amountRub,
    paymentType,
    sourceChatId: sourceContext.sourceChatId || null,
    sourceMessageId: sourceContext.sourceMessageId || null,
    sourceThreadId: sourceContext.sourceThreadId || null,
  });

  return sendPrivateDonationPayment(ctx, animal, amountRub, paymentType, {
    ...options,
    ...sourceContext,
    publicThanks: false,
    askPublicThanksAfterPayment: false,
    source: options.source || (isPrivateChat(ctx) ? 'telegram_private_donate_flow' : 'telegram_discussion_donate_flow'),
  });
}

async function sendPrivateDonationPayment(ctx, animal, amountRub, paymentType = 'donate', options = {}) {
  const needTitle = options.needTitle ? String(options.needTitle).trim() : '';
  const payment = await createCatDonationPayment({
    animal,
    amountRub,
    paymentType,
    source: options.source || (needTitle ? 'telegram_need_button' : (paymentType === 'feed' ? 'telegram_feed_button' : 'telegram_donate_flow')),
    donorTelegramId: ctx.from?.id,
    donorUsername: ctx.from?.username || ctx.from?.first_name || null,
    needId: options.needId || null,
    needTitle: needTitle || null,
    comment: needTitle ? `Помощь на нужду: ${needTitle}` : null,
    publicThanks: options.publicThanks === true ? true : (options.publicThanks === false ? false : null),
    askPublicThanksAfterPayment: options.askPublicThanksAfterPayment === true,
    thanksChatId: options.sourceChatId || donationThanksConfiguredChatId() || null,
    thanksThreadId: options.sourceThreadId || null,
    sourceChatId: options.sourceChatId || null,
    sourceMessageId: options.sourceMessageId || null,
    sourceThreadId: options.sourceThreadId || null,
    donorFirstName: ctx.from?.first_name || null,
    donorLastName: ctx.from?.last_name || null,
  });

  return ctx.reply(
    [
      needTitle ? `🙏 Помощь на нужду для ${animal.name || 'кошки'}` : `${paymentKindEmoji(paymentType)} ${paymentKindLabel(paymentType)} для ${animal.name || 'кошки'}`,
      needTitle ? `Нужда: ${needTitle}` : null,
      `Сумма: ${formatRub(payment.amount)} ₽`,
      '',
      'Нажмите кнопку, чтобы перейти к оплате.',
    ].filter(Boolean).join('\n'),
    commandReplyExtra(ctx, Markup.inlineKeyboard([[mixplatPaymentButton(ctx, payment.redirect_url)]]))
  );
}

async function sendGroupDonationDeepLink(ctx, animal, amountRub, paymentType = 'donate', options = {}) {
  // Старый сценарий с переходом в личку отключён.
  // Оставляем функцию как безопасный fallback: она запускает оплату в текущем обсуждении.
  return askDonationThanksPermission(ctx, animal, amountRub, paymentType, options);
}

async function startPaymentForContext(ctx, animal, amountRub, paymentType = 'donate', options = {}) {
  // Оплату создаём в текущем чате после согласия/отказа на публичную благодарность.
  // В группы и обсуждения больше не отправляем deep-link в личку.
  return askDonationThanksPermission(ctx, animal, amountRub, paymentType, options);
}

async function handleDonateStartPayload(ctx, payload) {
  const parsed = parseDonateStartPayload(payload);
  if (!parsed) return false;
  if (parsed.expired) {
    await ctx.reply('Ссылка на оплату устарела. Вернитесь к посту кошки и нажмите «Помочь» ещё раз.');
    return true;
  }

  let animal = null;
  let options = {};

  if (parsed.needId) {
    const need = await getAnimalNeedById(parsed.needId);
    if (!need) {
      await ctx.reply('Эта нужда уже закрыта или не найдена. Попробуйте создать платёж заново.');
      return true;
    }
    const animalId = extractFileId(need.animal_id) || need.animal_id;
    animal = await getAnimalById(animalId);
    options = { needId: need.id, needTitle: need.title || 'Нужда' };
  } else {
    animal = await getAnimalById(parsed.animalId);
  }

  options = {
    ...options,
    source: parsed.source || options.source || null,
    sourceChatId: parsed.sourceChatId || null,
    sourceMessageId: parsed.sourceMessageId || null,
    sourceThreadId: parsed.sourceThreadId || null,
  };
  if (parsed.needTitle && !options.needTitle) options.needTitle = parsed.needTitle;

  if (!animal) {
    await ctx.reply('Кошка для платежа не найдена. Попробуйте создать платёж заново из группы.');
    return true;
  }

  // Старые /start-ссылки на оплату не должны открывать донат для скрытой/архивной кошки.
  if (!isAnimalPublicForWeb(animal)) {
    await ctx.reply('Эта карточка сейчас не опубликована. Платёж по старой ссылке недоступен.');
    return true;
  }

  if (!parsed.amountRub) {
    await ctx.reply('Не понял сумму. Попробуйте создать платёж заново.');
    return true;
  }

  await askDonationThanksPermission(ctx, animal, parsed.amountRub, parsed.paymentType, options);
  return true;
}


async function handleDonationsCommand(ctx, rawText) {
  const text = String(rawText || '').trim();
  const query = text
    .replace(/^\/donations(@\w+)?/i, '')
    .replace(/^\/donates(@\w+)?/i, '')
    .replace(/^донаты/i, '')
    .trim();

  if (!query) {
    return ctx.reply('Напишите: донаты Имя кошки\nНапример: донаты Мандарин', commandReplyExtra(ctx));
  }

  const accessUser = await ensureViewAnimalsAccess(ctx);
  if (!accessUser) return;
  if (isGuestUser(accessUser)) {
    return ctx.reply('История донатов доступна только сотрудникам фонда.', commandReplyExtra(ctx));
  }

  const result = await findAnimalFromText(query, { publicOnly: false });
  const animals = result.animals || [];

  if (!animals.length) {
    return ctx.reply('Не нашёл кошку. Напишите имя явно, например: донаты Мандарин', commandReplyExtra(ctx));
  }

  if (animals.length > 1) {
    return ctx.reply('Нашёл несколько кошек. Уточните имя:', commandReplyExtra(ctx, catsListKeyboard(animals.slice(0, 10))));
  }

  const animal = await getAnimalById(animals[0].id) || animals[0];
  return sendAnimalDonations(ctx, animal);
}

async function handleDonateCommand(ctx, rawText) {
  const text = String(rawText || '').trim();
  const cleaned = text
    .replace(/^\/donate(@\w+)?/i, '')
    .replace(/^донат/i, '')
    .trim();

  if (!cleaned) {
    return ctx.reply('Напишите: донат Имя кошки 300\nНапример: донат Мандарин 300', commandReplyExtra(ctx));
  }

  const amountMatch = cleaned.match(/(?:^|\s)(\d+(?:[.,]\d{1,2})?)\s*(?:₽|руб(?:\.|лей|ля)?|р)?(?:\s|$)/i);
  const amountRub = amountMatch ? amountMatch[1] : (process.env.MIXPLAT_DONATE_DEFAULT_RUB || 300);
  const query = amountMatch
    ? cleaned.replace(amountMatch[0], ' ').replace(/\s+/g, ' ').trim()
    : cleaned;

  if (!query) {
    return ctx.reply('Не понял имя кошки. Напишите: донат Мандарин 300', commandReplyExtra(ctx));
  }

  const accessUser = await ensureSearchAnimalsAccess(ctx);
  if (!accessUser) return;

  const result = await findAnimalFromText(query, { publicOnly: isGuestUser(accessUser) });
  const animals = result.animals || [];

  if (!animals.length) {
    return ctx.reply('Не нашёл кошку. Напишите имя явно, например: донат Мандарин 300', commandReplyExtra(ctx));
  }

  if (animals.length > 1) {
    return ctx.reply('Нашёл несколько кошек. Уточните имя:', commandReplyExtra(ctx, catsListKeyboard(animals.slice(0, 10))));
  }

  const animal = await getAnimalForCatalogUser(animals[0].id, accessUser) || animals[0];
  if (!animalVisibleForCatalogUser(animal, accessUser)) return ctx.reply('Кошка не найдена.', commandReplyExtra(ctx));
  return startPaymentForContext(ctx, animal, amountRub, 'donate');
}

bot.command('donate', async (ctx) => {
  try {
    return handleDonateCommand(ctx, getMessageText(currentMessage(ctx)));
  } catch (error) {
    console.error('DONATE COMMAND ERROR:', error.response?.data || error.message);
    return ctx.reply(error.message || 'Не получилось создать платёж. Посмотри логи catbot.', commandReplyExtra(ctx));
  }
});


bot.command('donations', async (ctx) => {
  try {
    return handleDonationsCommand(ctx, getMessageText(currentMessage(ctx)));
  } catch (error) {
    console.error('DONATIONS COMMAND ERROR:', error.response?.data || error.message);
    return ctx.reply(error.message || 'Не получилось показать донаты. Посмотри логи catbot.', commandReplyExtra(ctx));
  }
});

bot.command('donates', async (ctx) => {
  try {
    return handleDonationsCommand(ctx, getMessageText(currentMessage(ctx)));
  } catch (error) {
    console.error('DONATES COMMAND ERROR:', error.response?.data || error.message);
    return ctx.reply(error.message || 'Не получилось показать донаты. Посмотри логи catbot.', commandReplyExtra(ctx));
  }
});

bot.hears(/^донаты(\s|$)/i, async (ctx) => {
  try {
    return handleDonationsCommand(ctx, getMessageText(currentMessage(ctx)));
  } catch (error) {
    console.error('DONATIONS HEARS ERROR:', error.response?.data || error.message);
    return ctx.reply(error.message || 'Не получилось показать донаты. Посмотри логи catbot.', commandReplyExtra(ctx));
  }
});

bot.hears(/^донат(\s|$)/i, async (ctx) => {
  try {
    return handleDonateCommand(ctx, getMessageText(currentMessage(ctx)));
  } catch (error) {
    console.error('DONAT HEARS ERROR:', error.response?.data || error.message);
    return ctx.reply(error.message || 'Не получилось создать платёж. Посмотри логи catbot.', commandReplyExtra(ctx));
  }
});

bot.hears(/^\/?(фото|анкета|инфо|отзыв|отзывы|донаты|донат|история|видео|photo|photos|anketa|card|info|review|reviews|donations|donates|story|history|video)(@\w+)?(\s|$)/i, async (ctx, next) => {
  try {
    if (isGroupChat(ctx) && await handleGroupCatCommand(ctx)) return;
    return next();
  } catch (error) {
    console.error('GROUP COMMAND HEARS ERROR:', error.response?.data || error.message);
    if (isGroupChat(ctx)) return ctx.reply('Не получилось выполнить команду. Посмотри логи catbot.', commandReplyExtra(ctx));
    return next();
  }
});

bot.hears(/^@\w+/i, async (ctx, next) => {
  try {
    if (isGroupChat(ctx) && await handleGroupCatCommand(ctx)) return;
    return next();
  } catch (error) {
    console.error('MENTION COMMAND ERROR:', error.response?.data || error.message);
    if (isGroupChat(ctx)) return ctx.reply('Не получилось выполнить команду. Посмотри логи catbot.', commandReplyExtra(ctx));
    return next();
  }
});

bot.on('message', async (ctx, next) => {
  try {

console.log('TOPIC DEBUG:', {
  chatId: ctx.chat?.id,
  chatType: ctx.chat?.type,
  threadId: ctx.message?.message_thread_id,
  text: ctx.message?.text,
});
	
    const discussionPost = isChannelDiscussionPost(ctx);
    if (discussionPost && await handleAutoCatPost(ctx)) return;
    if (await handleGroupCatCommand(ctx)) return;
    if (!discussionPost && await handleAutoCatPost(ctx)) return;
    return next();
  } catch (error) {
    console.error('GROUP MESSAGE ERROR:', error.response?.data || error.message);
    if (isGroupChat(ctx)) return;
    return ctx.reply('Не получилось выполнить команду. Посмотри логи catbot.');
  }
});

bot.on('channel_post', async (ctx) => {
  try {
    if (await handleChannelCatalogCommand(ctx)) return;
  } catch (error) {
    console.error('CHANNEL POST COMMAND ERROR:', error.response?.data || error.message);
    return ctx.reply('Не получилось выполнить команду. Посмотри логи catbot.');
  }
});


bot.start(async (ctx) => {
  try {
    const startText = getMessageText(currentMessage(ctx));
    const payload = String(ctx.startPayload || startText.replace(/^\/start(@\w+)?/i, '') || '').trim();
    if (await handleShareStartPayload(ctx, payload)) return;
    if (await handleDonateStartPayload(ctx, payload)) return;
    if (await handleCatalogStartPayload(ctx, payload)) return;
    // Обычный /start означает новый личный сценарий без привязки к публичному посту.
    userDonationOriginContexts.delete(String(ctx.from?.id || ''));

    const user = await findTeamByTelegramId(ctx.from.id);
    if (user) {
      await ctx.reply(
        `Каталог кошек

Здравствуйте, ${user.full_name}.`,
        await mainMenu(user)
      );
      return ctx.reply('Что делаем?', await welcomeInlineMenu(user));
    }

    await ctx.reply(
      'Каталог кошек\n\nСпасибо, вы можете просматривать и искать кошек.',
      await mainMenu(null)
    );
    return ctx.reply('Что делаем?', await welcomeInlineMenu(null));
  } catch (error) {
    console.error('START ERROR:', error.response?.data || error.message);
    return ctx.reply('Ошибка авторизации. Посмотри логи catbot.');
  }
});

bot.command('cancel', async (ctx) => {
  resetSession(ctx.from.id);
  const user = await getCurrentUser(ctx);
  if (user) return ctx.reply('Действие отменено.', await mainMenu(user));
  return ctx.reply('Действие отменено.');
});

bot.on('contact', async (ctx) => {
  try {
    const contact = ctx.message.contact;
    if (contact.user_id !== ctx.from.id) {
      return ctx.reply('Нужно использовать кнопку «Поделиться телефоном».');
    }
    const phone = normalizePhone(contact.phone_number);
    const teamUser = await findTeamByPhone(phone);
    if (!teamUser) return ctx.reply('Ваш номер отсутствует в списке пользователей. Обратитесь к администратору.');
    await bindTelegramId(teamUser.id, ctx.from.id);
    resetSession(ctx.from.id);
    await ctx.reply(
      `Готово ✅\n\nTelegram привязан.\nЗдравствуйте, ${teamUser.full_name}.`,
      await mainMenu(teamUser)
    );
    return ctx.reply('Что делаем?', await welcomeInlineMenu(teamUser));
  } catch (error) {
    console.error('CONTACT ERROR:', error.response?.data || error.message);
    return ctx.reply('Ошибка авторизации. Посмотри логи catbot.');
  }
});

bot.on('text', async (ctx) => {
  try {
    //  группах обычные сообщения не должны попадать в админский сценарий.
    // Групповые команды уже обработаны выше через handleGroupCatCommand().
    // Если это не команда бота, молчим и не пишем "Нет доступа".
    if (isGroupChat(ctx)) return;

    const text = ctx.message.text.trim();
    const session = sessions.get(ctx.from.id);

    // Команды каталога в личке: фото/анкета/инфо/отзыв/история/видео Имя.
    // Они не должны падать в админское меню и отвечать «Выберите действие из меню».
    if (!session && await handlePrivateCatCommand(ctx)) return;

    if (session && /^cafe_media_(photo|video)$/.test(String(session.step || ""))) {
      if (text === MENU_CAFE_MEDIA) {
        resetSession(ctx.from.id);
        const accessUser = await ensureEditAnimalAccess(ctx);
        if (!accessUser) return;
        return ctx.reply("\u{1F3E0} \u0416\u0438\u0437\u043d\u044c \u043a\u043e\u0442\u043e\u043a\u0430\u0444\u0435\n\n\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043a\u043e\u0442\u043e\u043a\u0430\u0444\u0435:", cafeMediaHomeKeyboard());
      }
      if (text === MENU_LIST_CATS || /список кош|кошки/i.test(text)) {
        resetSession(ctx.from.id);
        return showCatsLocationPicker(ctx);
      }
      if (text === MENU_FIND_CAT || /найти кошк/i.test(text)) {
        resetSession(ctx.from.id);
        return startFindCat(ctx);
      }
    }

    if (!session) {
      const user = await getCurrentUser(ctx);

      if (text === MENU_AUTH_CONTACT || /поделиться\s+(номером|телефоном)|привязать\s+(номер|телефон)|авторизац/i.test(text)) {
        sessions.set(ctx.from.id, { step: 'auth_contact', data: {} });
        return ctx.reply('Если вы сотрудник или куратор, нажмите кнопку ниже, чтобы привязать Telegram к учётной записи.', authMenu());
      }

      if (text === MENU_ADD_CAT || text.includes('Добавить кошку')) {
        const accessUser = await ensureButtonAccess(ctx, BUTTON_ADD_CAT);
        if (!accessUser) return;
        return startCreateCat(ctx, accessUser);
      }
      if (text === MENU_FIND_CAT || /найти кошк/i.test(text)) return startFindCat(ctx);
      if (text === MENU_LIST_CATS || /список кош|кошки/i.test(text)) return showCatsLocationPicker(ctx);
      if (text === MENU_CAFE_MEDIA) {
        const accessUser = await ensureEditAnimalAccess(ctx);
        if (!accessUser) return;
        return ctx.reply('\u{1F3E0} \u0416\u0438\u0437\u043d\u044c \u043a\u043e\u0442\u043e\u043a\u0430\u0444\u0435\n\n\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043a\u043e\u0442\u043e\u043a\u0430\u0444\u0435:', cafeMediaHomeKeyboard());
      }

      const button = user ? await getButtonByTitleForUser(user, text) : null;
      if (button?.code === BUTTON_ADD_CAT) {
        const accessUser = await ensureButtonAccess(ctx, BUTTON_ADD_CAT);
        if (!accessUser) return;
        return startCreateCat(ctx, accessUser);
      }
      return ctx.reply(
        user ? 'Выберите действие из меню.' : 'Вы можете просматривать и искать кошек.',
        await mainMenu(user)
      );
    }

    if (session.step === 'leave_review') {
      return animalReviews.handleReviewTextMessage(ctx, text);
    }

    if (session.step === 'donate_custom_amount') {
      const animal = await getAnimalById(session.data.animal_id);
      if (!animal) {
        resetSession(ctx.from.id);
        return ctx.reply('Кошка для доната не найдена. Попробуйте заново.');
      }
      const amountRub = text.replace(',', '.').replace(/[^0-9.]/g, '');
      if (!amountRub || Number(amountRub) <= 0) {
        return ctx.reply('Напишите сумму числом. Например: 700');
      }
      const needTitle = session.data.need_title || null;
      const needId = session.data.need_id || null;
      const paymentType = session.data.payment_type === 'feed' ? 'feed' : 'donate';
      resetSession(ctx.from.id);
      return askDonationThanksPermission(ctx, animal, amountRub, paymentType, { needId, needTitle });
    }

    if (session.step === 'find_cat') {
      const searchUser = await ensureSearchAnimalsAccess(ctx);
      if (!searchUser) return;
      const animals = await searchAnimalsByName(text, 10, { publicOnly: isGuestUser(searchUser) });
      if (!animals.length) {
        return ctx.reply('Кошка не найдена. Попробуйте другое имя или нажмите /cancel.');
      }
      resetSession(ctx.from.id);
      return ctx.reply(`Найдено: ${animals.length}`, catsListKeyboard(animals));
    }

    if (session.step === 'cat_name') {
      const existingAnimal = await findAnimalByExactName(text);
      if (existingAnimal) {
        return ctx.reply(`Кошка с именем «${existingAnimal.name}» уже заведена. Имя должно быть уникальным. Напишите другое имя или нажмите /cancel.`);
      }
      session.data.name = text;
      session.data.slug = slugify(text);
      session.step = 'sex';
      return ctx.reply('Пол?', Markup.inlineKeyboard([
        [Markup.button.callback('Кошка', 'sex:female')],
        [Markup.button.callback('Кот', 'sex:male')],
      ]));
    }

    if (session.step === 'age_months') {
      const months = parseMonths(text);
      if (!Number.isFinite(months) || months < 0 || months > 360) {
        return ctx.reply('Напишите возраст в месяцах. Например: 3, 12, 18 или 2 года.');
      }
      session.data.birth_date = monthsToBirthDate(months);
      session.data.birth_date_approximate = true;
      session.step = 'status';
      return ctx.reply('Статус?', Markup.inlineKeyboard([
        [Markup.button.callback('Ищет дом', 'status:looking_home')],
        [Markup.button.callback('На знакомстве', 'status:meeting')],
        [Markup.button.callback('Забронирована', 'status:reserved')],
        [Markup.button.callback('Уже дома', 'status:adopted')],
      ]));
    }

    if (session.step === 'edit_age') {
      const user = await ensureEditAnimalAccess(ctx);
      if (!user) return;
      const months = parseMonths(text);
      if (!Number.isFinite(months) || months < 0 || months > 360) {
        return ctx.reply('Напишите возраст в месяцах. Например: 3, 12, 18 или 2 года.');
      }
      const animal = await getEditableAnimalOrReply(ctx, session.data.animal_id, user);
      if (!animal) return;
      const updated = await directusPatch('animals', animal.id, {
        birth_date: monthsToBirthDate(months),
        birth_date_approximate: true,
      });
      resetSession(ctx.from.id);
      await ctx.reply('Возраст сохранён ✅');
      return showEditMenu(ctx, updated);
    }

    if (session.step === 'color_note') {
      session.data.color_note = text;
      session.step = 'photo';
      return ctx.reply('Теперь отправьте главное фото кошки или ссылку на фото.');
    }

    if (session.step === 'add_need') {
      const user = await ensureNeedsAccess(ctx);
      if (!user) return;
      const url = extractUrl(text);
      const title = String(url ? text.replace(url, '') : text).trim().replace(/[—–-]+$/g, '').trim();
      if (!title) return ctx.reply('Напишите название нужды. Например: Корм Gastrointestinal');
      const animal = await getEditableAnimalOrReply(ctx, session.data.animal_id, user);
      if (!animal) return ctx.reply('Кошка не найдена.');
      await createAnimalNeed(animal.id, title, url);
      resetSession(ctx.from.id);
      await ctx.reply('Нужда добавлена ✅');
      return showAnimalNeedsManager(ctx, animal);
    }

    if (session.step === 'edit_short') {
      const user = await ensureEditAnimalAccess(ctx);
      if (!user) return;
      const animal = await getEditableAnimalOrReply(ctx, session.data.animal_id, user);
      if (!animal) return;
      const updated = await directusPatch('animals', animal.id, { short_description: text });
      resetSession(ctx.from.id);
      await ctx.reply('Короткое описание сохранено ✅');
      return showEditMenu(ctx, updated);
    }

    if (session.step === 'edit_story') {
      const user = await ensureEditAnimalAccess(ctx);
      if (!user) return;
      const animal = await getEditableAnimalOrReply(ctx, session.data.animal_id, user);
      if (!animal) return;
      const updated = await directusPatch('animals', animal.id, { story: text });
      resetSession(ctx.from.id);
      await ctx.reply('История сохранена ✅');
      return showEditMenu(ctx, updated);
    }

    if (session.step === 'edit_health_comment') {
      const user = await ensureEditAnimalAccess(ctx);
      if (!user) return;
      const value = normalizeCommentText(text) || null;
      const animal = await getEditableAnimalOrReply(ctx, session.data.animal_id, user);
      if (!animal) return;
      const updated = await directusPatch('animals', animal.id, { health_comment: value });
      resetSession(ctx.from.id);
      await ctx.reply('Комментарий о здоровье сохранён ✅');
      return showEditMenu(ctx, updated);
    }

    if (session.step === 'edit_character_comment') {
      const user = await ensureEditAnimalAccess(ctx);
      if (!user) return;
      const value = normalizeCommentText(text) || null;
      const animal = await getEditableAnimalOrReply(ctx, session.data.animal_id, user);
      if (!animal) return;
      const updated = await directusPatch('animals', animal.id, { character_comment: value });
      resetSession(ctx.from.id);
      await ctx.reply('Комментарий о характере сохранён ✅');
      return showEditMenu(ctx, updated);
    }

    if (session.step === 'edit_adopt_req') {
      const user = await ensureEditAnimalAccess(ctx);
      if (!user) return;
      const value = /^[-—–]$/.test(text) ? null : text;
      const animal = await getEditableAnimalOrReply(ctx, session.data.animal_id, user);
      if (!animal) return;
      const updated = await directusPatch('animals', animal.id, { adoption_requirements_other: value });
      resetSession(ctx.from.id);
      await ctx.reply('Требования к пристройству сохранены ✅');
      return showEditMenu(ctx, updated);
    }

    if (session.step === 'photo') {
      const url = extractUrl(text);
      if (!url) return ctx.reply('Отправьте фото файлом или пришлите прямую ссылку на изображение.');
      const user = await ensureButtonAccess(ctx, BUTTON_ADD_CAT);
      if (!user) return;
      await ctx.reply('Загружаю главное фото по ссылке...');
      const fileId = await uploadPhotoFromUrl(url);
      return createAnimalFromSession(ctx, user, fileId);
    }

    if (session.step === 'edit_gallery') {
      const user = await ensureEditAnimalAccess(ctx);
      if (!user) return;
      const urls = extractUrls(text);
      if (!urls.length) {
        return ctx.reply('Пришлите фото, ссылки на фото или нажмите «✅ Готово».', galleryDoneKeyboard());
      }
      const source = String(session.data.media_source || '').trim();
      if (!source) {
        return promptMediaSourceSelection(ctx, {
          kind: 'photo',
          urls,
        });
      }
      await ctx.reply(`Загружаю фото: ${urls.length} шт.`);
      let added = 0;
      const errors = [];
      for (const url of urls) {
        try {
          const fileId = await uploadPhotoFromUrl(url);
          const animal = await getEditableAnimalOrReply(ctx, session.data.animal_id, user);
          if (!animal) return;
          await animalMedia.addAnimalPhoto(animal.id, fileId, { source });
          added += 1;
        } catch (error) {
          errors.push(`${url} — ${error.message}`);
        }
      }
      session.data.added_count = Number(session.data.added_count || 0) + added;
      if (errors.length) await ctx.reply(`Часть фото не загрузилась:\n${errors.join('\n')}`);
      return ctx.reply(`Добавлено фото за эту сессию: ${session.data.added_count}.`, galleryDoneKeyboard());
    }

    if (session.step === 'edit_avatar') {
      const url = extractUrl(text);
      if (!url) return ctx.reply('Пришлите одно фото или прямую ссылку на изображение для аватара.');
      const user = await ensureEditAnimalAccess(ctx);
      if (!user) return;
      const animal = await getEditableAnimalOrReply(ctx, session.data.animal_id, user);
      if (!animal) return;
      await ctx.reply('Загружаю аватар...');
      const fileId = await uploadPhotoFromUrl(url);
      await addAnimalAvatar(animal.id, fileId, { source: 'manual_avatar_upload' });
      resetSession(ctx.from.id);
      await ctx.reply('Аватар обновлён ✅');
      return showEditMenu(ctx, animal);
    }
  } catch (error) {
    console.error('TEXT ERROR:', error.response?.data || error.message);
    return ctx.reply(error.message || 'Ошибка. Посмотри логи catbot.');
  }
});

bot.action('welcome_add_cat', async (ctx) => {
  const user = await ensureButtonAccess(ctx, BUTTON_ADD_CAT);
  await safeAnswerCbQuery(ctx);
  if (!user) return;
  return startCreateCat(ctx, user);
});

bot.action('welcome_find_cat', async (ctx) => {
  await safeAnswerCbQuery(ctx);
  return startFindCat(ctx);
});

bot.action('welcome_auth_contact', async (ctx) => {
  await safeAnswerCbQuery(ctx);
  sessions.set(ctx.from.id, { step: 'auth_contact', data: {} });
  return ctx.reply('Если вы сотрудник или куратор, нажмите кнопку ниже, чтобы привязать Telegram к учётной записи.', authMenu());
});

bot.action('welcome_list_cats', async (ctx) => {
  await safeAnswerCbQuery(ctx);
  return showCatsLocationPicker(ctx);
});

bot.action(/^list_cats_location:(.+)$/, async (ctx) => {
  await safeAnswerCbQuery(ctx);
  return showCatsList(ctx, { location: ctx.match[1] });
});

bot.action('gallery_done', async (ctx) => {
  try {
    const session = sessions.get(ctx.from.id);
    if (!session || session.step !== 'edit_gallery') {
      await safeAnswerCbQuery(ctx, 'Сейчас нет загрузки галереи');
      return;
    }
    const user = await ensureEditAnimalAccess(ctx);
    if (!user) return;
    await safeAnswerCbQuery(ctx, 'Готово');
    return finishGalleryEdit(ctx, user);
  } catch (error) {
    console.error('GALLERY DONE ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^sex:(.+)/, async (ctx) => {
  const session = sessions.get(ctx.from.id);
  if (!session) return safeAnswerCbQuery(ctx);
  session.data.sex = ctx.match[1];
  session.step = 'age_months';
  await safeAnswerCbQuery(ctx);
  return ctx.reply('Возраст кошки в месяцах? Например: 3, 12, 18 или 2 года.');
});

bot.action(/^status:(.+)/, async (ctx) => {
  const session = sessions.get(ctx.from.id);
  if (!session) return safeAnswerCbQuery(ctx);
  session.data.status = ctx.match[1];
  session.step = 'location';
  await safeAnswerCbQuery(ctx);
  return ctx.reply('Где находится?', Markup.inlineKeyboard([
    [Markup.button.callback('Проспект Мира', 'location:prospekt_mira')],
    [Markup.button.callback('Новокузнецкая', 'location:novokuznetskaya')],
    [Markup.button.callback('Таганка · Товарищеский переулок', 'location:tovarishcheskiy')],
    [Markup.button.callback('Передержка', 'location:foster')],
    [Markup.button.callback('Ветклиника', 'location:clinic')],
  ]));
});

bot.action(/^location:(.+)/, async (ctx) => {
  const session = sessions.get(ctx.from.id);
  if (!session) return safeAnswerCbQuery(ctx);
  session.data.location = ctx.match[1];
  session.step = 'color';
  await safeAnswerCbQuery(ctx);
  return ctx.reply('Окрас?', Markup.inlineKeyboard([
    [Markup.button.callback('Чёрный', 'color:black')],
    [Markup.button.callback('Белый', 'color:white')],
    [Markup.button.callback('Серый', 'color:gray')],
    [Markup.button.callback('Рыжий', 'color:ginger')],
    [Markup.button.callback('Кремовый', 'color:cream')],
    [Markup.button.callback('Полосатый', 'color:tabby')],
    [Markup.button.callback('Двухцветный', 'color:bicolor')],
    [Markup.button.callback('Трёхцветный', 'color:tricolor')],
    [Markup.button.callback('Черепаховый', 'color:tortie')],
    [Markup.button.callback('Колор-пойнт', 'color:colorpoint')],
    [Markup.button.callback('Другой', 'color:other')],
  ]));
});

bot.action(/^color:(.+)/, async (ctx) => {
  const session = sessions.get(ctx.from.id);
  if (!session) return safeAnswerCbQuery(ctx);
  session.data.color = ctx.match[1];
  await safeAnswerCbQuery(ctx);
  if (ctx.match[1] === 'other') {
    session.step = 'color_note';
    return ctx.reply('Опишите окрас словами. Например: "серо-белая с рыжим пятном".');
  }
  session.data.color_note = null;
  session.step = 'photo';
  return ctx.reply('Теперь отправьте главное фото кошки или ссылку на фото.');
});


bot.action(/^edit_view:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureEditAnimalAccess(ctx);
    if (!user) return;
    const animal = await getEditableAnimalOrReply(ctx, ctx.match[1], user);
    await safeAnswerCbQuery(ctx, 'Просмотр');
    if (!animal) return;
    return ctx.reply(`👀 Просмотр: ${animal.name || 'Кошка'}`, editViewKeyboard(animal));
  } catch (error) {
    console.error('EDIT VIEW MENU ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^edit_texts:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureEditAnimalAccess(ctx);
    if (!user) return;
    const animal = await getEditableAnimalOrReply(ctx, ctx.match[1], user);
    await safeAnswerCbQuery(ctx, 'Тексты');
    if (!animal) return;
    return ctx.reply(`✏️ Тексты: ${animal.name || 'Кошка'}`, editTextsKeyboard(animal));
  } catch (error) {
    console.error('EDIT TEXTS MENU ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^edit_media:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureEditAnimalAccess(ctx);
    if (!user) return;
    const animal = await getEditableAnimalOrReply(ctx, ctx.match[1], user);
    await safeAnswerCbQuery(ctx, 'Медиа');
    if (!animal) return;
    return ctx.reply(`📸 Медиа: ${animal.name || 'Кошка'}`, editMediaKeyboard(animal));
  } catch (error) {
    console.error('EDIT MEDIA MENU ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^manage_media:(photo|video|avatar):([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureEditAnimalAccess(ctx);
    if (!user) return;
    const type = ctx.match[1];
    const animal = await getEditableAnimalOrReply(ctx, ctx.match[2], user);
    await safeAnswerCbQuery(ctx, type === 'video' ? 'Управление видео' : (type === 'avatar' ? 'Просмотр аватара' : 'Управление фото'));
    if (!animal) return;
    return showAnimalMediaManager(ctx, animal, type);
  } catch (error) {
    console.error('MANAGE MEDIA MENU ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^mm:(photo|video|avatar):([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureEditAnimalAccess(ctx);
    if (!user) return;
    const type = ctx.match[1];
    const animal = await getAnimalById(ctx.match[2]);
    if (type === 'avatar') {
      await safeAnswerCbQuery(ctx, 'Удаление аватара отключено');
      if (!animal) return ctx.reply('Кошка не найдена.');
      return ctx.reply(
        `🖼 Аватар для ${animal.name || 'кошки'} удалять нельзя. Его можно посмотреть или заменить.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🖼 Посмотреть аватар', `manage_media:avatar:${animal.id}`)],
          [Markup.button.callback('🖼 Сменить аватар', `edit_avatar:${animal.id}`)],
          [Markup.button.callback('⬅️ Назад к медиа', `edit_media:${animal.id}`)],
        ])
      );
    }
    await safeAnswerCbQuery(ctx, type === 'video' ? 'Удалить видео' : 'Удалить фото');
    if (!animal) return ctx.reply('Кошка не найдена.');
    const rows = await getAnimalMedia(animal.id, type, 50);
    const label = mediaTypeLabel(type);
    const emoji = mediaTypeEmoji(type);
    if (!rows.length) {
      return ctx.reply(
        [`${emoji} Удаление ${label}: ${animal.name || 'Кошка'}`, '', `У этой кошки пока нет ${label}.`].join('\n'),
        Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад к медиа', `edit_media:${animal.id}`)]])
      );
    }
    const keyboardRows = rows.map((row, index) => [
      Markup.button.callback(`🗑 ${index + 1}. ${mediaItemTitle(row, index, type)}`, `dm:${row.id}`),
    ]);
    keyboardRows.push([Markup.button.callback('⬅️ Назад к медиа', `edit_media:${animal.id}`)]);
    return ctx.reply(
      [`${emoji} Удаление ${label}: ${animal.name || 'Кошка'}`, '', 'Выберите, что удалить:'].join('\n'),
      Markup.inlineKeyboard(keyboardRows)
    );
  } catch (error) {
    console.error('MANAGE MEDIA ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^dm:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureEditAnimalAccess(ctx);
    if (!user) return;
    const media = await getAnimalMediaById(ctx.match[1]);
    if (!media) {
      await safeAnswerCbQuery(ctx, 'Медиа уже удалено');
      return ctx.reply('Эта запись уже удалена или не найдена.');
    }

    const animalId = extractFileId(media.animal_id) || media.animal_id;
    const animal = animalId ? await getAnimalById(animalId) : null;
    await safeAnswerCbQuery(ctx, 'Удаление');

    const type = media.type === 'video' ? 'video' : (media.type === 'avatar' ? 'avatar' : 'photo');
    if (type === 'avatar') {
      await safeAnswerCbQuery(ctx, 'Удаление аватара отключено');
      return ctx.reply('🖼 Аватар удалять нельзя. Его можно только заменить.');
    }
    const label = mediaTypeLabel(type);
    const title = mediaItemTitle(media, 0, type);

    return ctx.reply(
      [
        `Удалить ${label}?`,
        '',
        `${mediaTypeEmoji(type)} ${title}`,
        '',
        'Файл в Directus останется, удалится только связь с кошкой.',
      ].join('\n'),
      confirmDeleteMediaKeyboard(media, animalId || animal?.id)
    );
  } catch (error) {
    console.error('DELETE MEDIA ASK ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^noop_main:([^:]+)$/, async (ctx) => {
  const media = await getAnimalMediaById(ctx.match[1]).catch(() => null);
  const label = media?.type === 'video'
    ? 'Это уже первое видео'
    : media?.type === 'avatar'
      ? 'Это текущий аватар'
      : 'Это уже главное фото';
  await safeAnswerCbQuery(ctx, label);
});

bot.action(/^smm:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureEditAnimalAccess(ctx);
    if (!user) return;
    const result = await animalMedia.setAnimalMainPhotoByMediaId(ctx.match[1]);
    if (result?.error === 'not_found') {
      await safeAnswerCbQuery(ctx, 'Фото не найдено');
      return ctx.reply('Это фото уже не найдено.');
    }
    if (result?.error === 'not_photo') {
      await safeAnswerCbQuery(ctx, 'Только для фото');
      return ctx.reply('Главным можно сделать только фото.');
    }
    if (result?.error) {
      await safeAnswerCbQuery(ctx, 'Ошибка');
      return ctx.reply('Не получилось назначить главное фото.');
    }

    const animal = result.animalId ? await getAnimalById(result.animalId) : null;
    await safeAnswerCbQuery(ctx, 'Главное фото обновлено');
    await ctx.reply('⭐ Главное фото обновлено.');
    if (animal) return showAnimalMediaManager(ctx, animal, 'photo');
    return null;
  } catch (error) {
    console.error('SET MAIN PHOTO ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
    return ctx.reply('Не получилось назначить главное фото. Посмотри логи catbot.');
  }
});

bot.action(/^svm:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureEditAnimalAccess(ctx);
    if (!user) return;
    const result = await animalMedia.setAnimalMainVideoByMediaId(ctx.match[1]);
    if (result?.error === 'not_found') {
      await safeAnswerCbQuery(ctx, 'Видео не найдено');
      return ctx.reply('Это видео уже не найдено.');
    }
    if (result?.error === 'not_video') {
      await safeAnswerCbQuery(ctx, 'Только для видео');
      return ctx.reply('Первым можно сделать только видео.');
    }
    if (result?.error) {
      await safeAnswerCbQuery(ctx, 'Ошибка');
      return ctx.reply('Не получилось назначить первое видео.');
    }

    const animal = result.animalId ? await getAnimalById(result.animalId) : null;
    await safeAnswerCbQuery(ctx, 'Первое видео обновлено');
    await ctx.reply('🎬 Первое видео обновлено.');
    if (animal) return showAnimalMediaManager(ctx, animal, 'video');
    return null;
  } catch (error) {
    console.error('SET MAIN VIDEO ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
    return ctx.reply('Не получилось назначить первое видео. Посмотри логи catbot.');
  }
});

bot.action(/^cdm:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureEditAnimalAccess(ctx);
    if (!user) return;
    const media = await getAnimalMediaById(ctx.match[1]);
    if (!media) {
      await safeAnswerCbQuery(ctx, 'Уже удалено');
      return ctx.reply('Эта запись уже удалена.');
    }

    const type = media.type === 'video' ? 'video' : (media.type === 'avatar' ? 'avatar' : 'photo');
    if (type === 'avatar') {
      await safeAnswerCbQuery(ctx, 'Удаление аватара отключено');
      return ctx.reply('🖼 Аватар удалять нельзя. Его можно только заменить.');
    }
    const animalId = extractFileId(media.animal_id) || media.animal_id;
    const animal = animalId ? await getAnimalById(animalId) : null;

    const deletionResult = await animalMedia.deleteAnimalMediaWithOwnedFile(media);
    await safeAnswerCbQuery(ctx, 'Удалено');
    const fileNote = deletionResult.fileDeleted
      ? '\nФайл в Directus тоже удалён.'
      : (deletionResult.fileSkipped ? '\nФайл в Directus оставлен, потому что он используется ещё где-то или не привязан.' : '');
    const deletedLabel = type === 'video' ? 'Видео' : (type === 'avatar' ? 'Аватар' : 'Фото');
    await ctx.reply(`${mediaTypeEmoji(type)} ${deletedLabel} удалено из карточки кошки ✅${fileNote}`);

    if (animal) return showAnimalMediaManager(ctx, animal, type);
    return null;
  } catch (error) {
    console.error('DELETE MEDIA CONFIRM ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
    return ctx.reply('Не получилось удалить медиа. Посмотри логи catbot.');
  }
});

bot.action(/^edit_data:([^:]+)$/, async (ctx) => {
  try {
    const editUser = await ensureEditAnimalAccess(ctx);
    if (!editUser) return;
    const animal = await getAnimalById(ctx.match[1]);
    await safeAnswerCbQuery(ctx, 'Данные');
    if (!animal) return ctx.reply('Кошка не найдена.');
    const user = await getCurrentUser(ctx);
    const canPublish = await canToggleAnimalPublication(user);
    const canDelete = await canDeleteAnimalCards(user);
    return ctx.reply(
      [`⚙️ Данные: ${animal.name || 'Кошка'}`, animalPublicationLabel(animal)].join('\n'),
      editDataKeyboard(animal, { canPublish, canDelete })
    );
  } catch (error) {
    console.error('EDIT DATA MENU ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});


bot.action(/^edit_actions:([^:]+)$/, async (ctx) => {
  try {
    const editUser = await ensureEditAnimalAccess(ctx);
    if (!editUser) return;
    const animal = await getAnimalById(ctx.match[1]);
    await safeAnswerCbQuery(ctx, 'Действия');
    if (!animal) return ctx.reply('Кошка не найдена.');
    const user = await getCurrentUser(ctx);
    const canPublish = await canToggleAnimalPublication(user);
    const canDelete = await canDeleteAnimalCards(user);
    const canChangeStatus = await canChangeAnimalStatus(user);
    return ctx.reply(
      [`⚡ Действия: ${animal.name || 'Кошка'}`, animalPublicationLabel(animal)].join('\n'),
      editActionsKeyboard(animal, { canPublish, canDelete, canChangeStatus })
    );
  } catch (error) {
    console.error('EDIT ACTIONS MENU ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^change_status_menu:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureChangeAnimalStatusAccess(ctx);
    if (!user) return;
    const animal = await getAnimalById(ctx.match[1]);
    await safeAnswerCbQuery(ctx, 'Смена статуса');
    if (!animal) return ctx.reply('Кошка не найдена.');
    return ctx.reply(
      [`🔄 Смена статуса: ${animal.name || 'Кошка'}`, `Сейчас: ${formatStatus(animal.status)}`, '', 'Выберите новый статус:'].join('\n'),
      changeAnimalStatusKeyboard(animal)
    );
  } catch (error) {
    console.error('CHANGE STATUS MENU ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^set_animal_status:([^:]+):([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureChangeAnimalStatusAccess(ctx);
    if (!user) return;
    const animalId = ctx.match[1];
    const requestedStatus = ctx.match[2];
    const nextStatus = Object.entries(MANUAL_ANIMAL_STATUS_CALLBACK_CODES)
      .find(([, code]) => code === requestedStatus)?.[0] || requestedStatus;
    const allowedStatuses = new Set(MANUAL_ANIMAL_STATUS_OPTIONS.map((item) => item.value));
    if (!allowedStatuses.has(nextStatus)) {
    await safeAnswerCbQuery(ctx, 'Неизвестный статус', { show_alert: true });
      return;
    }

    const animal = await getAnimalById(animalId);
    if (!animal) {
      await safeAnswerCbQuery(ctx, 'Кошка не найдена');
      return;
    }

    if (animal.status === nextStatus) {
      await safeAnswerCbQuery(ctx, 'Статус уже выбран');
      return ctx.reply(
        [`🔄 Смена статуса: ${animal.name || 'Кошка'}`, `Сейчас: ${formatStatus(animal.status)}`].join('\n'),
        changeAnimalStatusKeyboard(animal)
      );
    }

    const updated = await directusPatch('animals', animalId, { status: nextStatus });
    await logAnimalStatusChange({
      animalId,
      oldStatus: animal.status || null,
      newStatus: nextStatus,
      user,
      source: 'telegram_status_action',
    });
    await safeAnswerCbQuery(ctx, `Статус: ${formatStatus(nextStatus)}`);
    return showEditMenu(ctx, updated);
  } catch (error) {
    console.error('SET ANIMAL STATUS ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
    return ctx.reply('Не получилось изменить статус кошки. Посмотри логи catbot.');
  }
});


bot.action(/^edit_quality:([^:]+)$/, async (ctx) => {
  try {
    const editUser = await ensureEditAnimalAccess(ctx);
    if (!editUser) return;
    const animal = await getAnimalById(ctx.match[1]);
    await safeAnswerCbQuery(ctx, 'Качество');
    if (!animal) return ctx.reply('Кошка не найдена.');
    return ctx.reply(
      [
        '🧪 Качество каталога',
        '',
        'Проверки помогут быстро найти карточки, которым не хватает медиа или модерации.',
      ].join('\n'),
      editQualityKeyboard(animal)
    );
  } catch (error) {
    console.error('EDIT QUALITY MENU ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^quality_video:([^:]+)$/, async (ctx) => {
  try {
    const editUser = await ensureEditAnimalAccess(ctx);
    if (!editUser) return;
    const sourceAnimalId = ctx.match[1];
    await safeAnswerCbQuery(ctx, 'Проверяю видео');
    const items = await getQualityVideoIssues();
    const lines = [
      `🎥 Кошки без видео или с 1 видео: ${items.length}`,
      '',
      ...(items.slice(0, 25).map((animal, index) => `${index + 1}. ${animal.name || 'Кошка'} — видео: ${animal.media_counts.video}, фото: ${animal.media_counts.photo}, ${animal.published === true ? 'на сайте' : 'не на сайте'}`)),
    ];
    if (items.length > 25) lines.push('', `Показаны первые 25 из ${items.length}.`);
    if (!items.length) lines.push('Таких карточек нет — красота.');
    return ctx.reply(lines.join('\n'), qualityAnimalListKeyboard(items, sourceAnimalId));
  } catch (error) {
    console.error('QUALITY VIDEO ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^quality_photos:([^:]+)$/, async (ctx) => {
  try {
    const editUser = await ensureEditAnimalAccess(ctx);
    if (!editUser) return;
    const sourceAnimalId = ctx.match[1];
    await safeAnswerCbQuery(ctx, 'Проверяю фото');
    const items = await getQualityPhotoIssues();
    const lines = [
      `📸 Кошки с малым числом фото (<4): ${items.length}`,
      '',
      ...(items.slice(0, 25).map((animal, index) => `${index + 1}. ${animal.name || 'Кошка'} — фото: ${animal.media_counts.photo}, видео: ${animal.media_counts.video}, ${animal.published === true ? 'на сайте' : 'не на сайте'}`)),
    ];
    if (items.length > 25) lines.push('', `Показаны первые 25 из ${items.length}.`);
    if (!items.length) lines.push('Таких карточек нет — красота.');
    return ctx.reply(lines.join('\n'), qualityAnimalListKeyboard(items, sourceAnimalId));
  } catch (error) {
    console.error('QUALITY PHOTOS ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^quality_reviews:([^:]+)$/, async (ctx) => {
  try {
    const editUser = await ensureEditAnimalAccess(ctx);
    if (!editUser) return;
    const sourceAnimalId = ctx.match[1];
    await safeAnswerCbQuery(ctx, 'Свежие отзывы');
    const reviews = await getFreshPendingReviews(20);
    const lines = [
      `💬 Свежие отзывы на модерации: ${reviews.length}`,
      '',
      ...(reviews.map((review, index) => `${index + 1}. ${review.animal?.name || 'Кошка'} — ${review.reviewer_name || 'Гость'}\n${qualityReviewExcerpt(review.review_text)}`)),
    ];
    if (!reviews.length) lines.push('Новых отзывов на модерации нет.');
    return ctx.reply(lines.join('\n\n'), qualityReviewKeyboard(reviews, sourceAnimalId));
  } catch (error) {
    console.error('QUALITY REVIEWS ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^toggle_publish:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensurePublishAnimalAccess(ctx);
    if (!user) return;

    const animalId = ctx.match[1];
    const animal = await getAnimalById(animalId);
    if (!animal) {
      await safeAnswerCbQuery(ctx, 'Кошка не найдена');
      return ctx.reply('Кошка не найдена.');
    }

    const nextPublished = animal.published !== true;
    const updated = await directusPatch('animals', animalId, { published: nextPublished });
    await logAnimalPublicationChange({
      animalId,
      oldPublished: animal.published === true,
      newPublished: nextPublished,
      user,
      source: 'telegram_publish_action',
    });
    const canPublish = await canToggleAnimalPublication(user);
    const canDelete = await canDeleteAnimalCards(user);

    await safeAnswerCbQuery(ctx, nextPublished ? 'Кошка опубликована' : 'Публикация снята');

    const text = [`⚡ Действия: ${updated.name || 'Кошка'}`, animalPublicationLabel(updated)].join('\n');
    const keyboard = editActionsKeyboard(updated, { canPublish, canDelete });
    try {
      return ctx.editMessageText(text, keyboard);
    } catch (_) {
      return ctx.reply(text, keyboard);
    }
  } catch (error) {
    console.error('TOGGLE PUBLISH ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
    return ctx.reply('Не получилось изменить публикацию. Посмотри логи catbot.');
  }
});

bot.action(/^toggle_publish_menu:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensurePublishAnimalAccess(ctx);
    if (!user) return;

    const animalId = ctx.match[1];
    const animal = await getAnimalById(animalId);
    if (!animal) {
      await safeAnswerCbQuery(ctx, 'Кошка не найдена');
      return ctx.reply('Кошка не найдена.');
    }

    const nextPublished = animal.published !== true;
    const updated = await directusPatch('animals', animalId, { published: nextPublished });
    await logAnimalPublicationChange({
      animalId,
      oldPublished: animal.published === true,
      newPublished: nextPublished,
      user,
      source: 'telegram_publish_menu',
    });
    await safeAnswerCbQuery(ctx, nextPublished ? 'Кошка опубликована' : 'Публикация снята');

    const text = [`📌 Работаем с кошкой: ${updated.name || 'Кошка'}`, '', animalPublicationLabel(updated), '', 'Что редактируем?'].join('\n');
    const keyboard = editMenuKeyboard(updated);
    try {
      return ctx.editMessageText(text, keyboard);
    } catch (_) {
      return ctx.reply(text, keyboard);
    }
  } catch (error) {
    console.error('TOGGLE PUBLISH MENU ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
    return ctx.reply('Не получилось изменить публикацию. Посмотри логи catbot.');
  }
});

bot.action(/^cancel_delete_cat:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureDeleteAnimalAccess(ctx);
    if (!user) return;

    const animal = await getAnimalById(ctx.match[1]);
    await safeAnswerCbQuery(ctx, 'Удаление отменено');
    if (!animal) return ctx.reply('Удаление отменено. Кошка уже не найдена.');

    const canPublish = await canToggleAnimalPublication(user);
    const canDelete = await canDeleteAnimalCards(user);
    const text = [`⚡ Действия: ${animal.name || 'Кошка'}`, animalPublicationLabel(animal)].join('\n');
    const keyboard = editActionsKeyboard(animal, { canPublish, canDelete });
    try {
      return ctx.editMessageText(text, keyboard);
    } catch (_) {
      return ctx.reply(text, keyboard);
    }
  } catch (error) {
    console.error('DELETE CAT CANCEL ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});
bot.action(/^confirm_delete_cat:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureDeleteAnimalAccess(ctx);
    if (!user) return;

    const animalId = ctx.match[1];
    const animal = await getAnimalById(animalId);
    if (!animal) {
      await safeAnswerCbQuery(ctx, 'Кошка уже не найдена');
      return ctx.reply('Кошка уже не найдена.');
    }

    await safeAnswerCbQuery(ctx, 'Удаляю');
    try {
      if (animal.published === true) await directusPatch('animals', animalId, { published: false });
      const blockers = await getAnimalDeleteBlockers(animalId);
      if (blockers.length) {
        return ctx.reply(
          [
            `Кошку «${animal.name || 'Кошка'}» пока нельзя удалить полностью.`,
            '',
            'Я снял(а) её с публикации.',
            'Связанные данные, которые нужно разобрать перед удалением:',
            ...blockers.map((item) => `• ${item}`),
            '',
            'Файлы не трогала, чтобы карточка не осталась без медиа при неудалённой записи.',
          ].join('\n')
        );
      }
      const mediaCleanup = await animalMedia.deleteAnimalMediaAndOwnedFiles(animalId);
      await deleteAnimal(animalId);
      if (String(user.current_animal_id || '') === String(animalId)) {
        try { await clearCurrentAnimalAndUnpin(ctx, user); } catch (_) {}
      }
      const cleanupLines = [
        `Медиа-связей удалено: ${mediaCleanup.mediaDeleted}`,
        `Файлов удалено: ${mediaCleanup.filesDeleted}`,
      ];
      if (mediaCleanup.filesSkipped) cleanupLines.push(`Файлов оставлено, потому что они используются ещё где-то: ${mediaCleanup.filesSkipped}`);
      if (mediaCleanup.fileErrors.length) cleanupLines.push(`Файлов не удалось удалить: ${mediaCleanup.fileErrors.length}`);
      return ctx.reply(
        [`🗑 Кошка «${animal.name || 'Кошка'}» удалена ✅`, '', ...cleanupLines].join('\n'),
        await mainMenu(user)
      );
    } catch (deleteError) {
      try { await directusPatch('animals', animalId, { published: false }); } catch (_) {}
      console.error('DELETE CAT ERROR:', deleteError.response?.data || deleteError.message);
      return ctx.reply(
        [
          `Не получилось удалить кошку «${animal.name || 'Кошка'}».`,
          '',
          'Я снял(а) её с публикации, если это было возможно.',
          'Чаще всего удаление блокируют связанные записи: донаты, отзывы или нужды.',
          'Файлы удаляются только после предварительной проверки блокирующих связей.',
          'Посмотри логи catbot и Directus — там будет точная причина.',
        ].join('\n')
      );
    }
  } catch (error) {
    console.error('CONFIRM DELETE CAT ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
    return ctx.reply('Не получилось удалить кошку. Посмотри логи catbot.');
  }
});

bot.action(/^edit_short:([^:]+)$/, async (ctx) => {
  const user = await ensureEditAnimalAccess(ctx);
  if (!user) return;
  sessions.set(ctx.from.id, { step: 'edit_short', data: { animal_id: ctx.match[1] } });
  await safeAnswerCbQuery(ctx);
  return ctx.reply('Отправьте короткое описание для карточки.');
});

bot.action(/^edit_age:([^:]+)$/, async (ctx) => {
  const user = await ensureEditAnimalAccess(ctx);
  if (!user) return;
  sessions.set(ctx.from.id, { step: 'edit_age', data: { animal_id: ctx.match[1] } });
  await safeAnswerCbQuery(ctx, 'Возраст');
  return ctx.reply('Напишите возраст в месяцах. Например: 3, 12, 18 или 2 года.');
});

bot.action(/^edit_story:([^:]+)$/, async (ctx) => {
  const user = await ensureEditAnimalAccess(ctx);
  if (!user) return;
  sessions.set(ctx.from.id, { step: 'edit_story', data: { animal_id: ctx.match[1] } });
  await safeAnswerCbQuery(ctx);
  return ctx.reply('Отправьте длинную историю кошки.');
});

bot.action(/^edit_health_comment:([^:]+)$/, async (ctx) => {
  const user = await ensureEditAnimalAccess(ctx);
  if (!user) return;
  sessions.set(ctx.from.id, { step: 'edit_health_comment', data: { animal_id: ctx.match[1] } });
  await safeAnswerCbQuery(ctx);
  return ctx.reply('Напишите комментарий о здоровье. Если комментария нет — отправьте тире: -');
});

bot.action(/^edit_character_comment:([^:]+)$/, async (ctx) => {
  const user = await ensureEditAnimalAccess(ctx);
  if (!user) return;
  sessions.set(ctx.from.id, { step: 'edit_character_comment', data: { animal_id: ctx.match[1] } });
  await safeAnswerCbQuery(ctx);
  return ctx.reply('Напишите комментарий о характере. Если комментария нет — отправьте тире: -');
});

bot.action(/^edit_adopt_req:([^:]+)$/, async (ctx) => {
  const user = await ensureEditAnimalAccess(ctx);
  if (!user) return;
  sessions.set(ctx.from.id, { step: 'edit_adopt_req', data: { animal_id: ctx.match[1] } });
  await safeAnswerCbQuery(ctx);
  return ctx.reply('Напишите другие требования к пристройству. Если требований нет — отправьте тире: -');
});

bot.action(/^edit_needs:([^:]+)$/, async (ctx) => {
  try {
    await safeAnswerCbQuery(ctx);
    const user = await ensureNeedsAccess(ctx);
    if (!user) return;
    const animal = await getAnimalById(ctx.match[1]);
    if (!animal) return ctx.reply('Кошка не найдена.');
    return showAnimalNeedsManager(ctx, animal);
  } catch (error) {
    console.error('EDIT NEEDS ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^add_need:([^:]+)$/, async (ctx) => {
  try {
    await safeAnswerCbQuery(ctx);
    const user = await ensureNeedsAccess(ctx);
    if (!user) return;
    const animal = await getAnimalById(ctx.match[1]);
    if (!animal) return ctx.reply('Кошка не найдена.');
    sessions.set(ctx.from.id, { step: 'add_need', data: { animal_id: animal.id } });
    return ctx.reply([
      `🙏 Новая нужда для ${animal.name || 'кошки'}`,
      '',
      'Напишите название нужды.',
      'Можно сразу добавить ссылку в том же сообщении.',
      '',
      'Пример: Корм Gastrointestinal https://example.com',
    ].join('\n'));
  } catch (error) {
    console.error('ADD NEED ACTION ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^close_need:([^:]+)$/, async (ctx) => {
  try {
    await safeAnswerCbQuery(ctx, 'Закрываю');
    const user = await ensureNeedsAccess(ctx);
    if (!user) return;

    const needId = ctx.match[1];
    const animalId = await getAnimalIdByNeedId(needId);
    if (!animalId) return ctx.reply('Не нашёл кошку для этой нужды.');

    const animal = await getAnimalById(animalId);
    if (!animal) return ctx.reply('Кошка не найдена.');

    await deactivateAnimalNeed(needId);
    await ctx.reply('Нужда закрыта ✅');
    return showAnimalNeedsManager(ctx, animal);
  } catch (error) {
    console.error('CLOSE NEED ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^edit_gallery:([^:]+)$/, async (ctx) => {
  const user = await ensureEditAnimalAccess(ctx);
  if (!user) return;
  const animal = await getEditableAnimalOrReply(ctx, ctx.match[1], user);
  await safeAnswerCbQuery(ctx);
  if (!animal) return;
  return ctx.reply(`Выберите тип медиа для фото: ${animal.name}`, mediaSourceStartKeyboard('photo', animal.id));
});

bot.action(/^edit_traits:([^:]+)$/, async (ctx) => {
  const user = await ensureEditAnimalAccess(ctx);
  if (!user) return;
  const animal = await getEditableAnimalOrReply(ctx, ctx.match[1], user);
  await safeAnswerCbQuery(ctx);
  if (!animal) return;
  return showAnimalTraitsEditor(ctx, animal);
});

bot.action(/^tb:([^:]+):([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureEditAnimalAccess(ctx);
    if (!user) return;
    const animalId = ctx.match[1];
    const field = ctx.match[2];
    if (!Object.prototype.hasOwnProperty.call(BOOLEAN_FIELDS, field)) {
      await safeAnswerCbQuery(ctx, 'Неизвестное поле');
      return;
    }
    const animal = await getEditableAnimalOrReply(ctx, animalId, user);
    if (!animal) {
      return;
    }
    const nextValue = nextBoolValue(animal[field]);
    const updated = await directusPatch('animals', animalId, { [field]: nextValue });
    await safeAnswerCbQuery(ctx, `${BOOLEAN_FIELDS[field]}: ${boolLabel(nextValue)}`);
    try {
      await ctx.editMessageText(animalEditText(updated), boolEditKeyboard(updated));
    } catch (_) {
      await ctx.reply(animalEditText(updated), boolEditKeyboard(updated));
    }
  } catch (error) {
    console.error('TOGGLE BOOL ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^open_cat:([^:]+)$/, async (ctx) => {
  const user = await getCurrentUser(ctx);
  const accessUser = user || guestUser();
  const animal = await getAnimalForCatalogUser(ctx.match[1], accessUser);
  await safeAnswerCbQuery(ctx);
  if (!animal) return ctx.reply('Кошка не найдена.');

  if (user && await canEditSpecificAnimal(user, animal)) return showEditMenu(ctx, animal);
  if (await canViewAnimals(accessUser)) return sendAnimalTextCard(ctx, animal, { showDonations: Boolean(user) });

  return ctx.reply('У вас нет прав на просмотр кошек.');
});

bot.action(/^gp:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureViewAnimalsAccess(ctx);
    if (!user) return;
    await safeAnswerCbQuery(ctx, 'Фото');
    const animal = await getAnimalForCatalogUser(ctx.match[1], user);
    if (!animal) return ctx.reply('Кошка не найдена.');
    return animalMedia.sendAnimalPhotos(ctx, animal);
  } catch (error) {
    console.error('GROUP PHOTO BUTTON ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^gv:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureViewAnimalsAccess(ctx);
    if (!user) return;
    await safeAnswerCbQuery(ctx, 'Видео');
    const animal = await getAnimalForCatalogUser(ctx.match[1], user);
    if (!animal) return ctx.reply('Кошка не найдена.');
    return animalMedia.sendAnimalVideos(ctx, animal);
  } catch (error) {
    console.error('GROUP VIDEO BUTTON ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^gs:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureViewAnimalsAccess(ctx);
    if (!user) return;
    await safeAnswerCbQuery(ctx, 'История');
    const animal = await getAnimalForCatalogUser(ctx.match[1], user);
    if (!animal) return ctx.reply('Кошка не найдена.');
    return sendAnimalStory(ctx, animal);
  } catch (error) {
    console.error('GROUP STORY BUTTON ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^gvr:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureViewAnimalsAccess(ctx);
    if (!user) return;
    await safeAnswerCbQuery(ctx, 'Отзывы');
    const animal = await getAnimalForCatalogUser(ctx.match[1], user);
    if (!animal) return ctx.reply('Кошка не найдена.');
    return animalReviews.sendReviews(ctx, animal);
  } catch (error) {
    console.error('GROUP REVIEWS BUTTON ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^share_cat:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureViewAnimalsAccess(ctx);
    if (!user) return;
    await safeAnswerCbQuery(ctx, 'Поделиться');
    const animal = await getAnimalForCatalogUser(ctx.match[1], user);
    if (!animal) return ctx.reply('Кошка не найдена.');
    return showAnimalShareInvite(ctx, animal);
  } catch (error) {
    console.error('SHARE CAT ERROR:', error.response?.data || error.message);
    return ctx.reply('Не получилось создать приглашение. Проверьте настройку animal_share_invites.');
  }
});

bot.action(/^share_public:([^:]+)$/, async (ctx) => {
  try {
    if (!SHARE_INVITES_ENABLED) return safeAnswerCbQuery(ctx, 'Функция временно отключена', { show_alert: true });
    const user = await ensureViewAnimalsAccess(ctx);
    if (!user) return;
    const animal = await getAnimalForCatalogUser(ctx.match[1], user);
    if (!animal) return safeAnswerCbQuery(ctx, 'Кошка не найдена', { show_alert: true });
    const prompt = await buildAnimalSharePrompt(ctx, animal);
    await bot.telegram.sendMessage(ctx.from.id, prompt.text, prompt.keyboard);
    return safeAnswerCbQuery(ctx, 'Отправил ссылку в личный чат');
  } catch (error) {
    console.error('PUBLIC SHARE CAT ERROR:', error.response?.data || error.message);
    const description = error?.response?.description || error?.message || '';
    if (/bot was blocked|chat not found|forbidden/i.test(description)) {
      return safeAnswerCbQuery(ctx, 'Сначала откройте личный чат с ботом и нажмите START', { show_alert: true });
    }
    return safeAnswerCbQuery(ctx, 'Не получилось создать ссылку', { show_alert: true });
  }
});

bot.action(/^gt:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureViewAnimalsAccess(ctx);
    if (!user) return;
    await safeAnswerCbQuery(ctx, 'Анкета');
    const animal = await getAnimalForCatalogUser(ctx.match[1], user);
    if (!animal) return ctx.reply('Кошка не найдена.');
    return sendAnimalTextCard(ctx, animal, { showDonations: !isGuestUser(user) });
  } catch (error) {
    console.error('GROUP TEXT CARD BUTTON ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^ga:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureViewAnimalsAccess(ctx);
    if (!user) return;
    await safeAnswerCbQuery(ctx, 'Красивая анкета');
    const animal = await getAnimalForCatalogUser(ctx.match[1], user);
    if (!animal) return ctx.reply('Кошка не найдена.');
    return sendAnimalCard(ctx, animal, { showDonations: !isGuestUser(user) });
  } catch (error) {
    console.error('GROUP CARD BUTTON ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});


bot.action(/^gd:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureViewAnimalsAccess(ctx);
    if (!user) return;
    await safeAnswerCbQuery(ctx, 'Донаты');
    if (isGuestUser(user)) return ctx.reply('История донатов доступна только сотрудникам фонда.', commandReplyExtra(ctx));
    const animal = await getAnimalForCatalogUser(ctx.match[1], user);
    if (!animal) return ctx.reply('Кошка не найдена.', commandReplyExtra(ctx));
    return sendAnimalDonations(ctx, animal);
  } catch (error) {
    console.error('GROUP DONATIONS BUTTON ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^gm:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureViewAnimalsAccess(ctx);
    if (!user) return;
    const animal = await getAnimalForCatalogUser(ctx.match[1], user);
    if (!animal) {
      await safeAnswerCbQuery(ctx, 'Кошка не найдена');
      return;
    }
    await safeAnswerCbQuery(ctx, 'Меню');
    const keyboard = foundCatKeyboard(animal, { showDonations: !isGuestUser(user) });
    try {
      return ctx.editMessageText([`🐱 Нашёл карточку: ${animal.name}`, '', 'Что показать?'].join('\n'), keyboard);
    } catch (_) {
      return ctx.reply([`🐱 Нашёл карточку: ${animal.name}`, '', 'Что показать?'].join('\n'), keyboard);
    }
  } catch (error) {
    console.error('GROUP MENU BUTTON ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^gh:([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureViewAnimalsAccess(ctx);
    if (!user) return;
    const animal = await getAnimalForCatalogUser(ctx.match[1], user);
    if (!animal) {
      await safeAnswerCbQuery(ctx, 'Кошка не найдена');
      return;
    }
    await safeAnswerCbQuery(ctx, 'Помочь');

    const needs = await getActiveAnimalNeeds(animal.id);
    const text = needs.length
      ? [`Чем помочь ${animal.name}?`, '', 'Активные нужды:', ...needs.slice(0, 8).map((need) => `• ${need.title || 'Нужда'}`)].join('\n')
      : `Как помочь ${animal.name}?`;
    const keyboard = helpCatKeyboard(animal, needs);
    const message = ctx.callbackQuery?.message;
    const sourceContext = sourcePostContextFromCtx(ctx);
    rememberDonationSourceForMessage(message, sourceContext);

    // Если кнопка нажата под фото/медиа, у сообщения нет text.
    // editMessageText для такого сообщения падает с ошибкой:
    // "there is no text in the message to edit".
    // Поэтому редактируем только текстовые сообщения, а под фото отправляем новое.
    if (message?.text) {
      try {
        const edited = await ctx.editMessageText(text, keyboard);
        rememberDonationSourceForMessage(edited?.message_id ? edited : message, sourceContext);
        return edited;
      } catch (editError) {
        console.error('HELP EDIT TEXT FALLBACK:', editError.response?.description || editError.message);
      }
    }

    const sent = await ctx.reply(text, commandReplyExtra(ctx, keyboard));
    rememberDonationSourceForMessage(sent, sourceContext);
    return sent;
  } catch (error) {
    console.error('GROUP HELP BUTTON ERROR:', error.response?.data || error.message);
    try { await safeAnswerCbQuery(ctx, 'Ошибка'); } catch (_) {}
  }
});

bot.action(/^hn:([^:]+)$/, async (ctx) => {
  try {
    const need = await getAnimalNeedById(ctx.match[1]);
    if (!need) {
      await safeAnswerCbQuery(ctx, 'Нужда уже закрыта или не найдена', { show_alert: true });
      return;
    }
    const animalId = extractFileId(need.animal_id) || need.animal_id;
    const user = await ensureViewAnimalsAccess(ctx);
    if (!user) return;
    const animal = await getAnimalForCatalogUser(animalId, user);
    if (!animal) {
      await safeAnswerCbQuery(ctx, 'Кошка не найдена');
      return;
    }

    await safeAnswerCbQuery(ctx, 'Нужда');

    const hasOrderUrl = Boolean(String(need.url || '').trim());
    const text = hasOrderUrl
      ? [
          `🙏 ${animal.name || 'Кошка'}: ${need.title || 'Нужда'}`,
          '',
          'Вы можете заказать это по ссылке с доставкой в ближайший ПВЗ.',
          'После оформления пришлите QR получения в бот поддержки @kotocafe_support_bot.',
          '',
          'Спасибо ❤',
        ].join('\n')
      : [
          `🙏 ${animal.name || 'Кошка'}: ${need.title || 'Нужда'}`,
          '',
          'По этой нужде пока нет ссылки на заказ.',
          'Вы можете помочь деньгами — выберите сумму:',
        ].join('\n');

    const keyboard = hasOrderUrl ? needOrderKeyboard(need) : needDonateAmountsKeyboard(need);
    const sourceContext = sourcePostContextFromCtx(ctx);
    const message = ctx.callbackQuery?.message;

    try {
      const edited = await ctx.editMessageText(text, keyboard);
      rememberDonationSourceForMessage(edited?.message_id ? edited : message, sourceContext);
      return edited;
    } catch (_) {
      const sent = await ctx.reply(text, commandReplyExtra(ctx, keyboard));
      rememberDonationSourceForMessage(sent, sourceContext);
      return sent;
    }
  } catch (error) {
    console.error('NEED HELP ACTION ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^hn_pay:([^:]+)$/, async (ctx) => {
  try {
    const need = await getAnimalNeedById(ctx.match[1]);
    if (!need) {
      await safeAnswerCbQuery(ctx, 'Нужда уже закрыта или не найдена', { show_alert: true });
      return;
    }
    const user = await ensureViewAnimalsAccess(ctx);
    if (!user) return;
    const animalId = extractFileId(need.animal_id) || need.animal_id;
    const animal = await getAnimalForCatalogUser(animalId, user);
    if (!animal) {
      await safeAnswerCbQuery(ctx, 'Кошка не найдена');
      return;
    }
    await safeAnswerCbQuery(ctx, 'Помочь деньгами');
    const text = [
      `🙏 ${need.title || 'Нужда'}`,
      '',
      'Выберите сумму помощи:',
    ].join('\n');

    const sourceContext = sourcePostContextFromCtx(ctx);
    const message = ctx.callbackQuery?.message;
    try {
      const edited = await ctx.editMessageText(text, needDonateAmountsKeyboard(need));
      rememberDonationSourceForMessage(edited?.message_id ? edited : message, sourceContext);
      return edited;
    } catch (_) {
      const sent = await ctx.reply(text, commandReplyExtra(ctx, needDonateAmountsKeyboard(need)));
      rememberDonationSourceForMessage(sent, sourceContext);
      return sent;
    }
  } catch (error) {
    console.error('NEED PAY ACTION ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^hnd:([^:]+):(\d+(?:\.\d{1,2})?)$/, async (ctx) => {
  try {
    const need = await getAnimalNeedById(ctx.match[1]);
    if (!need) {
      await safeAnswerCbQuery(ctx, 'Нужда уже закрыта или не найдена', { show_alert: true });
      return;
    }
    const user = await ensureViewAnimalsAccess(ctx);
    if (!user) return;
    const animalId = extractFileId(need.animal_id) || need.animal_id;
    const animal = await getAnimalForCatalogUser(animalId, user);
    if (!animal) {
      await safeAnswerCbQuery(ctx, 'Кошка не найдена');
      return;
    }

    await safeAnswerCbQuery(ctx, 'Помочь');
    return startPaymentForContext(ctx, animal, ctx.match[2], 'donate', {
      needId: need.id,
      needTitle: need.title || 'Нужда',
    });
  } catch (error) {
    console.error('NEED DONATE AMOUNT ACTION ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^hnd_custom:([^:]+)$/, async (ctx) => {
  try {
    const need = await getAnimalNeedById(ctx.match[1]);
    if (!need) {
      await safeAnswerCbQuery(ctx, 'Нужда уже закрыта или не найдена', { show_alert: true });
      return;
    }
    const user = await ensureViewAnimalsAccess(ctx);
    if (!user) return;
    const animalId = extractFileId(need.animal_id) || need.animal_id;
    const animal = await getAnimalForCatalogUser(animalId, user);
    if (!animal) {
      await safeAnswerCbQuery(ctx, 'Кошка не найдена');
      return;
    }

    if (!isPrivateChat(ctx)) {
      await safeAnswerCbQuery(ctx, ' группе пока выберите готовую сумму. Другая сумма работает в личке бота.', { show_alert: true });
      return;
    }

    sessions.set(ctx.from.id, {
      step: 'donate_custom_amount',
      data: {
        animal_id: animal.id,
        need_id: need.id,
        need_title: need.title || 'Нужда',
      },
    });
    await safeAnswerCbQuery(ctx, 'Другая сумма');
    return ctx.reply(`Напишите сумму помощи для нужды «${need.title || 'Нужда'}» в рублях. Например: 700`);
  } catch (error) {
    console.error('NEED DONATE CUSTOM ACTION ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^hx:([^:]+):([^:]+)$/, async (ctx) => {
  try {
    const kind = ctx.match[1];
    const user = await ensureViewAnimalsAccess(ctx);
    if (!user) return;
    const animal = await getAnimalForCatalogUser(ctx.match[2], user);
    if (!animal) {
      await safeAnswerCbQuery(ctx, 'Кошка не найдена');
      return;
    }

    if (kind === 'feed' || kind === 'donate') {
      await safeAnswerCbQuery(ctx, kind === 'feed' ? 'Дать вкусняшку' : 'Донат');
      const title = kind === 'feed'
        ? `Выберите сумму для вкусняшки для ${animal.name || 'кошки'}:`
        : `Выберите сумму доната для ${animal.name || 'кошки'}:`;
      const sourceContext = sourcePostContextFromCtx(ctx);
      const message = ctx.callbackQuery?.message;
      try {
        const edited = await ctx.editMessageText(title, donateAmountsKeyboard(animal, kind));
        rememberDonationSourceForMessage(edited?.message_id ? edited : message, sourceContext);
        return edited;
      } catch (_) {
        const sent = await ctx.reply(title, donateAmountsKeyboard(animal, kind));
        rememberDonationSourceForMessage(sent, sourceContext);
        return sent;
      }
    }

    if (kind === 'opeka') {
      return safeAnswerCbQuery(ctx, 'Опекунство пока не подключено. Там будут рекуррентные платежи.', { show_alert: true });
    }

    if (kind === 'adopt') {
      return safeAnswerCbQuery(ctx, 'Ссылка «Взять домой» пока не настроена.', { show_alert: true });
    }

    return safeAnswerCbQuery(ctx, 'Действие пока не настроено.', { show_alert: true });
  } catch (error) {
    console.error('HELP ACTION ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^hd:(donate|feed):([^:]+):(\d+(?:\.\d{1,2})?)$/, async (ctx) => {
  try {
    const user = await ensureViewAnimalsAccess(ctx);
    if (!user) return;
    const paymentType = ctx.match[1] === 'feed' ? 'feed' : 'donate';
    const animal = await getAnimalForCatalogUser(ctx.match[2], user);
    if (!animal) {
      await safeAnswerCbQuery(ctx, 'Кошка не найдена');
      return;
    }
    await safeAnswerCbQuery(ctx, paymentType === 'feed' ? 'Дать вкусняшку' : 'Донат');
    return startPaymentForContext(ctx, animal, ctx.match[3], paymentType);
  } catch (error) {
    console.error('DONATE AMOUNT ACTION ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^hd_custom:(donate|feed):([^:]+)$/, async (ctx) => {
  try {
    const user = await ensureViewAnimalsAccess(ctx);
    if (!user) return;
    const paymentType = ctx.match[1] === 'feed' ? 'feed' : 'donate';
    const animal = await getAnimalForCatalogUser(ctx.match[2], user);
    if (!animal) {
      await safeAnswerCbQuery(ctx, 'Кошка не найдена');
      return;
    }

    if (!isPrivateChat(ctx)) {
      await safeAnswerCbQuery(ctx, paymentType === 'feed' ? ' группе пока выберите готовую сумму вкусняшки.' : ' группе напишите команду: донат Имя 700', { show_alert: true });
      return;
    }

    sessions.set(ctx.from.id, { step: 'donate_custom_amount', data: { animal_id: animal.id, payment_type: paymentType } });
    await safeAnswerCbQuery(ctx, 'Другая сумма');
    return ctx.reply(paymentType === 'feed'
      ? `Напишите сумму для вкусняшки для ${animal.name || 'кошки'} в рублях. Например: 700`
      : `Напишите сумму доната для ${animal.name || 'кошки'} в рублях. Например: 700`);
  } catch (error) {
    console.error('DONATE CUSTOM ACTION ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^donation_public_thanks_(yes|no)$/, async (ctx) => {
  try {
    const session = sessions.get(ctx.from.id);
    if (!session || session.step !== 'donation_public_thanks_permission') {
      await safeAnswerCbQuery(ctx, 'Платёж уже не ожидает ответа');
      return;
    }

    const publicThanks = ctx.match[1] === 'yes';
    const animal = await getAnimalById(session.data.animal_id);
    if (!animal) {
      resetSession(ctx.from.id);
      await safeAnswerCbQuery(ctx, 'Кошка не найдена');
      return ctx.reply('Кошка для платежа не найдена. Попробуйте создать платёж заново.');
    }

    const options = {
      needId: session.data.need_id || null,
      needTitle: session.data.need_title || null,
      source: session.data.source || null,
      sourceChatId: session.data.source_chat_id || null,
      sourceMessageId: session.data.source_message_id || null,
      sourceThreadId: session.data.source_thread_id || null,
      publicThanks,
    };
    const amountRub = session.data.amount_rub;
    const paymentType = session.data.payment_type || 'donate';
    resetSession(ctx.from.id);

    await safeAnswerCbQuery(ctx, publicThanks ? 'Спасибо, опубликуем благодарность' : 'Хорошо, без публичной благодарности');
    return sendPrivateDonationPayment(ctx, animal, amountRub, paymentType, options);
  } catch (error) {
    console.error('DONATION THANKS PERMISSION ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
    return ctx.reply(error.message || 'Не получилось создать платёж. Посмотри логи catbot.');
  }
});


bot.action(/^dt(y|n):([^:]+)$/, async (ctx) => {
  try {
    const isYes = ctx.match[1] === 'y';
    const donationId = ctx.match[2];
    const donation = await kotocatsCore.getDonationById(donationId);
    if (!donation) {
      await safeAnswerCbQuery(ctx, 'Донат не найден');
      return;
    }

    const donationOwnerId = donationTelegramUserId(donation) || donationRawRequest(donation).donor_telegram_id || null;
    if (!donationOwnerId || String(donationOwnerId) !== String(ctx.from?.id || '')) {
      await safeAnswerCbQuery(ctx, 'Это не ваш платёж', { show_alert: true });
      return;
    }

    if (donationFlagTrue(donation, 'public_thanks_sent')) {
      await safeAnswerCbQuery(ctx, 'Благодарность уже опубликована');
      return;
    }

    await safeAnswerCbQuery(ctx, isYes ? 'Спасибо, опубликуем' : 'Спасибо, анонимно');

    if (isYes) {
      const raw = donationRawRequest(donation);
      raw.public_thanks = true;
      raw.donor_telegram_id = raw.donor_telegram_id || ctx.from?.id || null;
      raw.donor_first_name = raw.donor_first_name || ctx.from?.first_name || null;
      raw.donor_last_name = raw.donor_last_name || ctx.from?.last_name || null;
      try { await kotocatsCore.patchDonation(donation.id, { raw_request: raw }); } catch (_) {}
      const freshDonation = await kotocatsCore.getDonationById(donation.id).catch(() => null);
      await sendDonationThanks(freshDonation || { ...donation, raw_request: raw });
    } else {
      await sendDonationAnonymousThanks(donation);
    }

    try {
      await ctx.editMessageReplyMarkup(undefined);
    } catch (_) {}
  } catch (error) {
    console.error('DONATION THANKS CONSENT ACTION ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action('finish_work', async (ctx) => {
  try {
    const session = sessions.get(ctx.from.id);
    if (session?.data?.creatingAnimal) resetSession(ctx.from.id);
    const user = await getCurrentUser(ctx);
    if (!user) {
      await safeAnswerCbQuery(ctx, 'Нет доступа');
      return;
    }
    await clearCurrentAnimalAndUnpin(ctx, user);
    await safeAnswerCbQuery(ctx, 'Готово');
    return ctx.reply('Работа с кошкой завершена.', await mainMenu(user));
  } catch (error) {
    console.error('FINISH WORK ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action('cafe_media_exit', async (ctx) => {
  const user = await ensureEditAnimalAccess(ctx);
  if (!user) return;
  resetSession(ctx.from.id);
  await safeAnswerCbQuery(ctx);
  return ctx.reply('\u0412\u044b \u0432\u044b\u0448\u043b\u0438 \u0438\u0437 \u0440\u0430\u0437\u0434\u0435\u043b\u0430 \u00ab\u0416\u0438\u0437\u043d\u044c \u043a\u043e\u0442\u043e\u043a\u0430\u0444\u0435\u00bb.', await mainMenu(user));
});

bot.action('cafe_media_home', async (ctx) => {
  const user = await ensureEditAnimalAccess(ctx);
  if (!user) return;
  await safeAnswerCbQuery(ctx);
  return ctx.reply('\u{1F3E0} \u0416\u0438\u0437\u043d\u044c \u043a\u043e\u0442\u043e\u043a\u0430\u0444\u0435\n\n\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043a\u043e\u0442\u043e\u043a\u0430\u0444\u0435:', cafeMediaHomeKeyboard());
});

bot.action(/^cafe_media:(novokuznetskaya|prospekt_mira)$/, async (ctx) => {
  const user = await ensureEditAnimalAccess(ctx);
  if (!user) return;
  const cafeId = ctx.match[1];
  await safeAnswerCbQuery(ctx);
  return ctx.reply(`рџЏ  Р–РёР·РЅСЊ РєРѕС‚РѕРєР°С„Рµ: ${cafeMediaCafeName(cafeId)}`, cafeMediaKeyboard(cafeId));
});

bot.action(/^cafe_upload:(photo|video):(novokuznetskaya|prospekt_mira)$/, async (ctx) => {
  const user = await ensureEditAnimalAccess(ctx);
  if (!user) return;
  const [, type, cafeId] = ctx.match;
  sessions.set(ctx.from.id, { step: `cafe_media_${type}`, data: { cafe_id: cafeId, added_count: 0 } });
  await safeAnswerCbQuery(ctx);
  return ctx.reply(`рџЏ  ${cafeMediaCafeName(cafeId)}\n\nРћС‚РїСЂР°РІСЊС‚Рµ ${type === 'photo' ? 'С„РѕС‚Рѕ' : 'РІРёРґРµРѕ'} РґР»СЏ РіР°Р»РµСЂРµРё В«Р–РёР·РЅСЊ РєРѕС‚РѕРєР°С„РµВ».`);
});

bot.action(/^cafe_delete:(photo|video):(novokuznetskaya|prospekt_mira)$/, async (ctx) => {
  const user = await ensureCafeEditAccess(ctx);
  if (!user) return;
  const [, type, cafeId] = ctx.match;
  const rows = await getCafeMedia(cafeId, type, 100);
  await safeAnswerCbQuery(ctx);
  if (!rows.length) return ctx.reply(`РЈ ${cafeMediaCafeName(cafeId)} РїРѕРєР° РЅРµС‚ ${type === 'photo' ? 'С„РѕС‚Рѕ' : 'РІРёРґРµРѕ'} РІ РіР°Р»РµСЂРµРµ.`, cafeMediaKeyboard(cafeId));
  return ctx.reply(
    `Р’С‹Р±РµСЂРёС‚Рµ ${type === 'photo' ? 'С„РѕС‚Рѕ' : 'РІРёРґРµРѕ'} РґР»СЏ СѓРґР°Р»РµРЅРёСЏ:`,
    Markup.inlineKeyboard([
      ...rows.map((row, index) => [Markup.button.callback(`рџ—‘ ${index + 1}. ${type === 'photo' ? 'Р¤РѕС‚Рѕ' : 'Р’РёРґРµРѕ'}`, `cafe_delete_item:${row.id}`)]),
      [Markup.button.callback('в—ЂпёЏ РќР°Р·Р°Рґ', `cafe_media:${cafeId}`)],
    ])
  );
});

bot.action(/^cafe_delete_item:([^:]+)$/, async (ctx) => {
  const user = await ensureEditAnimalAccess(ctx);
  if (!user) return;
  const media = await getCafeMediaById(ctx.match[1]);
  await safeAnswerCbQuery(ctx);
  if (!media) return ctx.reply('Р­С‚Р° Р·Р°РїРёСЃСЊ СѓР¶Рµ СѓРґР°Р»РµРЅР°.');
  return ctx.reply(
    `РЈРґР°Р»РёС‚СЊ ${media.type === 'photo' ? 'С„РѕС‚Рѕ' : 'РІРёРґРµРѕ'} РёР· РіР°Р»РµСЂРµРё ${cafeMediaCafeName(media.cafe_id)}?\n\nР¤Р°Р№Р» РІ Directus С‚Р°РєР¶Рµ Р±СѓРґРµС‚ СѓРґР°Р»С‘РЅ, РµСЃР»Рё РѕРЅ Р±РѕР»СЊС€Рµ РЅРёРіРґРµ РЅРµ РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ.`,
    Markup.inlineKeyboard([
      [Markup.button.callback('вњ… Р”Р°, СѓРґР°Р»РёС‚СЊ', `cafe_delete_confirm:${media.id}`)],
      [Markup.button.callback('в†©пёЏ РќРµС‚', `cafe_media:${media.cafe_id}`)],
    ])
  );
});

bot.action(/^cafe_delete_confirm:([^:]+)$/, async (ctx) => {
  const user = await ensureEditAnimalAccess(ctx);
  if (!user) return;
  const media = await getCafeMediaById(ctx.match[1]);
  if (!media) { await safeAnswerCbQuery(ctx, 'РЈР¶Рµ СѓРґР°Р»РµРЅРѕ'); return ctx.reply('Р­С‚Р° Р·Р°РїРёСЃСЊ СѓР¶Рµ СѓРґР°Р»РµРЅР°.'); }
  const result = await deleteCafeMediaWithOwnedFile(media);
  await safeAnswerCbQuery(ctx, 'РЈРґР°Р»РµРЅРѕ');
  await ctx.reply(`${media.type === 'photo' ? 'рџ“ё Р¤РѕС‚Рѕ' : 'рџЋҐ Р’РёРґРµРѕ'} СѓРґР°Р»РµРЅРѕ вњ…${result.fileDeleted ? '\nР¤Р°Р№Р» РІ Directus С‚РѕР¶Рµ СѓРґР°Р»С‘РЅ.' : '\nР¤Р°Р№Р» РІ Directus РѕСЃС‚Р°РІР»РµРЅ, РїРѕС‚РѕРјСѓ С‡С‚Рѕ РѕРЅ РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РІ РґСЂСѓРіРѕР№ Р·Р°РїРёСЃРё.'}`);
  return ctx.reply(`рџЏ  Р–РёР·РЅСЊ РєРѕС‚РѕРєР°С„Рµ: ${cafeMediaCafeName(media.cafe_id)}`, cafeMediaKeyboard(media.cafe_id));
});

async function uploadTelegramVideoToCafe(ctx, telegramFile, cafeId) {
  const fileSize = Number(telegramFile?.file_size || 0);
  if (fileSize > 30 * 1024 * 1024) {
    return ctx.reply('\u0412\u0438\u0434\u0435\u043e \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0431\u043e\u043b\u044c\u0448\u043e\u0435 \u0434\u043b\u044f \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438 \u0447\u0435\u0440\u0435\u0437 Telegram Bot API (\u043b\u0438\u043c\u0438\u0442 30 \u041c\u0411).');
  }
  const fileLink = await ctx.telegram.getFileLink(telegramFile.file_id);
  const response = await axios.get(fileLink.href, { responseType: 'stream', timeout: 120000 });
  const originalName = videoFilename(telegramFile, '.mp4');
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cafe-video-'));
  const originalPath = path.join(tempDir, originalName);
  const webPath = path.join(tempDir, originalName.replace(/\.[^.]+$/, '') + '-web.mp4');
  let uploadPath = originalPath;
  let uploadName = originalName;
  let uploadType = response.headers['content-type'] || telegramFile.mime_type || 'video/mp4';

  try {
    await downloadStreamToFile(response.data, originalPath);
    if (VIDEO_TRANSCODE_ENABLED) {
      try {
        await transcodeVideoForWeb(originalPath, webPath);
        const originalSize = (await fs.promises.stat(originalPath)).size;
        const webSize = (await fs.promises.stat(webPath)).size;
        if (webSize > 0 && webSize < originalSize * 1.15) {
          uploadPath = webPath;
          uploadName = originalName.replace(/\.[^.]+$/, '') + '-web.mp4';
          uploadType = 'video/mp4';
          console.log('CAFE VIDEO TRANSCODED:', { originalName, originalSize, webSize });
        } else {
          console.log('CAFE VIDEO TRANSCODE SKIPPED: derived file is not smaller enough', { originalName, originalSize, webSize });
        }
      } catch (error) {
        console.error('CAFE VIDEO TRANSCODE ERROR:', error.message);
      }
    }
    const fileId = await uploadStreamToDirectus(fs.createReadStream(uploadPath), uploadName, uploadType, CAT_VIDEOS_FOLDER_ID);
    await createCafeMedia(cafeId, fileId, 'video', telegramMediaCaption(ctx));
    return ctx.reply('\u{1F3A5} \u0412\u0438\u0434\u0435\u043e \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u043e \u0432 \u0433\u0430\u043b\u0435\u0440\u0435\u044e \u00ab\u0416\u0438\u0437\u043d\u044c \u043a\u043e\u0442\u043e\u043a\u0430\u0444\u0435\u00bb \u2014 ' + cafeMediaCafeName(cafeId) + ' \u2705');
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

bot.on('photo', async (ctx) => {
  try {
    // Фото из каналов и групп (включая автопересылку поста в обсуждения)
    // относятся к публикации, а не к админскому сценарию загрузки карточки.
    if (!isPrivateChat(ctx)) return;
    const session = sessions.get(ctx.from.id);
    if (!session) return ctx.reply('Сначала нажмите «➕ Добавить кошку» и пройдите шаги анкеты.');

    const photos = ctx.message.photo;
    const bestPhoto = photos[photos.length - 1];

    if (session.step === 'cafe_media_photo') {
      const user = await ensureCafeEditAccess(ctx);
      if (!user) return;
      const fileId = await uploadTelegramPhoto(ctx, bestPhoto.file_id);
      await createCafeMedia(session.data.cafe_id, fileId, 'photo', telegramMediaCaption(ctx));
      session.data.added_count = Number(session.data.added_count || 0) + 1;
      sessions.set(ctx.from.id, session);
      return ctx.reply(`рџ“ё Р¤РѕС‚Рѕ РґРѕР±Р°РІР»РµРЅРѕ РІ РіР°Р»РµСЂРµСЋ В«Р–РёР·РЅСЊ РєРѕС‚РѕРєР°С„РµВ» вЂ” ${cafeMediaCafeName(session.data.cafe_id)} вњ…\nР”РѕР±Р°РІР»РµРЅРѕ Р·Р° СЃРµСЃСЃРёСЋ: ${session.data.added_count}.`);
    }

    if (session.step === 'photo') {
      const accessUser = await ensureButtonAccess(ctx, BUTTON_ADD_CAT);
      if (!accessUser) return;
      const fileId = await uploadTelegramPhoto(ctx, bestPhoto.file_id);
      return createAnimalFromSession(ctx, accessUser, fileId);
    }

    if (session.step === 'edit_gallery') {
      const user = await ensureEditAnimalAccess(ctx);
      if (!user) return;
      const source = String(session.data.media_source || '').trim();
      if (!source) {
        return promptMediaSourceSelection(ctx, {
          kind: 'photo',
          telegram_file_id: bestPhoto.file_id,
          caption: telegramMediaCaption(ctx),
        });
      }
      const fileId = await uploadTelegramPhoto(ctx, bestPhoto.file_id);
      await animalMedia.addAnimalPhoto(session.data.animal_id, fileId, {
        caption: telegramMediaCaption(ctx),
        source,
      });
      session.data.added_count = Number(session.data.added_count || 0) + 1;
      sessions.set(ctx.from.id, session);
      return ctx.reply(
        `Фото добавлено (${mediaSourceLabel(source)}). Добавлено фото за эту сессию: ${session.data.added_count}.`,
        galleryDoneKeyboard()
      );
    }

    if (session.step === 'edit_avatar') {
      const user = await ensureEditAnimalAccess(ctx);
      if (!user) return;
      const animal = await getEditableAnimalOrReply(ctx, session.data.animal_id, user);
      if (!animal) return;
      const fileId = await uploadTelegramPhoto(ctx, bestPhoto.file_id);
      await addAnimalAvatar(animal.id, fileId, { source: 'manual_avatar_upload' });
      resetSession(ctx.from.id);
      await ctx.reply('Аватар обновлён ✅');
      return showEditMenu(ctx, animal);
    }

    return ctx.reply(`Сейчас бот ждёт не фото, а шаг: ${session.step}`);
  } catch (error) {
    console.error('PHOTO ERROR:', error.response?.data || error.message);
    return ctx.reply('Не получилось добавить фото. Посмотри ошибку в логах.');
  }
});


bot.action(/^edit_video:([^:]+)$/, async (ctx) => {
  const user = await ensureEditAnimalAccess(ctx);
  if (!user) return;
  const animal = await getAnimalById(ctx.match[1]);
  await safeAnswerCbQuery(ctx);
  if (!animal) return ctx.reply('Кошка не найдена.');
  return ctx.reply(`Выберите тип медиа для видео: ${animal.name}`, mediaSourceStartKeyboard('video', animal.id));
});

bot.action(/^edit_avatar:([^:]+)$/, async (ctx) => {
  const user = await ensureEditAnimalAccess(ctx);
  if (!user) return;
  const animal = await getEditableAnimalOrReply(ctx, ctx.match[1], user);
  await safeAnswerCbQuery(ctx, 'Аватар');
  if (!animal) return;
  return startAvatarEdit(ctx, animal);
});

bot.action('video_done', async (ctx) => {
  try {
    const session = sessions.get(ctx.from.id);
    if (!session || session.step !== 'edit_video') {
      await safeAnswerCbQuery(ctx, 'Сейчас нет загрузки видео');
      return;
    }
    const user = await ensureEditAnimalAccess(ctx);
    if (!user) return;
    const animal = await getAnimalById(session.data.animal_id);
    const count = Number(session.data.added_count || 0);
    resetSession(ctx.from.id);
    await safeAnswerCbQuery(ctx, 'Готово');
    await ctx.reply(`Видео сохранено ✅\nДобавлено: ${count}`);
    return showEditMenu(ctx, animal);
  } catch (error) {
    console.error('VIDEO DONE ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
  }
});

bot.action(/^startsrc:(photo|video):([^:]+):(street|kotocafe|home)$/, async (ctx) => {
  try {
    const kind = ctx.match[1];
    const animalId = ctx.match[2];
    const source = ctx.match[3];
    const user = await ensureEditAnimalAccess(ctx);
    if (!user) return;
    const animal = await getAnimalById(animalId);
    await safeAnswerCbQuery(ctx, `Тип: ${mediaSourceLabel(source)}`);
    if (!animal) return ctx.reply('Кошка не найдена.');

    if (kind === 'photo') {
      return startGalleryEdit(ctx, animal, source);
    }

    sessions.set(ctx.from.id, { step: 'edit_video', data: { animal_id: animal.id, added_count: 0, media_source: source } });
    return ctx.reply(
      [`🎥 Видео: ${animal.name}`, `Тип медиа: ${mediaSourceLabel(source)}`, '', 'Отправьте видео.', 'Когда закончите — нажмите «✅ Готово».'].filter(Boolean).join('\n'),
      Markup.inlineKeyboard([[Markup.button.callback('✅ Готово', 'video_done')]])
    );
  } catch (error) {
    console.error('START MEDIA SOURCE ERROR:', error.response?.data || error.message);
    await safeAnswerCbQuery(ctx, 'Ошибка');
    return ctx.reply('Не получилось выбрать тип медиа. Попробуйте ещё раз.');
  }
});

bot.action(/^msrc:(photo|video):(street|kotocafe|home)$/, async (ctx) => {
  try {
    const kind = ctx.match[1];
    const source = ctx.match[2];
    const pending = getPendingMediaSourceSelection(ctx, kind);
    await safeAnswerCbQuery(ctx, `Тип: ${mediaSourceLabel(source)}`);
    if (!pending) return ctx.reply('Нет ожидающей загрузки. Отправьте фото или видео ещё раз.');
    clearPendingMediaSourceSelection(ctx);

    if (kind === 'photo') {
      const session = sessions.get(ctx.from.id);
      if (!session || session.step !== 'edit_gallery') return ctx.reply('Сейчас загрузка фото не активна.');
      const user = await ensureEditAnimalAccess(ctx);
      if (!user) return;
      if (Array.isArray(pending.urls) && pending.urls.length) {
        await ctx.reply(`Загружаю фото: ${pending.urls.length} шт.`);
        let added = 0;
        const errors = [];
        for (const url of pending.urls) {
          try {
            const fileId = await uploadPhotoFromUrl(url);
            await animalMedia.addAnimalPhoto(session.data.animal_id, fileId, { source });
            added += 1;
          } catch (error) {
            errors.push(`${url} — ${error.message}`);
          }
        }
        session.data.added_count = Number(session.data.added_count || 0) + added;
        sessions.set(ctx.from.id, session);
        if (errors.length) await ctx.reply(`Часть фото не загрузилась:\n${errors.join('\n')}`);
        return ctx.reply(
          `Фото добавлено (${mediaSourceLabel(source)}). Добавлено фото за эту сессию: ${session.data.added_count}.`,
          galleryDoneKeyboard()
        );
      }

      const fileId = await uploadTelegramPhoto(ctx, pending.telegram_file_id);
      await animalMedia.addAnimalPhoto(session.data.animal_id, fileId, {
        caption: pending.caption || null,
        source,
      });
      session.data.added_count = Number(session.data.added_count || 0) + 1;
      sessions.set(ctx.from.id, session);
      return ctx.reply(
        `Фото добавлено (${mediaSourceLabel(source)}). Добавлено фото за эту сессию: ${session.data.added_count}.`,
        galleryDoneKeyboard()
      );
    }

    return uploadTelegramVideoToAnimal(ctx, pending.telegramFile, {
      fallbackExt: pending.fallbackExt || '.mp4',
      source,
    });
  } catch (error) {
    console.error('MEDIA SOURCE SELECT ERROR:', error.response?.data || error.message);
    return ctx.reply('Не получилось сохранить тип медиа. Попробуйте ещё раз.');
  }
});

bot.action(/^msrc_cancel:(photo|video)$/, async (ctx) => {
  clearPendingMediaSourceSelection(ctx);
  await safeAnswerCbQuery(ctx, 'Отменено');
  return ctx.reply('Загрузка отменена. Отправьте фото или видео заново.');
});

function isVideoDocument(document) {
  const mime = String(document?.mime_type || '').toLowerCase();
  const name = String(document?.file_name || '').toLowerCase();
  return mime.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(name);
}

function videoFilename(file, fallbackExt = '.mp4') {
  const original = String(file?.file_name || '').trim();
  if (original && /\.[a-z0-9]{2,5}$/i.test(original)) return original.replace(/[^a-z0-9а-яё._-]+/ig, '-');
  return `cat-video-${Date.now()}${fallbackExt}`;
}

function normalizeMediaCaption(text) {
  const value = String(text || '').trim().replace(/\s+/g, ' ');
  if (!value) return null;
  return value.slice(0, 240);
}

function telegramMediaCaption(ctx) {
  return normalizeMediaCaption(currentMessage(ctx)?.caption || '');
}

function mediaSourceLabel(value) {
  return ANIMAL_MEDIA_SOURCE_OPTIONS.find((item) => item.value === value)?.label || value || 'не указан';
}

function mediaSourceKeyboard(kind) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('улица', `msrc:${kind}:street`)],
    [Markup.button.callback('котокафе', `msrc:${kind}:kotocafe`)],
    [Markup.button.callback('дома', `msrc:${kind}:home`)],
    [Markup.button.callback('❌ Отмена', `msrc_cancel:${kind}`)],
  ]);
}

function mediaSourceStartKeyboard(kind, animalId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('улица', `startsrc:${kind}:${animalId}:street`)],
    [Markup.button.callback('котокафе', `startsrc:${kind}:${animalId}:kotocafe`)],
    [Markup.button.callback('дома', `startsrc:${kind}:${animalId}:home`)],
    [Markup.button.callback('◀️ Назад', `edit_media:${animalId}`)],
  ]);
}

function setPendingMediaSourceSelection(ctx, payload) {
  const session = sessions.get(ctx.from.id);
  if (!session) return null;
  session.data = session.data || {};
  session.data.pending_media_upload = payload;
  sessions.set(ctx.from.id, session);
  return session;
}

function getPendingMediaSourceSelection(ctx, kind) {
  const session = sessions.get(ctx.from.id);
  const pending = session?.data?.pending_media_upload;
  if (!pending || pending.kind !== kind) return null;
  return pending;
}

function clearPendingMediaSourceSelection(ctx) {
  const session = sessions.get(ctx.from.id);
  if (!session?.data?.pending_media_upload) return;
  delete session.data.pending_media_upload;
  sessions.set(ctx.from.id, session);
}

async function promptMediaSourceSelection(ctx, pending) {
  setPendingMediaSourceSelection(ctx, pending);
  const kindLabel = pending.kind === 'video' ? 'видео' : 'фото';
  return ctx.reply(`Укажите тип ${kindLabel}:`, mediaSourceKeyboard(pending.kind));
}

async function uploadTelegramVideoToAnimal(ctx, telegramFile, options = {}) {
  const session = sessions.get(ctx.from.id);
  if (!session || session.step !== 'edit_video') {
    if (isGroupChat(ctx)) return null;
    await ctx.reply('Чтобы добавить видео, откройте кошку и нажмите «🎥 Видео».');
    return null;
  }

  const user = await ensureEditAnimalAccess(ctx);
  if (!user) return null;
  const source = String(options.source || session.data?.media_source || '').trim();
  if (!source) {
    return promptMediaSourceSelection(ctx, {
      kind: 'video',
      telegramFile,
      fallbackExt: options.fallbackExt || '.mp4',
      caption: telegramMediaCaption(ctx),
    });
  }

  const fileSize = Number(telegramFile?.file_size || 0);
  if (fileSize > 30 * 1024 * 1024) {
    await ctx.reply('Видео слишком большое для загрузки через Telegram Bot API. Попробуйте сжать видео или отправить файл до 30 МБ.');
    return null;
  }

  const fileLink = await ctx.telegram.getFileLink(telegramFile.file_id);
  const response = await axios.get(fileLink.href, { responseType: 'stream', timeout: 120000 });
  const contentType = response.headers['content-type'] || telegramFile.mime_type || 'video/mp4';
  const originalName = videoFilename(telegramFile, options.fallbackExt || '.mp4');
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cat-video-'));
  const originalPath = path.join(tempDir, originalName);
  const webPath = path.join(tempDir, originalName.replace(/\.[^.]+$/, '') + '-web.mp4');
  const webmPath = path.join(tempDir, originalName.replace(/\.[^.]+$/, '') + '-web.webm');
  let uploadPath = originalPath;
  let uploadName = originalName;
  let uploadType = contentType;
  let shouldStoreOriginalSeparately = false;
  let webmDirectusFileId = null;

  try {
    await downloadStreamToFile(response.data, originalPath);
    if (VIDEO_TRANSCODE_ENABLED) {
      try {
        await transcodeVideoForWeb(originalPath, webPath);
        const originalSize = (await fs.promises.stat(originalPath)).size;
        const webSize = (await fs.promises.stat(webPath)).size;
        if (webSize > 0 && webSize < originalSize * 1.15) {
          uploadPath = webPath;
          uploadName = originalName.replace(/\.[^.]+$/, '') + '-web.mp4';
          uploadType = 'video/mp4';
          shouldStoreOriginalSeparately = true;
          console.log('VIDEO TRANSCODED:', { originalName, originalSize, webSize });
        } else {
          console.log('VIDEO TRANSCODE SKIPPED: derived file is not smaller enough', { originalName, originalSize, webSize });
        }
      } catch (error) {
        console.error('VIDEO TRANSCODE ERROR:', error.message);
      }
      try {
        await transcodeVideoForWebm(originalPath, webmPath);
        const webmSize = (await fs.promises.stat(webmPath)).size;
        if (webmSize > 0) {
          webmDirectusFileId = await uploadStreamToDirectus(
            fs.createReadStream(webmPath),
            originalName.replace(/\.[^.]+$/, '') + '-web.webm',
            'video/webm',
            CAT_VIDEOS_FOLDER_ID
          );
        }
      } catch (error) {
        console.error('VIDEO WEBM TRANSCODE ERROR:', error.message);
      }
    }
    var originalDirectusFileId = null;
    if (shouldStoreOriginalSeparately) {
      originalDirectusFileId = await uploadStreamToDirectus(
        fs.createReadStream(originalPath),
        originalName,
        contentType,
        CAT_VIDEOS_FOLDER_ID
      );
    }
    var fileId = await uploadStreamToDirectus(
      fs.createReadStream(uploadPath),
      uploadName,
      uploadType,
      CAT_VIDEOS_FOLDER_ID
    );
  } finally {
    await Promise.all([safeUnlink(originalPath), safeUnlink(webPath), safeUnlink(webmPath)]).catch(() => {});
    try { await fs.promises.rmdir(tempDir); } catch (_) {}
  }

  const caption = normalizeMediaCaption(options.caption || telegramMediaCaption(ctx) || '');
  await animalMedia.addAnimalVideo(session.data.animal_id, fileId, {
    caption,
    source,
    original_file_id: originalDirectusFileId || fileId,
    web_file_id: shouldStoreOriginalSeparately ? fileId : null,
    webm_file_id: webmDirectusFileId,
  });
  session.data.added_count = Number(session.data.added_count || 0) + 1;
  return ctx.reply(
    [
      'Видео добавлено ✅',
      `Тип: ${mediaSourceLabel(source)}`,
      caption ? `Подпись: ${caption}` : null,
      `Добавлено видео за эту сессию: ${session.data.added_count}.`,
    ].filter(Boolean).join('\n'),
    Markup.inlineKeyboard([[Markup.button.callback('✅ Готово', 'video_done')]])
  );
}

bot.on('video', async (ctx) => {
  try {
    if (!isPrivateChat(ctx)) return;
    const session = sessions.get(ctx.from.id);
    if (session?.step === 'cafe_media_video') {
      const user = await ensureCafeEditAccess(ctx);
      if (!user) return;
      return uploadTelegramVideoToCafe(ctx, ctx.message.video, session.data.cafe_id);
    }
    return uploadTelegramVideoToAnimal(ctx, ctx.message.video, { fallbackExt: '.mp4' });
  } catch (error) {
    console.error('VIDEO UPLOAD ERROR:', error.response?.data || error.message);
    return ctx.reply('Не получилось добавить видео. Посмотри логи catbot.');
  }
});

bot.on('document', async (ctx) => {
  try {
    if (!isPrivateChat(ctx)) return;
    const document = ctx.message.document;
    const session = sessions.get(ctx.from.id);

    if (!session || session.step !== 'edit_video') {
      if (isGroupChat(ctx)) return;
      return null;
    }

    if (!isVideoDocument(document)) {
      return ctx.reply('Это не похоже на видео. Отправьте видео обычным сообщением или файлом .mp4/.mov/.webm.');
    }

    return uploadTelegramVideoToAnimal(ctx, document, { fallbackExt: path.extname(document.file_name || '') || '.mp4' });
  } catch (error) {
    console.error('VIDEO DOCUMENT UPLOAD ERROR:', error.response?.data || error.message);
    return ctx.reply('Не получилось добавить видео-файл. Посмотри логи catbot.');
  }
});

bot.catch((err) => console.error('BOT ERROR:', err));

// Не вызываем getMe() перед запуском: на VPS этот запрос иногда падает и блокирует старт.
// Для обработки @тега username больше не нужен: бот реагирует на любое @... + слово «фото».
if (!bot.botInfo) {
  bot.botInfo = {
    id: 0,
    is_bot: true,
    first_name: 'cat-bot',
    username: BOT_USERNAME || 'catru_bot',
  };
}



// =========================
// WEBAPP SERVER (MONOLITH)
// =========================
function jsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function cachedJsonResponse(req, res, cacheRecord) {
  const etag = cacheRecord.etag;
  const headers = {
    'Cache-Control': 'public, no-cache',
    ETag: etag,
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, {
    ...headers,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(cacheRecord.json),
  });
  return res.end(cacheRecord.json);
}

function htmlResponseHeaders() {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=0, must-revalidate',
  };
}

function minifyHtml(html) {
  return String(html || '')
    .replace(/<!--(?!\s*\[if\b)[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .trim();
}

function allowedCorsOrigin(origin) {
  const value = String(origin || '').trim();
  if (!value) return '';
  return /^https:\/\/([a-z0-9-]+\.)?kotocafe\.ru$/i.test(value) ? value : '';
}

function applyPublicApiCors(req, headers = {}) {
  return {
    ...headers,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
  };
}

function robotsTxtBody() {
  const sitemapUrl = publicUrl('/sitemap.xml');
  const lines = [
    'User-agent: *',
    'Allow: /',
  ];
  if (sitemapUrl) lines.push(`Sitemap: ${sitemapUrl}`);
  return `${lines.join('\n')}\n`;
}

async function sitemapXmlBody() {
  const urls = [];
  const catalogUrl = buildCatalogWebAppUrl() || publicUrl('/');
  if (catalogUrl) urls.push(catalogUrl);
  const prospektMiraUrl = publicUrl('/1');
  if (prospektMiraUrl) urls.push(prospektMiraUrl);

  const animals = await listAnimals(500, { publicOnly: true });
  for (const animal of animals || []) {
    if (!animal?.id) continue;
    const animalUrl = publicUrl(`/?animal=${encodeURIComponent(animal.id)}`);
    if (animalUrl) urls.push(animalUrl);
  }

  const uniqueUrls = [...new Set(urls)];
  const body = uniqueUrls
    .map((url) => `<url><loc>${escapeTelegramHtml(url)}</loc></url>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
}

function parseWebhookBody(buffer, contentType = '') {
  const text = buffer.toString('utf8').trim();
  if (!text) return {};

  if (String(contentType).includes('application/json')) {
    try { return JSON.parse(text); } catch (_) { return { raw: text }; }
  }

  try {
    const params = new URLSearchParams(text);
    const result = {};
    for (const [key, value] of params.entries()) result[key] = value;
    return Object.keys(result).length ? result : { raw: text };
  } catch (_) {
    return { raw: text };
  }
}

function collectWebhookValues(payload, keys = new Set()) {
  const values = [];
  const wanted = keys.size ? keys : new Set([
    'id', 'payment_id', 'paymentId', 'invoice_id', 'invoiceId', 'order_id', 'orderId',
    'transaction_id', 'transactionId', 'external_id', 'externalId', 'merchant_payment_id',
    'merchantPaymentId', 'merchant_order_id', 'merchantOrderId', 'operation_id', 'operationId',
  ]);

  function walk(value, key = '') {
    if (value === null || value === undefined) return;
    if (typeof value === 'string' || typeof value === 'number') {
      if (wanted.has(key) && String(value).trim()) values.push(String(value).trim());
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item));
      return;
    }
    if (typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value)) walk(childValue, childKey);
    }
  }

  walk(payload);
  return [...new Set(values)];
}

function webhookLooksSuccessful(payload) {
  const successWords = new Set(['success', 'successful', 'paid', 'completed', 'complete', 'approved', 'succeeded']);
  let result = false;

  function walk(value, key = '') {
    if (result || value === null || value === undefined) return;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const k = String(key || '').toLowerCase();
      const v = String(value).trim().toLowerCase();
      if ((k.includes('status') || k.includes('state') || k.includes('result')) && successWords.has(v)) result = true;
      if ((k.includes('paid') || k.includes('success')) && (v === 'true' || v === '1' || v === 'yes')) result = true;
      return;
    }
    if (Array.isArray(value)) return value.forEach((item) => walk(item));
    if (typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value)) walk(childValue, childKey);
    }
  }

  walk(payload);
  return result;
}

function createReplayRequest(originalReq, bodyBuffer) {
  const { Readable } = require('stream');
  const replayReq = Readable.from(bodyBuffer);
  replayReq.method = originalReq.method;
  replayReq.url = originalReq.url;
  replayReq.headers = originalReq.headers;
  replayReq.socket = originalReq.socket;
  replayReq.connection = originalReq.connection;
  return replayReq;
}

async function readRequestBody(req, maxBytes = envPositiveNumber('WEBHOOK_MAX_BODY_BYTES', 1024 * 1024, { min: 1024, max: 10 * 1024 * 1024 })) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      req.destroy();
      throw new Error('webhook body too large');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function readJsonRequestBody(req, maxBytes = 64 * 1024) {
  const buffer = await readRequestBody(req, maxBytes);
  const text = buffer.toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    const error = new Error('invalid json');
    error.statusCode = 400;
    throw error;
  }
}

function donationFieldValues(donation) {
  return [
    donation?.mixplat_payment_id,
    donation?.payment_id,
    donation?.invoice_id,
    donation?.order_id,
    donation?.transaction_id,
    donation?.external_id,
    donation?.merchant_payment_id,
    donation?.merchant_order_id,
    donation?.operation_id,
    donation?.id,
  ].filter((value) => value !== null && value !== undefined && String(value).trim()).map((value) => String(value).trim());
}

async function findDonationForWebhook(payload) {
  const webhookIds = collectWebhookValues(payload);
  const rows = await directusGet('animals_donations', {
    filter: { status: { _eq: 'success' } },
    fields: DONATION_READ_FIELDS,
    sort: '-created_at',
    limit: 20,
  });

  const donations = rows || [];
  if (webhookIds.length) {
    const match = donations.find((donation) => donationFieldValues(donation).some((value) => webhookIds.includes(value)));
    if (match) return match;
  }

  return null;
}

function telegramUserMention(userId, fallbackName) {
  const name = escapeTelegramHtml(fallbackName || 'добрый человек');
  if (!userId) return name;
  return `<a href="tg://user?id=${String(userId).replace(/[^0-9]/g, '')}">${name}</a>`;
}

function donationThanksDonorName(donation) {
  return String(
    donation?.donor_first_name ||
    donation?.donor_name ||
    donation?.donor_username ||
    donation?.donor_telegram_username ||
    donation?.donor ||
    donation?.name ||
    'добрый человек'
  ).replace(/^@/, '').trim();
}

function donationTelegramUserId(donation) {
  return donation?.donor_telegram_id || donation?.telegram_user_id || donation?.telegram_id || donation?.user_id || null;
}

function donationRawRequest(donation) {
  const raw = donation?.raw_request;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (_) { return {}; }
}

function donationPublicThanksAllowed(donation) {
  const raw = donationRawRequest(donation);
  return donation?.public_thanks === true || donation?.public_thanks === 'true' || raw.public_thanks === true || raw.public_thanks === 'true';
}

function donationFlagTrue(donation, field) {
  const raw = donationRawRequest(donation);
  return donation?.[field] === true || donation?.[field] === 'true' || raw[field] === true || raw[field] === 'true';
}

function donationHasOriginalPost(donation) {
  const raw = donationRawRequest(donation);
  const sourceChatId = raw.source_chat_id || donation?.source_chat_id;
  const sourceMessageId = raw.source_message_id || donation?.source_message_id;
  return Boolean(sourceChatId && sourceMessageId);
}

function donationThanksTargetChatId(donation) {
  const raw = donationRawRequest(donation);
  // Благодарим только под конкретным исходным постом, открытым через deep link.
  return raw.source_chat_id || donation?.source_chat_id || null;
}

function donationThanksReplyToMessageId(donation) {
  const raw = donationRawRequest(donation);
  return raw.source_message_id || donation?.source_message_id || raw.reply_to_message_id || donation?.reply_to_message_id || null;
}

function donationThanksThreadId(donation) {
  const raw = donationRawRequest(donation);
  return raw.source_thread_id || raw.thanks_thread_id || donation?.source_thread_id || donation?.thanks_thread_id || donation?.message_thread_id || null;
}

async function markDonationFlag(donationId, field, donation = null) {
  if (!donationId) return;
  const raw = { ...donationRawRequest(donation), [field]: true };
  try {
    await kotocatsCore.patchDonation(donationId, { [field]: true, raw_request: raw });
  } catch (error) {
    try {
      await kotocatsCore.patchDonation(donationId, { raw_request: raw });
    } catch (_) {}
  }
}

async function markDonationThanksSent(donationId, donation = null) {
  try {
    await markDonationFlag(donationId, 'public_thanks_sent', donation);
  } catch (error) {
    // Поле public_thanks_sent может ещё не быть создано в Directus — не считаем это ошибкой запуска.
  }
}


const catFeed = createCatFeedModule({
  bot,
  getAnimalById,
  markDonationFlag,
  donationRawRequest,
  extractFileId,
  escapeTelegramHtml,
  formatRub,
});


async function resolveDonationThanksTarget(targetChatId, replyToMessageId, threadId) {
  const result = {
    chatId: targetChatId,
    threadId: threadId || null,
    externalReplyChatId: null,
    wasLinkedChannel: false,
  };

  try {
    const chat = await bot.telegram.getChat(targetChatId);
    // Если источник — канал с подключённой группой обсуждений, комментарий надо
    // отправлять именно в linked_chat_id. При этом reply_parameters.chat_id
    // указывает на исходный пост канала.
    if (chat?.type === 'channel' && chat?.linked_chat_id) {
      result.chatId = chat.linked_chat_id;
      result.externalReplyChatId = targetChatId;
      result.wasLinkedChannel = true;
      if (!result.threadId && replyToMessageId) result.threadId = replyToMessageId;
    }
  } catch (error) {
    console.error('DONATION THANKS GET CHAT ERROR:', error.response?.data || error.message);
  }

  return result;
}

async function sendDonationThanks(donation) {
  if (!AUTO_DONATION_THANKS || !donation) return false;
  if (!donationHasOriginalPost(donation)) return false;
  // Публичная благодарность только после явного согласия пользователя.
  if (!donationPublicThanksAllowed(donation)) return false;
  if (donationFlagTrue(donation, 'public_thanks_sent')) return false;

  const donationId = donation.id || donation.payment_id || donation.order_id;
  if (donationId && thankedDonationIds.has(String(donationId))) return false;

  const targetChatId = donationThanksTargetChatId(donation);
  if (!targetChatId) return false;

  const animalId = extractFileId(donation.animal_id) || donation.animal_id || donation.animal;
  const animal = animalId ? await getAnimalById(animalId) : null;
  const animalName = animal?.name || donation?.animal_name || 'кошка';
  const amount = donationAmountText(donation);
  const donorId = donationTelegramUserId(donation);
  const donorName = donationThanksDonorName(donation);
  const mention = telegramUserMention(donorId, donorName);

  const text = [
    `❤️ Спасибо за вашу помощь, ${mention}!`,
    '',
    `${escapeTelegramHtml(animalName)} получил${formatSex(animal?.sex) === 'кошка' ? 'а' : ''} ещё ${escapeTelegramHtml(amount)} ₽.`,
  ].join('\n');

  const threadId = donationThanksThreadId(donation);
  const replyToMessageId = donationThanksReplyToMessageId(donation);
  const target = await resolveDonationThanksTarget(targetChatId, replyToMessageId, threadId);
  const extra = { parse_mode: 'HTML' };

  // Для linked discussion group / комментариев к посту важно не просто отправить
  // сообщение в чат, а именно привязать его к исходному сообщению/треду.
  if (target.threadId) extra.message_thread_id = Number(target.threadId);
  if (replyToMessageId) {
    extra.reply_parameters = {
      message_id: Number(replyToMessageId),
      allow_sending_without_reply: false,
    };
    if (target.externalReplyChatId) extra.reply_parameters.chat_id = target.externalReplyChatId;
    // Старый fallback оставляем только когда отвечаем внутри того же чата.
    if (!target.externalReplyChatId) {
      extra.reply_to_message_id = Number(replyToMessageId);
      extra.allow_sending_without_reply = false;
    }
  }

  console.log('DONATION THANKS TARGET:', {
    originalTargetChatId: targetChatId,
    sendChatId: target.chatId,
    linkedChannel: target.wasLinkedChannel,
    threadId: target.threadId || null,
    externalReplyChatId: target.externalReplyChatId || null,
    replyToMessageId: replyToMessageId || null,
    donationId: donation?.id || null,
  });

  try {
    await bot.telegram.sendMessage(target.chatId, text, extra);
    if (donationId) thankedDonationIds.add(String(donationId));
    await markDonationThanksSent(donation?.id, donation);
    return true;
  } catch (error) {
    console.error('DONATION THANKS SEND ERROR:', error.response?.data || error.message);
    return false;
  }
}


function donationShouldAskPublicThanks(donation) {
  const raw = donationRawRequest(donation);
  if (!donationHasOriginalPost(donation)) return false;
  if (donationPublicThanksAllowed(donation)) return false;
  if (donationFlagTrue(donation, 'public_thanks_sent')) return false;
  if (donationFlagTrue(donation, 'public_thanks_prompt_sent')) return false;
  return raw.ask_public_thanks_after_payment === true || raw.ask_public_thanks_after_payment === 'true';
}

async function markDonationThanksPromptSent(donationId, donation = null) {
  try {
    await markDonationFlag(donationId, 'public_thanks_prompt_sent', donation);
  } catch (_) {}
}

function donationThanksConsentKeyboard(donationId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Да, можно', `dty:${donationId}`)],
    [Markup.button.callback('🙈 Нет, анонимно', `dtn:${donationId}`)],
  ]);
}

async function sendDonationThanksConsentPrompt(donation) {
  if (!donationShouldAskPublicThanks(donation)) return false;
  const targetChatId = donationThanksTargetChatId(donation);
  if (!targetChatId) return false;

  const animalId = extractFileId(donation.animal_id) || donation.animal_id || donation.animal;
  const animal = animalId ? await getAnimalById(animalId) : null;
  const animalName = animal?.name || donation?.animal_name || 'кошке';
  const replyToMessageId = donationThanksReplyToMessageId(donation);
  const threadId = donationThanksThreadId(donation);
  const target = await resolveDonationThanksTarget(targetChatId, replyToMessageId, threadId);

  const text = [
    `❤️ Спасибо за помощь ${escapeTelegramHtml(animalName)}!`,
    '',
    `Можно публично поблагодарить вас в комментариях под этим постом?`,
    'Имя будет взято из вашего Telegram-профиля.',
  ].join('\n');

  const extra = { parse_mode: 'HTML', reply_markup: donationThanksConsentKeyboard(donation.id).reply_markup };
  if (target.threadId) extra.message_thread_id = Number(target.threadId);
  if (replyToMessageId) {
    extra.reply_parameters = { message_id: Number(replyToMessageId), allow_sending_without_reply: false };
    if (target.externalReplyChatId) extra.reply_parameters.chat_id = target.externalReplyChatId;
    if (!target.externalReplyChatId) {
      extra.reply_to_message_id = Number(replyToMessageId);
      extra.allow_sending_without_reply = false;
    }
  }

  console.log('DONATION THANKS CONSENT TARGET:', {
    originalTargetChatId: targetChatId,
    sendChatId: target.chatId,
    threadId: target.threadId || null,
    replyToMessageId: replyToMessageId || null,
    donationId: donation?.id || null,
  });

  try {
    await bot.telegram.sendMessage(target.chatId, text, extra);
    await markDonationThanksPromptSent(donation.id, donation);
    return true;
  } catch (error) {
    console.error('DONATION THANKS CONSENT SEND ERROR:', error.response?.data || error.message);
    return false;
  }
}

async function sendDonationAnonymousThanks(donation) {
  if (!AUTO_DONATION_THANKS || !donation) return false;
  if (donationFlagTrue(donation, 'public_thanks_sent')) return false;
  const targetChatId = donationThanksTargetChatId(donation);
  if (!targetChatId) return false;

  const animalId = extractFileId(donation.animal_id) || donation.animal_id || donation.animal;
  const animal = animalId ? await getAnimalById(animalId) : null;
  const animalName = animal?.name || donation?.animal_name || 'кошка';
  const amount = donationAmountText(donation);
  const paymentType = donation?.payment_type === 'feed' ? 'feed' : 'donate';
  const text = [
    `❤️ Анонимный меценат помог ${escapeTelegramHtml(animalName)}.`,
    '',
    `${paymentKindEmoji(paymentType)} ${paymentKindLabel(paymentType)}: ${escapeTelegramHtml(amount)} ₽.`,
  ].join('\n');

  const threadId = donationThanksThreadId(donation);
  const replyToMessageId = donationThanksReplyToMessageId(donation);
  const target = await resolveDonationThanksTarget(targetChatId, replyToMessageId, threadId);
  const extra = { parse_mode: 'HTML' };
  if (target.threadId) extra.message_thread_id = Number(target.threadId);
  if (replyToMessageId) {
    extra.reply_parameters = { message_id: Number(replyToMessageId), allow_sending_without_reply: false };
    if (target.externalReplyChatId) extra.reply_parameters.chat_id = target.externalReplyChatId;
    if (!target.externalReplyChatId) {
      extra.reply_to_message_id = Number(replyToMessageId);
      extra.allow_sending_without_reply = false;
    }
  }

  try {
    await bot.telegram.sendMessage(target.chatId, text, extra);
    await markDonationThanksSent(donation?.id, donation);
    return true;
  } catch (error) {
    console.error('DONATION ANONYMOUS THANKS SEND ERROR:', error.response?.data || error.message);
    return false;
  }
}

async function sendDonationThanksFromWebhook(payload) {
  if (!AUTO_DONATION_THANKS || !webhookLooksSuccessful(payload)) return false;
  try {
    const donation = await findDonationForWebhook(payload);
    if (!donation) return false;
    if (donationPublicThanksAllowed(donation)) return sendDonationThanks(donation);
    return sendDonationAnonymousThanks(donation);
  } catch (error) {
    console.error('DONATION THANKS WEBHOOK ERROR:', error.response?.data || error.message);
    return false;
  }
}

let donationThanksWorkerTimer = null;
let donationThanksWorkerRunning = false;
const donationThanksProcessingIds = new TtlSet({ ttlMs: 10 * 60 * 1000, maxSize: 1000 });

function donationThanksAlreadyHandled(donation) {
  return donationFlagTrue(donation, 'public_thanks_sent');
}


async function processDonationThanksQueue(reason = 'interval') {
  if (
    !AUTO_DONATION_THANKS ||
    shutdownRequested ||
    !telegramReady
  ) {
    return false;
  }

  if (donationThanksWorkerRunning) {
    return false;
  }

  donationThanksWorkerRunning = true;

  try {
    const rows =
      await kotocatsCore.getDonationThanksQueue(
        DONATION_THANKS_WORKER_LIMIT
      );

    let processed = 0;

    for (const donation of rows || []) {

      const donationId = String(
        donation?.id || ''
      ).trim();

      if (
        !donationId ||
        donationThanksProcessingIds.has(donationId)
      ) {
        continue;
      }

      const needsFeedOrder =
        String(
          donation?.payment_type || ''
        ).toLowerCase() === 'feed' &&
        !catFeed.alreadySent(donation);

      const needsDonationThanks =
        donationHasOriginalPost(donation) &&
        !donationThanksAlreadyHandled(donation);

      if (
        !needsFeedOrder &&
        !needsDonationThanks
      ) {
        continue;
      }

      donationThanksProcessingIds.add(
        donationId
      );

      try {

        let feedOrderSent = false;
        let donationThanksSent = false;

        //
        // Заявка на кормление
        //
        if (needsFeedOrder) {

          const result =
            await catFeed.processSuccessfulDonation(
              donation
            );

          feedOrderSent =
            result?.handled === true;
        }

        //
        // Благодарность в комментариях
        //
        if (needsDonationThanks) {

          if (
            donationPublicThanksAllowed(
              donation
            )
          ) {

            donationThanksSent =
              await sendDonationThanks(
                donation
              );

          } else {

            donationThanksSent =
              await sendDonationAnonymousThanks(
                donation
              );

          }
        }

        if (
          feedOrderSent ||
          donationThanksSent
        ) {

          processed++;

          console.log(
            'DONATION QUEUE PROCESSED:',
            {
              donationId,
              reason,
              feedOrderSent,
              donationThanksSent,
            }
          );

        }

      } finally {

        donationThanksProcessingIds.delete(
          donationId
        );

      }

    }

    return processed > 0;

  } catch (error) {

    console.error(
      'DONATION THANKS QUEUE ERROR:',
      error.response?.data || error.message
    );

    return false;

  } finally {

    donationThanksWorkerRunning = false;

  }
}


function startDonationThanksWorker() {
  if (!AUTO_DONATION_THANKS || donationThanksWorkerTimer) return;
  donationThanksWorkerTimer = setInterval(() => {
    processDonationThanksQueue('interval');
  }, DONATION_THANKS_WORKER_INTERVAL_MS);
  if (typeof donationThanksWorkerTimer.unref === 'function') donationThanksWorkerTimer.unref();
}

function stopDonationThanksWorker() {
  if (donationThanksWorkerTimer) clearInterval(donationThanksWorkerTimer);
  donationThanksWorkerTimer = null;
}

async function handleMixplatWebhookWithThanks(req, res, url) {
  const body = await readRequestBody(req);
  const payload = parseWebhookBody(body, req.headers['content-type'] || '');
  const replayReq = createReplayRequest(req, body);

  const result = await handleMixplatWebhookBase(replayReq, res, url);
  if (result?.ok && !result?.ignored && result?.donation_id && webhookLooksSuccessful(payload)) {
    // Основной обработчик уже записал success в Directus; благодарность запускаем
    // только для однозначно найденного пожертвования этого бота.
    setTimeout(() => {
      sendDonationThanksFromWebhook(payload);
      processDonationThanksQueue('webhook');
    }, 1200);
  }
  return result;
}

function cacheInvalidateAuthorized(req, url) {
  if (!CACHE_INVALIDATE_TOKEN) return false;
  const headerToken = String(req.headers['x-cache-token'] || req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const queryToken = String(url.searchParams.get('token') || '').trim();
  return headerToken === CACHE_INVALIDATE_TOKEN || queryToken === CACHE_INVALIDATE_TOKEN;
}

async function handleCacheInvalidateWebhook(req, res, url) {
  if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: 'method not allowed' });
  if (!cacheInvalidateAuthorized(req, url)) return jsonResponse(res, 401, { ok: false, error: 'unauthorized' });

  const body = await readRequestBody(req);
  const payload = parseWebhookBody(body, req.headers['content-type'] || '') || {};
  const collection = String(payload.collection || payload.event?.collection || url.searchParams.get('collection') || '').trim();
  const id = payload.id || payload.key || payload.primary_key || payload.item || url.searchParams.get('id') || null;
  const animalId = extractFileId(payload.animal_id) || payload.animal_id || extractFileId(payload.data?.animal_id) || payload.data?.animal_id || null;

  if (animalId) {
    invalidateWebAnimalPayloadCache(animalId);
    if (collection === 'animal_media') {
      invalidateWebCatalogPayloadCache();
      invalidateWebAssetAccessCache();
    }
    return jsonResponse(res, 200, { ok: true, scope: 'animal', animal_id: String(animalId), collection: collection || null });
  }

  if (collection) {
    invalidateWebAnimalPayloadForMutation(collection, id, payload.data || payload);
  } else {
    invalidateWebAnimalPayloadCache();
    invalidateWebCatalogPayloadCache();
    invalidateWebAssetAccessCache();
  }

  return jsonResponse(res, 200, { ok: true, scope: collection || 'all', collection: collection || null, id: id || null });
}

function isAnimalPublicForWeb(animal) {
  if (!animal) return false;
  if (animal.is_archived === true || animal.archived === true) return false;
  return animal.published === true || animal.is_public === true;
}

async function handleWebDonateApi(req, res) {
  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { ok: false, error: 'method_not_allowed', message: 'Метод не поддерживается.' });
  }

  if (!mixplatDonationsEnabled()) {
    return jsonResponse(res, 503, { ok: false, error: 'mixplat_disabled', message: 'Приём донатов временно недоступен.' });
  }

  let body;
  try {
    body = await readJsonRequestBody(req);
  } catch (error) {
    return jsonResponse(res, error.statusCode || 400, { ok: false, error: 'invalid_json', message: 'Некорректный запрос.' });
  }

  const animalId = String(body.animal || body.animal_id || body.id || '').trim();
  const paymentType = String(body.payment_type || body.paymentType || 'donate').trim().toLowerCase() === 'feed' ? 'feed' : 'donate';
  const amountRub = body.amount || body.amount_rub || body.amountRub;
  const donorPhone = normalizePhone(body.phone || body.donor_phone || '');
  const messenger = String(body.messenger || '').trim().toLowerCase();
  const allowedMessengers = new Set(['telegram', 'whatsapp', 'max']);
  if (!animalId) {
    return jsonResponse(res, 400, { ok: false, error: 'animal_required', message: 'Не передана кошка для доната.' });
  }
  if (paymentType === 'feed') {
    const amount = Number(amountRub);
    if (![200, 400].includes(amount)) {
      return jsonResponse(res, 400, { ok: false, error: 'invalid_feed_amount', message: 'Для вкусняшки можно выбрать только 200 или 400 ₽.' });
    }
    if (!donorPhone) {
      return jsonResponse(res, 400, { ok: false, error: 'phone_required', message: 'Укажите номер телефона.' });
    }
    if (!allowedMessengers.has(messenger)) {
      return jsonResponse(res, 400, { ok: false, error: 'messenger_required', message: 'Выберите мессенджер.' });
    }
  }

  const animal = await getAnimalById(animalId);
  if (!isAnimalPublicForWeb(animal)) {
    return jsonResponse(res, 404, {
      ok: false,
      error: 'animal_not_found_or_unpublished',
      message: WEB_ANIMAL_UNAVAILABLE_MESSAGE,
    });
  }
  if (!locationAllowsDonations(animal.location) && paymentType === 'donate') {
    return jsonResponse(res, 403, { ok: false, error: 'donations_disabled', message: 'Для этой площадки донаты отключены.' });
  }
  if (!locationAllowsFeed(animal.location) && paymentType === 'feed') {
    return jsonResponse(res, 403, { ok: false, error: 'feed_disabled', message: 'Для этой площадки помощь вкусняшкой отключена.' });
  }

  try {
    const payment = await createCatDonationPayment({
      animal,
      amountRub,
      donorTelegramId: null,
      donorUsername: null,
      donorPhone: donorPhone || null,
      paymentType,
      source: paymentType === 'feed' ? 'web_cat_card_feed' : 'web_cat_card',
      publicThanks: false,
      askPublicThanksAfterPayment: false,
      comment: body.comment || null,
      rawRequestExtra: paymentType === 'feed' ? { messenger, contact_phone: donorPhone || null } : null,
    });

    return jsonResponse(res, 200, {
      ok: true,
      donation_id: payment.donation_id,
      payment_id: payment.payment_id,
      amount: payment.amount,
      redirect_url: payment.redirect_url,
    });
  } catch (error) {
    console.error('WEB DONATE CREATE ERROR:', error.response?.data || error.message);
    return jsonResponse(res, 500, {
      ok: false,
      error: 'payment_create_failed',
      message: error.message || 'Не удалось создать платёж. Попробуйте позже.',
    });
  }
}

async function assetBelongsToPublicAnimal(fileId) {
  const id = String(fileId || '').trim();
  if (!id) return false;
  if (webAssetAccessCache.has(id)) return webAssetAccessCache.get(id);

  const pending = assetBelongsToPublicAnimalUncached(id).catch((error) => {
    webAssetAccessCache.delete(id);
    throw error;
  });

  webAssetAccessCache.set(id, pending);
  while (webAssetAccessCache.size > WEB_ASSET_ACCESS_CACHE_MAX) {
    const oldestKey = webAssetAccessCache.keys().next().value;
    if (oldestKey === undefined) break;
    webAssetAccessCache.delete(oldestKey);
  }
  return pending;
}

async function assetBelongsToPublicAnimalUncached(id) {
  const rows = await directusGet('animal_media', {
    filter: { file_id: { _eq: id } },
    fields: 'id,animal_id',
    limit: 10,
  });
  for (const row of rows || []) {
    const animalId = extractFileId(row.animal_id) || row.animal_id;
    const animal = animalId ? await getAnimalById(animalId) : null;
    if (isAnimalPublicForWeb(animal)) return true;
  }
  return false;
}

function inferAssetContentType(filename = '') {
  const lower = String(filename || '').toLowerCase().split('?')[0];
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov') || lower.endsWith('.qt')) return 'video/quicktime';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return null;
}

function publicVideoSources(row) {
  const sources = [];
  const webmFileId = getAnimalMediaWebmFileId(row);
  const mp4FileId = getAnimalMediaWebFileId(row);
  if (webmFileId) sources.push({ url: assetUrl(webmFileId), type: 'video/webm' });
  if (mp4FileId) sources.push({ url: assetUrl(mp4FileId), type: inferAssetContentType(mp4FileId) || 'video/mp4' });
  return sources.filter((item) => item.url);
}

function sharpFormatToContentType(format) {
  const value = String(format || '').toLowerCase();
  if (value === 'jpeg' || value === 'jpg') return 'image/jpeg';
  if (value === 'png') return 'image/png';
  if (value === 'webp') return 'image/webp';
  if (value === 'gif') return 'image/gif';
  if (value === 'avif') return 'image/avif';
  return 'application/octet-stream';
}

async function getDirectusFileMetadata(fileId) {
  const id = String(fileId || '').trim();
  if (!id) return null;
  if (webAssetMetadataCache.has(id)) return webAssetMetadataCache.get(id);

  const pending = axios.get(`${DIRECTUS_URL}/files/${encodeURIComponent(id)}`, {
    headers: apiHeaders(),
    params: { fields: 'id,filename_download,type,filesize' },
    timeout: DIRECTUS_TIMEOUT_MS,
  }).then((response) => response.data?.data || null).catch((error) => {
    webAssetMetadataCache.delete(id);
    throw error;
  });

  webAssetMetadataCache.set(id, pending);
  while (webAssetMetadataCache.size > WEB_ASSET_ACCESS_CACHE_MAX) {
    const oldestKey = webAssetMetadataCache.keys().next().value;
    if (oldestKey === undefined) break;
    webAssetMetadataCache.delete(oldestKey);
  }
  return pending;
}


const animalReviews = createAnimalReviewsModule({
  axios,
  DIRECTUS_URL,
  DIRECTUS_TIMEOUT_MS,
  apiHeaders,
  directusGet,
  directusPost,
  directusPatch,
  getAnimalById,
  searchAnimalsByName,
  findAnimalFromText,
  Markup,
  sessions,
  isAnimalPublicForWeb,
});
animalReviews.registerBotHandlers(bot);
animalReviews.registerAdminHandlers(bot, {
  getAnimalById,
  ensureAdminCallbackAccess: ensureEditAnimalAccess,
});

function renderWebRelatedCatsHtml(items = []) {
  if (!items.length) return '<div class="muted">Подбираем компанию...</div>';
  return items.map((cat) => (
    `<a class="related-cat" href="?animal=${encodeURIComponent(cat.id)}">` +
    (cat.photo_url ? `<img src="${escapeTelegramHtml(cat.photo_url)}" srcset="${escapeTelegramHtml(buildAssetSrcSet(cat.photo_url, [240, 360, 480]))}" sizes="120px" loading="lazy" alt="${escapeTelegramHtml(cat.name || 'Кошка')}">` : '') +
    `<div class="related-cat-body"><div class="related-cat-name">${escapeTelegramHtml(cat.name || 'Кошка')}</div>` +
    `<div class="related-cat-caption">${escapeTelegramHtml(cat.short_description || cat.status_label || 'Познакомиться поближе')}</div></div></a>`
  )).join('');
}

function assetVariantUrl(url, width) {
  const value = String(url || '').trim();
  const roundedWidth = Number(width || 0);
  if (!value || !Number.isFinite(roundedWidth) || roundedWidth < 120) return value;
  try {
    const parsed = new URL(value, 'https://local.invalid');
    parsed.searchParams.set('w', String(Math.round(roundedWidth)));
    return `${parsed.pathname}${parsed.search}`;
  } catch (_) {
    return value;
  }
}

function buildAssetSrcSet(url, widths = []) {
  return widths
    .filter((width, index, list) => Number.isFinite(width) && width >= 120 && list.indexOf(width) === index)
    .map((width) => `${assetVariantUrl(url, width)} ${width}w`)
    .join(', ');
}

function renderWebSupportHtml(payload) {
  if (payload?.support_enabled === false) return '';
  const animal = payload?.animal || {};
  const donations = payload?.donations || [];
  const summary = payload?.donation_summary || {};
  const url = payload?.donation_url || '';
  const feedEnabled = payload?.feed_enabled === true;
  const feedCount = Number(payload?.feed_count);
  const reviewCount = Number(payload?.review_count);
  const stats = [];
  if (summary.count) stats.push(`<span class="support-stat">Донатов: ${escapeTelegramHtml(summary.count)}</span>`);
  if (Number.isFinite(feedCount)) stats.push(`<span class="support-stat">Покормили: ${escapeTelegramHtml(feedCount)} раз</span>`);
  if (Number.isFinite(reviewCount)) stats.push(`<span class="support-stat">Отзывов: ${escapeTelegramHtml(reviewCount)} раз</span>`);
  const donationsHtml = donations.length
    ? `<div class="donation-list">${donations.map((donation) => `<div class="donation-item"><strong>${escapeTelegramHtml(donation.amount)} ₽</strong> от ${escapeTelegramHtml(donation.donor || 'Аноним')}${donation.comment ? `<div>${escapeTelegramHtml(donation.comment)}</div>` : ''}<div class="donation-meta">${escapeTelegramHtml(donation.date || '')}</div></div>`).join('')}</div>`
    : '';
  if (!donations.length && !url && !feedEnabled) return '';
  const donateHtml = url
    ? `<div class="support-donate" data-donate-widget data-animal-id="${escapeTelegramHtml(animal.id || '')}"><div class="support-amounts">${renderQuickDonateButtons(WEB_DONATE_QUICK_AMOUNTS, WEB_DONATE_QUICK_AMOUNTS[WEB_DONATE_QUICK_AMOUNTS.length - 1], 'support-amount')}<button class="support-amount" type="button" data-amount="custom">Другая сумма</button></div><input class="support-custom" type="text" inputmode="numeric" placeholder="Своя сумма" hidden><button class="support-pay" type="button">Оплатить</button><div class="support-notice"></div></div>`
    : '';
  const feedHtml = feedEnabled
    ? `<div class="support-feed" data-feed-widget data-animal-id="${escapeTelegramHtml(animal.id || '')}"><div class="support-title">Дай вкусняшку</div><div class="support-note">Выберите вкусняшку, мы покормим котика и пришлем видео кормления.</div><div class="support-amounts support-amounts-feed"><button class="support-amount" type="button" data-feed-amount="200">200 ₽<br><span class="support-amount-note">вкусняшка</span></button><button class="support-amount" type="button" data-feed-amount="400">400 ₽<br><span class="support-amount-note">очень вкусная вкусняшка</span></button></div><input class="support-contact" type="tel" inputmode="tel" placeholder="+7 (___) ___-__-__" maxlength="18"><select class="support-select"><option value="">Выберите мессенджер</option><option value="telegram">Telegram</option><option value="whatsapp">WhatsApp</option><option value="max">Max</option></select><button class="support-pay" type="button">Оплатить вкусняшку</button><div class="support-notice"></div></div>`
    : '';
  return `<div class="section"><h2>Помочь</h2><div class="support-box"><div class="support-head"><div><div class="support-title">Помочь кошке</div><div class="support-note">Кошке ${escapeTelegramHtml(animal.name || 'котик')} надо платить за аренду и сотрудникам, чтобы не жить на улице, поэтому она с благодарностью примет донат</div></div></div>${stats.length ? `<div class="support-stats">${stats.join('')}</div>` : ''}${donateHtml}${feedHtml}${donationsHtml ? `<div><div class="support-title">Уже поддержали</div>${donationsHtml}</div>` : ''}</div></div>`;
}

function renderWebNeedsHtml(payload) {
  const needs = payload?.needs || [];
  if (!needs.length) return '';
  return `<div class="section"><h2>Что нужно этому котику</h2><div class="needs">${needs.map((need) => `<div class="need">${escapeTelegramHtml(need.title || 'Нужда')}${need.url ? `<br><a href="${escapeTelegramHtml(need.url)}" target="_blank" rel="noopener">Открыть ссылку</a>` : ''}</div>`).join('')}</div></div>`;
}

function buildCafeVisitPayload(location) {
  const cafe = KOTOCAFE_MAP[location];
  if (!cafe) return null;
  return {
    label: cafe.label,
    address: cafe.address || '',
    url: cafe.url || '',
    map_url: locationShowsMapLink(location) ? (cafe.mapUrl || '') : '',
    show_map_link: locationShowsMapLink(location),
    title: '\u041f\u0440\u0438\u0445\u043e\u0434\u0438\u0442\u0435 \u0432 \u0433\u043e\u0441\u0442\u0438',
    text: '\u041c\u044b \u043f\u043e\u043c\u043e\u0433\u0430\u0435\u043c \u043a\u043e\u0448\u043a\u0430\u043c \u043f\u043e\u0442\u043e\u043c\u0443, \u0447\u0442\u043e \u0432\u044b \u043f\u0440\u0438\u0445\u043e\u0434\u0438\u0442\u0435 \u043a \u043d\u0430\u043c \u0432 \u0433\u043e\u0441\u0442\u0438. \u042d\u0442\u0430 \u043a\u043e\u0448\u043a\u0430 \u0436\u0438\u0432\u0451\u0442 \u0438\u043c\u0435\u043d\u043d\u043e \u0437\u0434\u0435\u0441\u044c.',
  };
}

function renderWebVideoPlaylistHtml(videos = []) {
  if (!videos.length) return '';
  const firstUrl = typeof videos[0] === 'string' ? videos[0] : videos[0]?.url || videos[0]?.sources?.[0]?.url || '';
  const firstPoster = typeof videos[0] === 'object' && videos[0]?.poster_url ? videos[0].poster_url : '';
  const firstTitle = typeof videos[0] === 'object' && videos[0]?.caption ? videos[0].caption : 'Видео 1';
  const firstSources = typeof videos[0] === 'object' ? (videos[0]?.sources || []) : [];
  const renderSources = (sources = [], fallbackUrl = '') => {
    const tags = (sources || []).filter((item) => item?.url).map((item) => `<source src="${escapeTelegramHtml(item.url)}" type="${escapeTelegramHtml(item.type || inferAssetContentType(item.url) || 'video/mp4')}">`).join('');
    return tags || (fallbackUrl ? `<source src="${escapeTelegramHtml(fallbackUrl)}" type="${escapeTelegramHtml(inferAssetContentType(fallbackUrl) || 'video/mp4')}">` : '');
  };
  return '<div class="section"><h2>Видео</h2><div class="video-playlist">' +
    `<div class="video-player"><video id="catVideoPlayer" controls preload="metadata" playsinline${firstPoster ? ` poster="${escapeTelegramHtml(firstPoster)}"` : ''}>${renderSources(firstSources, firstUrl)}</video><button type="button" class="video-player-overlay is-paused" data-video-toggle aria-label="Запустить видео"><span class="video-player-overlay-icon" aria-hidden="true"></span></button></div>` +
    `<div id="catVideoCaption" class="video-current-caption">${escapeTelegramHtml(firstTitle)}</div>` +
    `<div class="video-gallery">${videos.slice(0, 12).map((video, index) => {
      const url = typeof video === 'string' ? video : video?.url || video?.sources?.[0]?.url || '';
      const title = typeof video === 'object' && video?.caption ? video.caption : `Видео ${index + 1}`;
      const poster = typeof video === 'object' && video?.poster_url ? video.poster_url : '';
      const sources = typeof video === 'object' ? JSON.stringify(video.sources || []).replace(/"/g, '&quot;') : '';
      return `<button type="button" class="video-item${index === 0 ? ' active' : ''}" data-video-src="${escapeTelegramHtml(url)}" data-video-sources="${sources}" data-video-poster="${escapeTelegramHtml(poster)}" data-video-caption="${escapeTelegramHtml(title)}" data-video-index="${index}" aria-label="${escapeTelegramHtml(title)}"><div class="video-thumb-wrap">${poster ? `<img class="video-thumb" src="${escapeTelegramHtml(poster)}" loading="lazy" decoding="async" alt="${escapeTelegramHtml(title)}">` : `<video class="video-thumb-video" preload="metadata" muted playsinline src="${escapeTelegramHtml(url)}"></video>`}<span class="video-play-icon" aria-hidden="true"></span></div><div class="video-copy"><div class="video-title">${escapeTelegramHtml(title)}</div></div></button>`;
    }).join('')}</div></div></div>`;
}

function renderWebAnimalCardHtml(payload = null) {
  if (!payload?.animal) return '<div id="app" class="box">Загружаю анкету...</div>';
  const animal = payload.animal || {};
  const photos = payload.photos || [];
  const fullPhotos = payload.full_photos || photos;
  const main = payload.main_photo_url || photos[0] || '';
  const mainFull = payload.main_photo_full_url || fullPhotos[0] || main;
  const mainSrcSet = buildAssetSrcSet(main, [480, 720, 1200]);
  return '<div id="app" class="card">' +
    (main ? `<img class="photo" src="${escapeTelegramHtml(main)}" srcset="${escapeTelegramHtml(mainSrcSet)}" sizes="(max-width: 768px) 100vw, 560px" data-full-photo="${escapeTelegramHtml(mainFull)}" alt="${escapeTelegramHtml(animal.name || 'Кошка')}" fetchpriority="high" decoding="async">` : '') +
    '<div class="content">' +
      `<div class="eyebrow">${escapeTelegramHtml(payload.location_label ? `Котокафе • ${payload.location_label}` : 'Котокафе')}</div>` +
      `<h1>${escapeTelegramHtml(animal.name || 'Кошка')}</h1>` +
      `<div class="pill">${escapeTelegramHtml(payload.status_label || 'Статус не указан')}</div>` +
      (payload.human_lead ? `<div class="lead">${escapeTelegramHtml(payload.human_lead)}</div>` : '') +
      `<div class="section"><h2>Характер и быт</h2><div class="human-block">${escapeTelegramHtml(payload.life_lead || 'Особенности характера и быта пока уточняются.')}${animal.character_comment ? `<br><br>${escapeTelegramHtml(animal.character_comment)}` : ''}</div></div>` +
      (payload.adoption_requirements ? `<div class="section"><h2>Требования к пристройству</h2><div class="text">${escapeTelegramHtml(payload.adoption_requirements)}</div></div>` : '') +
      `<div class="section"><h2>Здоровье</h2><div class="human-block">${escapeTelegramHtml(payload.health_lead || 'Информация о здоровье пока уточняется.')}${animal.health_comment ? `<br><br>${escapeTelegramHtml(animal.health_comment)}` : ''}</div></div>` +
      (animal.short_description ? `<div class="section"><h2>Описание</h2><div class="text">${escapeTelegramHtml(animal.short_description)}</div></div>` : '') +
      (animal.story ? `<div class="section"><h2>История</h2><div class="text">${escapeTelegramHtml(animal.story)}</div></div>` : '') +
      renderWebSupportHtml(payload) +
      renderWebNeedsHtml(payload) +
      (photos.length > 1 ? `<div class="section"><h2>Галерея</h2><div class="gallery">${photos.slice(0, 9).map((url, index) => `<img src="${escapeTelegramHtml(url)}" srcset="${escapeTelegramHtml(buildAssetSrcSet(url, [240, 360, 480, 720]))}" sizes="(max-width: 768px) 33vw, 180px" data-full-photo="${escapeTelegramHtml(fullPhotos[index] || url)}" loading="lazy" decoding="async" alt="Открыть большое фото">`).join('')}</div></div>` : '') +
      renderWebVideoPlaylistHtml(payload.videos || []) +
      animalReviews.formHtml() +
      `<div class="section related-section"><h2>Еще кошки</h2><div id="relatedCats" class="related-cats">${renderWebRelatedCatsHtml(payload.related_animals || [])}</div></div>` +
    '</div></div>';
}

function renderYandexMetrikaCounter() {
  return `<!-- Yandex.Metrika counter -->
<script type="text/javascript">
    (function(m,e,t,r,i,k,a){
        m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
        m[i].l=1*new Date();
        for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
        k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
    })(window, document,'script','https://mc.yandex.ru/metrika/tag.js', 'ym');

    ym(29745500, 'init', {webvisor:true, clickmap:true, referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});
</script>
<noscript><div><img src="https://mc.yandex.ru/watch/29745500" style="position:absolute; left:-9999px;" alt="" /></div></noscript>
<!-- /Yandex.Metrika counter -->`;
}

function donateWebAppHtml(options = {}) {
  const animalId = String(options.animalId || '').trim();
  const animalName = String(options.animalName || '').trim();
  const profilePath = options.profilePath || '/';
  const backUrl = animalId ? `${profilePath}?animal=${encodeURIComponent(animalId)}` : `${profilePath === '/webapp' ? '/webapp' : '/'}`;
  const title = 'Помочь кошке';
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" type="image/png" href="/favicon.png">
<title>${escapeTelegramHtml(title)} — Котокафе</title>
<meta name="robots" content="noindex,nofollow">
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
:root{color-scheme:light;--bg:#f7f1e8;--card:#fffaf3;--text:#2c2118;--muted:#7f7064;--accent:#d95757;--accent2:#8b5e3c;--line:#eadccb}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:linear-gradient(180deg,#fff7ed,var(--bg));color:var(--text)}
.wrap{max-width:560px;margin:0 auto;padding:22px 16px 36px}.card{background:var(--card);border:1px solid var(--line);border-radius:24px;box-shadow:0 14px 36px rgba(80,52,26,.10);padding:22px}
.eyebrow{font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}h1{margin:8px 0 8px;font-size:30px;line-height:1.08}.lead{color:var(--muted);line-height:1.45;margin:0 0 18px}
.amounts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:16px 0}.amount{border:1px solid var(--line);background:#fff;border-radius:16px;padding:14px 12px;font-size:18px;font-weight:800;color:var(--accent2);cursor:pointer}
.amount.active{border-color:var(--accent);box-shadow:0 0 0 3px rgba(217,87,87,.14);color:var(--accent)}
label{display:block;font-weight:700;margin:16px 0 8px}input{width:100%;border:1px solid var(--line);border-radius:16px;padding:14px 14px;font-size:18px;background:#fff;color:var(--text)}
.pay{width:100%;border:0;border-radius:18px;margin-top:18px;padding:16px 18px;background:var(--accent);color:white;font-size:18px;font-weight:900;cursor:pointer;box-shadow:0 12px 24px rgba(217,87,87,.22)}
.pay:disabled{opacity:.65;cursor:wait}.note{font-size:13px;color:var(--muted);line-height:1.45;margin-top:14px}.notice{display:none;margin-top:14px;padding:12px;border-radius:14px}.notice.error{background:#fff0f0;color:#9b1c1c}.notice.success{background:#eefbf3;color:#166534}.notice.warning{background:#fff8e8;color:#92400e}.back{display:inline-block;margin-top:18px;color:var(--accent2);text-decoration:none;font-weight:700}
</style>
</head>
<body>
${renderYandexMetrikaCounter()}
<div class="wrap"><div class="card">
<div class="eyebrow">Котокафе</div>
<h1>${escapeTelegramHtml(title)}</h1>
<p class="lead">Выберите сумму — мы создадим безопасную форму оплаты через Миксплат.</p>
<div class="amounts" id="amounts">
${renderQuickDonateButtons(WEB_DONATE_QUICK_AMOUNTS, WEB_DONATE_QUICK_AMOUNTS[WEB_DONATE_QUICK_AMOUNTS.length - 1], 'amount')}
</div>
<label for="customAmount">Другая сумма</label>
<input id="customAmount" inputmode="numeric" autocomplete="off" placeholder="Например, 750">
<button class="pay" id="payButton" type="button">Оплатить</button>
<div class="notice" id="noticeBox"></div>
<p class="note">Данные карты вводятся только на стороне платёжной формы Миксплата.  анкете мы фиксируем назначение доната и статус оплаты.</p>
<a class="back" href="${escapeTelegramHtml(backUrl)}">← Вернуться к анкете</a>
</div></div>
<script>
(function(){
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { try { tg.ready(); tg.expand(); } catch (_) {} }
  var animalId = ${inlineScriptJson(animalId)};
  var selectedAmount = 300;
  var buttons = Array.prototype.slice.call(document.querySelectorAll('.amount'));
  var input = document.getElementById('customAmount');
  var pay = document.getElementById('payButton');
  var noticeBox = document.getElementById('noticeBox');
  function showNotice(kind, message) {
    noticeBox.className = 'notice ' + (kind || 'error');
    noticeBox.textContent = message || 'Не удалось создать платёж.';
    noticeBox.style.display = 'block';
  }
  function showError(message) {
    showNotice('error', message || 'Не удалось создать платёж.');
  }
  function showPaymentResultFromQuery() {
    var params = new URLSearchParams(location.search || '');
    var payment = String(params.get('payment') || '').toLowerCase();
    if (!payment) return;
    if (payment === 'success') return showNotice('success', 'Спасибо! Платёж прошел успешно.');
    if (payment === 'canceled' || payment === 'cancelled') return showNotice('warning', 'Оплата была отменена. Если хотите, попробуйте ещё раз.');
    if (payment === 'expired') return showNotice('warning', 'Время на оплату истекло. Попробуйте создать платёж ещё раз.');
    return showNotice('error', 'Платёж не прошел. Возможно, на карте недостаточно средств или банк отклонил операцию. Попробуйте ещё раз или выберите другой способ оплаты.');
  }
  showPaymentResultFromQuery();
  buttons.forEach(function(button) {
    button.addEventListener('click', function() {
      buttons.forEach(function(item) { item.classList.remove('active'); });
      button.classList.add('active');
      selectedAmount = Number(button.getAttribute('data-amount') || 300);
      input.value = '';
    });
  });
  input.addEventListener('input', function() {
    buttons.forEach(function(item) { item.classList.remove('active'); });
  });
  pay.addEventListener('click', async function() {
    noticeBox.style.display = 'none';
    var custom = Number(String(input.value || '').replace(',', '.').replace(/[^0-9.]/g, ''));
    var amount = custom > 0 ? custom : selectedAmount;
    if (!animalId) return showError('Не передана кошка для доната.');
    if (!amount || amount <= 0) return showError('Введите сумму доната.');
    pay.disabled = true;
    pay.textContent = 'Создаём оплату...';
    try {
      var prefix = location.pathname.indexOf('/webapp/') === 0 ? '/webapp' : '';
      var response = await fetch(prefix + '/api/donate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ animal: animalId, amount: amount })
      });
      var payload = await response.json().catch(function(){ return {}; });
      if (!response.ok || !payload.redirect_url) throw new Error(payload.message || 'Не удалось создать платёж.');
      location.href = payload.redirect_url;
    } catch (error) {
      showError(error.message || 'Не удалось создать платёж. Попробуйте позже.');
      pay.disabled = false;
      pay.textContent = 'Перейти к оплате';
    }
  });
})();
</script>
</body>
</html>`;
}

function paymentSuccessWebAppHtml(meta = {}, payload = null, options = {}) {
  const animal = payload?.animal || {};
  const animalName = animal.name || options.animalName || 'Эта кошка';
  const paymentKind = options.paymentKind === 'feed' ? 'feed' : 'donate';
  const title = paymentKind === 'feed'
    ? `${animalName} благодарит вас за вкусняшку`
    : `${animalName} благодарит вас за донат`;
  const lead = paymentKind === 'feed'
    ? 'Оплата прошла успешно. Спасибо, что порадовали кошку вкусняшкой. Мы пришлем видео кормления.'
    : 'Ваш платёж прошел успешно. Благодаря вам у кошек появляется больше еды, лечения и спокойных дней.';
  const canonicalUrl = meta.canonicalUrl || publicUrl('/success');
  const imageUrl = meta.imageUrl || payload?.main_photo_url || publicUrl('/og-cats.png');
  const profileUrl = animal?.id ? `/?animal=${encodeURIComponent(animal.id)}` : '/';
  const catalogUrl = buildCatalogWebAppUrl() || publicUrl('/');
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/favicon.png">
<meta name="theme-color" content="#f7f1e8">
<title>${escapeTelegramHtml(title)}</title>
<meta name="description" content="${escapeTelegramHtml(title)}">
<meta name="robots" content="noindex,nofollow">
${canonicalUrl ? `<link rel="canonical" href="${escapeTelegramHtml(canonicalUrl)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Котокафе">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="${escapeTelegramHtml(title)}">
<meta property="og:description" content="${escapeTelegramHtml(title)}">
${canonicalUrl ? `<meta property="og:url" content="${escapeTelegramHtml(canonicalUrl)}">` : ''}
${imageUrl ? `<meta property="og:image" content="${escapeTelegramHtml(imageUrl)}">` : ''}
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
:root{--bg:#f7f1e8;--paper:#fffdf9;--text:#292622;--muted:#7c746a;--accent:#b86632;--accent-dark:#84431f;--line:rgba(55,44,34,.12);--shadow:0 18px 48px rgba(65,45,28,.12)}
*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:var(--text);background:radial-gradient(circle at 8% 0,rgba(205,135,80,.19),transparent 30rem),radial-gradient(circle at 95% 18%,rgba(238,194,139,.25),transparent 25rem),var(--bg)}
a{color:inherit}.wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px 16px}.card{width:min(100%,720px);background:rgba(255,253,249,.94);border:1px solid var(--line);border-radius:28px;overflow:hidden;box-shadow:var(--shadow)}.photo{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:#eadfce}.content{padding:28px 24px 24px;text-align:center}.eyebrow{color:var(--accent-dark);font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.title{margin:12px 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:clamp(34px,6vw,52px);line-height:1}.lead{margin:0 auto;max-width:520px;color:#5e574f;font-size:18px;line-height:1.5}.actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:22px}.button{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 18px;border-radius:999px;border:1px solid var(--line);background:#fff7ec;color:var(--accent);font-weight:700;text-decoration:none}.button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
@media(max-width:520px){.wrap{padding:16px 12px}.content{padding:22px 18px 18px}.lead{font-size:16px}.button{width:100%}}
</style>
</head>
<body>
${renderYandexMetrikaCounter()}
<div class="wrap">
  <div class="card">
    ${payload?.main_photo_url ? `<img class="photo" src="${escapeTelegramHtml(payload.main_photo_url)}" alt="${escapeTelegramHtml(animalName)}">` : ''}
    <div class="content">
      <div class="eyebrow">Спасибо за помощь</div>
      <h1 class="title">${escapeTelegramHtml(title)}</h1>
      <p class="lead">${escapeTelegramHtml(lead)}</p>
      <div class="actions">
        <a class="button primary" href="${escapeTelegramHtml(profileUrl)}">Вернуться к кошке</a>
        <a class="button" href="${escapeTelegramHtml(catalogUrl)}">Каталог кошек</a>
      </div>
    </div>
  </div>
</div>
</body>
</html>`;
}

function webAppHtml(meta = {}, payload = null) {
  const title = meta.title || 'Каталог кошек Котокафе';
  const description = meta.description || 'Каталог кошек Котокафе: фото, характер, здоровье, история и способы помочь.';
  const canonicalUrl = meta.canonicalUrl || publicUrl('/');
  const imageUrl = meta.imageUrl || publicUrl('/favicon.png');
  const imageAlt = meta.imageAlt || 'Каталог кошек Котокафе';
  const mainPhotoUrl = payload?.main_photo_url ? publicUrl(payload.main_photo_url) : '';
  const initialPayloadScript = payload ? `<script>window.__CAT_INITIAL_PAYLOAD=${inlineScriptJson(payload)};window.__CAT_DONATE_QUICK_AMOUNTS=${inlineScriptJson(WEB_DONATE_QUICK_AMOUNTS)};</script>` : `<script>window.__CAT_DONATE_QUICK_AMOUNTS=${inlineScriptJson(WEB_DONATE_QUICK_AMOUNTS)};</script>`;
  const structuredData = animalStructuredData(payload, { canonicalUrl, description });
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/favicon.png">
<title>${escapeTelegramHtml(title)}</title>
<meta name="description" content="${escapeTelegramHtml(description)}">
<meta name="robots" content="index,follow">
${canonicalUrl ? `<link rel="canonical" href="${escapeTelegramHtml(canonicalUrl)}">` : ''}
<meta property="og:type" content="article">
<meta property="og:site_name" content="Котокафе">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="${escapeTelegramHtml(title)}">
<meta property="og:description" content="${escapeTelegramHtml(description)}">
${canonicalUrl ? `<meta property="og:url" content="${escapeTelegramHtml(canonicalUrl)}">` : ''}
${imageUrl ? `<meta property="og:image" content="${escapeTelegramHtml(imageUrl)}">
<meta property="og:image:secure_url" content="${escapeTelegramHtml(imageUrl)}">
<meta property="og:image:alt" content="${escapeTelegramHtml(imageAlt)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeTelegramHtml(title)}">
<meta name="twitter:description" content="${escapeTelegramHtml(description)}">
${imageUrl ? `<meta name="twitter:image" content="${escapeTelegramHtml(imageUrl)}">` : ''}
${structuredData ? jsonLdScript(structuredData) : ''}
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<link rel="stylesheet" href="/cat-card.css?v=${CAT_CARD_ASSET_VERSION}">
<style>${animalReviews.css()}</style>
</head>
<body>
${renderYandexMetrikaCounter()}
<div class="wrap">${renderWebAnimalCardHtml(payload)}</div>
<div id="lightbox" class="lightbox" aria-hidden="true"><button class="lightbox-close" type="button" aria-label="Закрыть">×</button><button id="lightboxPrev" class="lightbox-nav lightbox-prev" type="button" aria-label="Предыдущее фото">‹</button><img id="lightboxImg" src="" alt="Большое фото"><button id="lightboxNext" class="lightbox-nav lightbox-next" type="button" aria-label="Следующее фото">›</button><div id="lightboxCount" class="lightbox-count" aria-live="polite"></div></div>
<script>window.__ANIMAL_REVIEW_FORM_HTML=${inlineScriptJson(animalReviews.formHtml())};</script>
${initialPayloadScript}
<script src="/cat-card.js?v=${CAT_CARD_ASSET_VERSION}"></script>
${animalReviews.clientScript('animalId')
  .replace(
    "const status = form.querySelector('[data-review-status]');",
    "const status = form.querySelector('[data-review-status]');\n  const toPublicReviewError = (message) => {\n    const code = String(message || '').trim();\n    const map = {\n      'reviews disabled': 'Отзывы временно недоступны.',\n      'origin not allowed': 'Отправка отзывов сейчас недоступна.',\n      'method not allowed': 'Метод запроса не поддерживается.',\n      'bad request': 'Некорректный запрос.',\n      'animal_id is required': 'Не удалось определить кошку для отзыва.',\n      'review_text is required': 'Введите текст отзыва.',\n      'too many reviews, try later': 'Слишком много попыток. Попробуйте чуть позже.',\n      'animal not found': 'Кошка не найдена.',\n      'review create failed': 'Не удалось отправить отзыв. Попробуйте позже.'\n    };\n    return map[code] || code || 'Не удалось отправить отзыв. Попробуйте позже.';\n  };"
  )
  .replace(
    "if (!response.ok || data.error) throw new Error(data.error || 'Ошибка');",
    "if (!response.ok || data.error) throw new Error(toPublicReviewError(data.error || 'Ошибка'));"
  )
  .replace(
    "status.textContent = 'Не получилось отправить отзыв. Попробуйте позже.';",
    "status.textContent = toPublicReviewError(error.message);"
  )}
<script>
window.submitAnimalReview = async function submitAnimalReview(form) {
  const status = form.querySelector('[data-review-status]');
  const toPublicReviewError = (message) => {
    const code = String(message || '').trim();
    const map = {
      'reviews disabled': 'Отзывы временно недоступны.',
      'origin not allowed': 'Отправка отзывов сейчас недоступна.',
      'method not allowed': 'Метод запроса не поддерживается.',
      'bad request': 'Некорректный запрос.',
      'animal_id is required': 'Не удалось определить кошку для отзыва.',
      'review_text is required': 'Введите текст отзыва.',
      'too many reviews, try later': 'Слишком много попыток. Попробуйте чуть позже.',
      'animal not found': 'Кошка не найдена.',
      'review create failed': 'Не удалось отправить отзыв. Попробуйте позже.'
    };
    return map[code] || code || 'Не удалось отправить отзыв. Попробуйте позже.';
  };
  const payload = {
    animal_id: animalId,
    reviewer_name: form.reviewer_name.value,
    review_text: form.review_text.value,
    website: form.website.value
  };

  status.textContent = 'Отправляю...';

  try {
    const response = await fetch('/api/animal-review', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(toPublicReviewError(data.error || 'Ошибка'));
    form.reset();
    status.textContent = data.message || 'Спасибо! Отзыв отправлен.';
  } catch (error) {
    status.textContent = toPublicReviewError(error.message);
  }
  return false;
};
</script>
</body>
</html>`;
}

function catalogCountWord(n) {
  const x = Math.abs(Number(n) || 0) % 100;
  const y = x % 10;
  return x > 10 && x < 20 ? 'кошек' : y === 1 ? 'кошка' : y > 1 && y < 5 ? 'кошки' : 'кошек';
}

function renderCatalogLocationOptions(animals = []) {
  const locations = [...new Map(
    animals
      .filter((cat) => cat.location)
      .map((cat) => [cat.location, cat.location_label || cat.location])
  ).entries()].sort((a, b) => a[1].localeCompare(b[1], 'ru'));
  return locations.map(([value, label]) => `<option value="${escapeTelegramHtml(value)}">${escapeTelegramHtml(label)}</option>`).join('');
}

function renderCatalogCardsHtml(animals = [], options = {}) {
  const profilePath = options.profilePath || '/';
  if (!animals.length) {
    return '<div class="empty"><strong>Никого не нашли</strong>Попробуйте открыть каталог чуть позже.</div>';
  }
  return animals.map((cat, index) => {
    const photo = cat.photo_url || '';
    const imageAttrs = index < 6
      ? ` loading="eager"${index === 0 ? ' fetchpriority="high"' : ''} decoding="async"`
      : ' loading="lazy" decoding="async"';
    const photoSrcSet = photo ? buildAssetSrcSet(photo, [240, 360, 480, 720]) : '';
    return `<a class="cat" href="${escapeTelegramHtml(profilePath)}?animal=${encodeURIComponent(cat.id)}"><div class="image-wrap">` +
      (photo ? `<img src="${escapeTelegramHtml(photo)}" srcset="${escapeTelegramHtml(photoSrcSet)}" sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw" alt="${escapeTelegramHtml(cat.name || 'Кошка')}"${imageAttrs}>` : '<div class="no-photo">🐈</div>') +
      `<span class="badge">${escapeTelegramHtml(cat.status_label || '')}</span></div><div class="body"><div class="name-row"><h2 class="name">${escapeTelegramHtml(cat.name || 'Без имени')}</h2><span class="arrow">↗</span></div><div class="facts">` +
      (cat.sex_label ? `<span class="fact">${escapeTelegramHtml(cat.sex_label)}</span>` : '') +
      (cat.age ? `<span class="fact">${escapeTelegramHtml(cat.age)}</span>` : '') +
      (cat.location_label ? `<span class="fact">${escapeTelegramHtml(cat.location_label)}</span>` : '') +
      `</div>${cat.short_description ? `<p class="desc">${escapeTelegramHtml(cat.short_description)}</p>` : ''}</div></a>`;
  }).join('');
}

function catalogWebAppHtml(payload = null, options = {}) {
  const title = 'Каталог кошек Котокафе — познакомьтесь с хвостатыми подопечными';
  const description = 'Выберите кошку из Котокафе: анкеты, фото, характер, здоровье, история, отзывы и способы помочь хвостатым подопечным.';
  const canonicalUrl = buildCatalogWebAppUrl() || publicUrl('/');
  const imageUrl = publicUrl('/og-cats.png');
  const animals = payload?.animals || [];
  const profilePath = options.profilePath || '/';
  const initialPayloadScript = payload ? `window.__CATALOG_INITIAL_PAYLOAD=${inlineScriptJson(payload)};` : '';
  const structuredData = catalogStructuredData(animals, { baseUrl: profilePath ? publicUrl(profilePath) : canonicalUrl, name: title });
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/favicon.png">
<meta name="theme-color" content="#f7f1e8">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="robots" content="index,follow">
${canonicalUrl ? `<link rel="canonical" href="${canonicalUrl}">` : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Котокафе">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
${canonicalUrl ? `<meta property="og:url" content="${canonicalUrl}">` : ''}
${imageUrl ? `<meta property="og:image" content="${imageUrl}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Котокафе — каталог кошек">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
${imageUrl ? `<meta name="twitter:image" content="${imageUrl}">` : ''}
${structuredData ? jsonLdScript(structuredData) : ''}
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<link rel="stylesheet" href="/cat-catalog.css?v=${CAT_CATALOG_ASSET_VERSION}">
</head>
<body>
${renderYandexMetrikaCounter()}
<main class="shell">
  <nav class="catalog-topnav" aria-label="Основное меню">
    <a class="catalog-toplink" href="https://kotocafe.ru" target="_blank" rel="noopener">Котокафе</a>
    <a class="catalog-toplink" href="https://kotocafe.ru/fond/" target="_blank" rel="noopener">Фонд</a>
  </nav>
  <header class="hero"><div class="kicker">Котокафе</div><h1>Здесь живёт<br>ваша кошка</h1><p>Познакомьтесь с нашими хвостатыми подопечными. Возможно, одна из этих историй станет вашей общей.</p></header>
  <section class="toolbar" aria-label="Поиск и фильтры">
    <label class="search"><input id="search" type="search" placeholder="Найти по имени" autocomplete="off" aria-label="Найти кошку по имени"></label>
    <div class="filters">
      <select id="status" class="filter" aria-label="Статус"><option value="">Все статусы</option><option value="looking_home">Ищет дом</option><option value="meeting">На знакомстве</option><option value="reserved">Забронирована</option><option value="adopted">Уже дома</option></select>
      <select id="location" class="filter" aria-label="Котокафе"><option value="">Все котокафе</option>${renderCatalogLocationOptions(animals)}</select>
    </div>
  </section>
  <div class="meta"><div id="count" class="count">${animals.length ? `Найдено ${animals.length} ${catalogCountWord(animals.length)}` : 'Загружаем кошек…'}</div><div class="hint">Нажмите на карточку, чтобы открыть анкету</div></div>
  <section id="grid" class="grid">${animals.length ? renderCatalogCardsHtml(animals, { profilePath }) : '<div class="loading">Собираем хвосты и усы…</div>'}</section>
  <footer class="footer">Каждой кошке нужен свой человек</footer>
</main>
<script>${initialPayloadScript}</script>
<script src="/cat-catalog.js?v=${CAT_CATALOG_ASSET_VERSION}"></script>
</body>
</html>`;
}

function prospektMiraLandingHtml(payload = null) {
  const title = 'Котокафе на Проспекте Мира';
  const description = 'Котокафе Котики и Люди на Проспекте Мира: часы работы, адрес, бронирование и кошки этой площадки.';
  const canonicalUrl = publicUrl('/1');
  const imageUrl = publicUrl('/og-cats.png');
  const bookingUrl = 'https://murchashka.restoplace.ws';
  const mapUrl = KOTOCAFE_MAP.prospekt_mira.mapUrl;
  const catalogUrl = buildCatalogWebAppUrl() || publicUrl('/');
  const tildaLogoUrl = '/pm-logo-stamp.png';
  const tildaHeroA = '/pm-hero-a.jpeg';
  const tildaHeroB = '/pm-hero-b.jpeg';
  const tildaHeroC = '/pm-hero-c.jpeg';
  const animals = Array.isArray(payload?.animals)
    ? payload.animals
      .filter((cat) => cat?.location === 'prospekt_mira')
      .sort((a, b) => {
        const aHome = a?.status === 'looking_home' ? 0 : 1;
        const bHome = b?.status === 'looking_home' ? 0 : 1;
        if (aHome !== bHome) return aHome - bHome;
        return String(a?.name || '').localeCompare(String(b?.name || ''), 'ru');
      })
    : [];
  const heroPhoto = animals[0]?.photo_url ? escapeTelegramHtml(animals[0].photo_url) : '';
  const heroPhotoSrcSet = heroPhoto ? escapeTelegramHtml(buildAssetSrcSet(heroPhoto, [480, 720, 960, 1200])) : '';
  const heroPhotoPreload = heroPhoto
    ? `<link rel="preload" as="image" href="${heroPhoto}" imagesrcset="${heroPhotoSrcSet}" imagesizes="(max-width: 980px) 100vw, 540px">`
    : '';
  const structuredData = catalogStructuredData(animals, { baseUrl: publicUrl('/'), name: title });
  const cardsHtml = animals.length
    ? animals.slice(0, 8).map((cat, index) => {
      const photo = cat.photo_url || '';
      const imageAttrs = index < 4 ? ` loading="eager"${index === 0 ? ' fetchpriority="high"' : ''} decoding="async"` : ' loading="lazy" decoding="async"';
      const photoSrcSet = photo ? buildAssetSrcSet(photo, [240, 360, 480, 720]) : '';
      return `<a class="pm-cat-card" href="/?animal=${encodeURIComponent(cat.id)}">` +
        `<div class="pm-cat-card__media">` +
        (photo ? `<img src="${escapeTelegramHtml(photo)}" srcset="${escapeTelegramHtml(photoSrcSet)}" sizes="(max-width: 980px) 100vw, 280px" alt="${escapeTelegramHtml(cat.name || 'Кошка')}"${imageAttrs}>` : '<div class="pm-cat-card__placeholder">🐈</div>') +
        `<span class="pm-cat-card__badge">${escapeTelegramHtml(cat.status_label || 'Кошка')}</span>` +
        `</div>` +
        `<div class="pm-cat-card__body">` +
        `<h3>${escapeTelegramHtml(cat.name || 'Без имени')}</h3>` +
        `<div class="pm-cat-card__facts">` +
        (cat.sex_label ? `<span>${escapeTelegramHtml(cat.sex_label)}</span>` : '') +
        (cat.age ? `<span>${escapeTelegramHtml(cat.age)}</span>` : '') +
        `</div>` +
        (cat.short_description ? `<p>${escapeTelegramHtml(cat.short_description)}</p>` : '') +
        `</div>` +
        `</a>`;
    }).join('')
    : '<div class="pm-empty">Сейчас список кошек обновляется. Попробуйте открыть страницу чуть позже.</div>';

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/favicon.png">
<meta name="theme-color" content="#f6efe5">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="robots" content="index,follow">
${canonicalUrl ? `<link rel="canonical" href="${canonicalUrl}">` : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Котокафе">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
${canonicalUrl ? `<meta property="og:url" content="${canonicalUrl}">` : ''}
${imageUrl ? `<meta property="og:image" content="${imageUrl}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
${imageUrl ? `<meta name="twitter:image" content="${imageUrl}">` : ''}
${heroPhotoPreload}
${structuredData ? jsonLdScript(structuredData) : ''}
<style>
:root{
  --bg:#f6efe5;
  --paper:#fffaf4;
  --text:#241712;
  --muted:#69564a;
  --line:#e8d8c7;
  --accent:#d4634f;
  --accent-dark:#b84e3e;
  --chip:#f1e3d3;
  --shadow:0 20px 50px rgba(62,36,21,.12);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:Arial,sans-serif;color:var(--text);background:
radial-gradient(circle at top left, rgba(212,99,79,.18), transparent 28%),
radial-gradient(circle at right 20%, rgba(183,149,110,.18), transparent 24%),
linear-gradient(180deg, #fcf7f1 0%, var(--bg) 100%)}
a{color:inherit}
.pm-shell{width:min(1180px,calc(100% - 32px));margin:0 auto;padding:24px 0 56px}
.pm-topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px}
.pm-brand{display:flex;align-items:center;gap:14px;font-size:14px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.pm-brand img{width:44px;height:44px;object-fit:contain;filter:drop-shadow(0 6px 10px rgba(36,23,18,.12))}
.pm-toplinks{display:flex;gap:12px;flex-wrap:wrap}
.pm-link{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 16px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.72);text-decoration:none}
.pm-link--accent{background:var(--accent);border-color:var(--accent);color:#fff}
.pm-hero{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(320px,.9fr);gap:24px;align-items:stretch}
.pm-card{background:rgba(255,250,244,.88);border:1px solid rgba(232,216,199,.9);border-radius:32px;box-shadow:var(--shadow);backdrop-filter:blur(8px)}
.pm-copy{padding:34px}
.pm-kicker{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:var(--chip);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.pm-copy h1{margin:18px 0 14px;font-size:clamp(40px,6vw,72px);line-height:.94;letter-spacing:-.04em}
.pm-copy p{margin:0;max-width:34rem;font-size:18px;line-height:1.6;color:var(--muted)}
.pm-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px}
.pm-button{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:0 22px;border-radius:999px;background:var(--text);color:#fff;text-decoration:none;font-weight:700}
.pm-button--accent{background:var(--accent)}
.pm-hero-visual{position:relative;overflow:hidden;padding:22px;min-height:420px;background:
linear-gradient(180deg, rgba(255,255,255,.46), rgba(255,255,255,.12)),
linear-gradient(135deg, #f6e6d3 0%, #e6b58d 100%)}
.pm-photo-stack{position:relative;z-index:1;height:100%;min-height:376px}
.pm-photo{position:absolute;overflow:hidden;background:rgba(255,255,255,.44);box-shadow:0 18px 44px rgba(55,30,15,.18)}
.pm-photo img{width:100%;height:100%;display:block;object-fit:cover}
.pm-photo--main{inset:34px 70px 34px 18px;border-radius:28px;transform:rotate(-2deg)}
.pm-photo--a{top:18px;right:14px;width:112px;height:112px;border-radius:24px;transform:rotate(7deg)}
.pm-photo--b{bottom:24px;left:0;width:132px;height:132px;border-radius:28px;transform:rotate(-7deg)}
.pm-photo--stamp{position:absolute;right:22px;bottom:28px;width:72px;height:72px;object-fit:contain;filter:drop-shadow(0 8px 14px rgba(36,23,18,.18));z-index:2}
.pm-photo--empty{display:grid;place-items:center;font-size:72px;color:rgba(36,23,18,.45)}
.pm-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:24px 0 0}
.pm-fact{padding:18px;border:1px solid var(--line);border-radius:22px;background:rgba(255,255,255,.72)}
.pm-fact strong{display:block;margin-bottom:8px;font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.pm-fact span{font-size:18px;line-height:1.45}
.pm-section{margin-top:24px}
.pm-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:24px}
.pm-panel{padding:28px}
.pm-panel h2{margin:0 0 14px;font-size:32px;line-height:1.02;letter-spacing:-.03em}
.pm-panel p{margin:0 0 14px;font-size:17px;line-height:1.65;color:var(--muted)}
.pm-list{display:grid;gap:10px;margin-top:18px}
.pm-list div{padding:14px 16px;border-radius:18px;background:var(--paper);border:1px solid var(--line);font-size:16px;line-height:1.5}
.pm-note{display:inline-flex;align-items:center;gap:8px;margin-top:18px;padding:10px 14px;border-radius:999px;background:rgba(255,255,255,.72);border:1px solid var(--line);font-size:13px;font-weight:700;color:var(--muted)}
.pm-cats-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:18px}
.pm-cats-head h2{margin:0;font-size:34px;line-height:1}
.pm-cats-head p{margin:0;color:var(--muted)}
.pm-cats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
.pm-cat-card{display:block;overflow:hidden;border-radius:24px;background:var(--paper);border:1px solid var(--line);text-decoration:none;transition:transform .18s ease, box-shadow .18s ease}
.pm-cat-card:hover{transform:translateY(-2px);box-shadow:0 16px 34px rgba(62,36,21,.10)}
.pm-cat-card__media{position:relative;aspect-ratio:1/1;background:#ead7c4}
.pm-cat-card__media img{width:100%;height:100%;display:block;object-fit:cover}
.pm-cat-card__placeholder{display:grid;place-items:center;height:100%;font-size:52px;color:rgba(36,23,18,.42)}
.pm-cat-card__badge{position:absolute;left:12px;top:12px;padding:8px 10px;border-radius:999px;background:rgba(255,250,244,.92);font-size:12px;font-weight:700}
.pm-cat-card__body{padding:16px}
.pm-cat-card__body h3{margin:0 0 10px;font-size:24px;line-height:1}
.pm-cat-card__facts{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}
.pm-cat-card__facts span{display:inline-flex;align-items:center;min-height:28px;padding:0 10px;border-radius:999px;background:var(--chip);font-size:12px;font-weight:700;color:var(--muted)}
.pm-cat-card__body p{margin:0;color:var(--muted);font-size:14px;line-height:1.5}
.pm-empty{padding:26px;border-radius:24px;background:var(--paper);border:1px dashed var(--line);color:var(--muted)}
.pm-footer{margin-top:28px;padding:22px 8px 0;color:var(--muted);font-size:14px;line-height:1.6;text-align:center}
@media (max-width: 980px){
  .pm-hero,.pm-grid{grid-template-columns:1fr}
  .pm-facts{grid-template-columns:1fr}
  .pm-cats-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width: 640px){
  .pm-shell{width:min(100% - 20px,1180px);padding-top:16px}
  .pm-topbar,.pm-cats-head{align-items:flex-start;flex-direction:column}
  .pm-copy,.pm-panel,.pm-hero-visual{padding:20px}
  .pm-copy p,.pm-panel p{font-size:16px}
  .pm-photo--main{inset:48px 34px 24px 8px}
  .pm-photo--a{width:92px;height:92px;top:8px;right:2px}
  .pm-photo--b{width:108px;height:108px;bottom:8px}
  .pm-photo--stamp{width:60px;height:60px;right:12px;bottom:16px}
  .pm-cats-grid{grid-template-columns:1fr}
}
</style>
</head>
<body>
${renderYandexMetrikaCounter()}
<main class="pm-shell">
  <div class="pm-topbar">
    <div class="pm-brand"><img src="${escapeTelegramHtml(tildaLogoUrl)}" alt=""><span>Котокафе Котики и Люди</span></div>
    <div class="pm-toplinks">
      <a class="pm-link" href="${escapeTelegramHtml(catalogUrl || '/')}">Все кошки</a>
      <a class="pm-link pm-link--accent" href="${escapeTelegramHtml(bookingUrl)}" target="_blank" rel="noopener">Бронь</a>
    </div>
  </div>

  <section class="pm-hero">
    <div class="pm-card pm-copy">
      <div class="pm-kicker">Проспект Мира</div>
      <h1>Котокафе<br>Котики и Люди</h1>
      <p>Первое котокафе в Москве, успевшее стать культовым. Сохранили знакомое настроение старой страницы, но теперь всё работает на нашем домене и без Tilda.</p>
      <div class="pm-actions">
        <a class="pm-button pm-button--accent" href="${escapeTelegramHtml(bookingUrl)}" target="_blank" rel="noopener">Забронировать</a>
        <a class="pm-button" href="${escapeTelegramHtml(mapUrl)}" target="_blank" rel="noopener">Открыть карту</a>
      </div>
      <div class="pm-note">с 12:00 до 22:00</div>
      <div class="pm-facts">
        <div class="pm-fact"><strong>Адрес</strong><span>Москва, Гиляровского, 17</span></div>
        <div class="pm-fact"><strong>Часы</strong><span>Ежедневно с 12:00 до 22:00</span></div>
        <div class="pm-fact"><strong>Как добраться</strong><span>7 минут пешком от метро Проспект Мира или Сухаревская</span></div>
      </div>
    </div>
    <div class="pm-card pm-hero-visual">
      <div class="pm-photo-stack">
        <div class="pm-photo pm-photo--main${heroPhoto ? '' : ' pm-photo--empty'}">
          ${heroPhoto ? `<img src="${heroPhoto}" srcset="${heroPhotoSrcSet}" sizes="(max-width: 980px) 100vw, 540px" alt="Кошка из Котокафе на Проспекте Мира" fetchpriority="high">` : '🐾'}
        </div>
        <div class="pm-photo pm-photo--a"><img src="${escapeTelegramHtml(tildaHeroA)}" alt="" loading="lazy" decoding="async"></div>
        <div class="pm-photo pm-photo--b"><img src="${escapeTelegramHtml(tildaHeroB)}" alt="" loading="lazy" decoding="async"></div>
        <div class="pm-photo pm-photo--a" style="top:auto;bottom:138px;right:18px;width:96px;height:96px;transform:rotate(5deg)"><img src="${escapeTelegramHtml(tildaHeroC)}" alt="" loading="lazy" decoding="async"></div>
        <img class="pm-photo--stamp" src="${escapeTelegramHtml(tildaLogoUrl)}" alt="" loading="lazy" decoding="async">
      </div>
    </div>
  </section>

  <section class="pm-section pm-grid">
    <article class="pm-card pm-panel">
      <h2>Как устроен визит</h2>
      <p>По выходным и праздникам бронировать лучше заранее. Обычно гости проводят у нас около полутора часов, платят в среднем около 900 рублей за визит с человека и спокойно знакомятся с котами.</p>
      <p> котокафе вас ждут чай, кофе, печенье и конфеты. Еду и безалкогольные напитки можно принести с собой или заказать доставку прямо на адрес котокафе.</p>
      <div class="pm-list">
        <div><strong>Средний чек:</strong> около 900 рублей за визит с человека.</div>
        <div><strong>Угощения:</strong> чай, кофе, печенье и конфеты уже ждут в гостевой зоне.</div>
        <div><strong>Главное правило:</strong> не пугать и не обижать кошек.</div>
      </div>
    </article>
    <aside class="pm-card pm-panel">
      <h2>Знакомое место, новый домен</h2>
      <p>Это не просто кафе, а место встречи с кошками, которым нужен дом и бережное внимание. Визуально страница осталась близкой к прежней, но теперь полностью обслуживается нашим приложением.</p>
      <div class="pm-list">
        <div><strong>Познакомиться лично:</strong> часть кошек из карточек ниже живёт именно на этой площадке.</div>
        <div><strong>Открыть анкету:</strong> в карточке есть история, фото, здоровье и способы помочь.</div>
        <div><strong>Если нужен полный список:</strong> каталог на cats.kotocafe.ru показывает всех подопечных.</div>
      </div>
    </aside>
  </section>

  <section class="pm-section">
    <div class="pm-cats-head">
      <div>
        <h2>Кошки этой площадки</h2>
        <p>${animals.length ? `Сейчас на Проспекте Мира показываем ${animals.length} ${catalogCountWord(animals.length)}.` : 'Подгружаем список кошек этой площадки.'}</p>
      </div>
      <a class="pm-link" href="${escapeTelegramHtml(catalogUrl || '/')}">Открыть весь каталог</a>
    </div>
    <div class="pm-cats-grid">${cardsHtml}</div>
  </section>

  <div class="pm-footer">
    <div>Телефон: <a href="tel:+74954887002">+7 495 488-70-02</a> • Почта: <a href="mailto:kotiki@kotocafe.ru">kotiki@kotocafe.ru</a></div>
    <div>Страница перенесена на ${escapeTelegramHtml(canonicalUrl || 'cats.kotocafe.ru/1')} и больше не зависит от Tilda.</div>
  </div>
</main>
</body>
</html>`;
}


function publicAnimalDto(animal) {
  if (!animal) return null;
  return {
    id: animal.id,
    name: animal.name || null,
    slug: animal.slug || null,
    status: animal.status || null,
    location: animal.location || null,
    sex: animal.sex || null,
    birth_date: animal.birth_date || null,
    birth_date_approximate: animal.birth_date_approximate === true,
    color: animal.color || null,
    color_note: animal.color_note || null,
    good_with_cats: animal.good_with_cats ?? null,
    good_with_dogs: animal.good_with_dogs ?? null,
    good_with_children: animal.good_with_children ?? null,
    vaccinated: animal.vaccinated ?? null,
    sterilized: animal.sterilized ?? null,
    chipped: animal.chipped ?? null,
    parasite_treated: animal.parasite_treated ?? null,
    short_description: animal.short_description || null,
    story: animal.story || null,
    health_comment: animal.health_comment || null,
    character_comment: animal.character_comment || null,
    adoption_requirements_other: animal.adoption_requirements_other || null,
  };
}

function publicNeedDto(need) {
  if (!need) return null;
  return {
    title: String(need.title || '').trim() || 'Нужда',
    url: safeExternalUrl(need.url),
  };
}

function publicDonationDto(donation) {
  if (!donation) return null;
  const { date } = donationDateParts(donation);
  return {
    amount: donationAmountText(donation),
    donor: donationDonorText(donation),
    comment: donationCommentText(donation),
    date,
  };
}

function publicDonationSummary(animal, donations) {
  const total = (donations || []).reduce((sum, donation) => {
    const amount = Number(String(donation?.amount ?? donation?.amount_rub ?? donation?.sum ?? donation?.total ?? 0).replace(',', '.'));
    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0);
  const explicitTotal = Number(String(animal?.donation_total ?? '').replace(',', '.'));
  const explicitCount = Number(animal?.donation_count);
  return {
    total: Number.isFinite(explicitTotal) ? formatRub(explicitTotal) : (total > 0 ? formatRub(total) : null),
    count: Number.isFinite(explicitCount) ? explicitCount : (donations || []).length,
  };
}

function assetUrl(fileId, options = {}) {
  const id = String(fileId || '').trim();
  if (!id) return null;
  const params = new URLSearchParams({ id });
  const width = Number(options.width || 0);
  if (Number.isFinite(width) && width >= 120 && width <= 2000) params.set('w', String(Math.round(width)));
  const format = String(options.format || '').trim().toLowerCase();
  if (['webp', 'jpg', 'jpeg', 'png'].includes(format)) params.set('format', format);
  return `/api/asset?${params.toString()}`;
}

function inlineScriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function jsonLdScript(value) {
  if (!value) return '';
  return `<script type="application/ld+json">${inlineScriptJson(value)}</script>`;
}

function animalStructuredData(payload, meta = {}) {
  const animal = payload?.animal || {};
  const name = String(payload?.name || animal?.name || '').trim();
  if (!name) return null;
  const image = payload.main_photo_url ? publicUrl(payload.main_photo_url) : null;
  const additionalProperty = [
    payload.sex_label ? { '@type': 'PropertyValue', name: 'Пол', value: payload.sex_label } : null,
    payload.age ? { '@type': 'PropertyValue', name: 'Возраст', value: payload.age } : null,
    payload.location_label ? { '@type': 'PropertyValue', name: 'Локация', value: payload.location_label } : null,
    payload.status_label ? { '@type': 'PropertyValue', name: 'Статус', value: payload.status_label } : null,
  ].filter(Boolean);

  return {
    '@context': 'https://schema.org',
    '@type': 'Thing',
    name,
    description: meta.description || payload.human_lead || payload.short_description || animal.short_description || '',
    url: meta.canonicalUrl || publicUrl('/'),
    image: image ? [image] : undefined,
    additionalProperty: additionalProperty.length ? additionalProperty : undefined,
    isPartOf: {
      '@type': 'AnimalShelter',
      name: 'Котокафе',
      url: buildCatalogWebAppUrl() || publicUrl('/'),
    },
  };
}

function catalogStructuredData(animals = [], options = {}) {
  const baseUrl = String(options.baseUrl || publicUrl('/')).trim();
  const items = (animals || [])
    .filter((cat) => cat?.id && cat?.name)
    .map((cat, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}animal=${encodeURIComponent(cat.id)}`,
      item: {
        '@type': 'Thing',
        name: cat.name,
        image: cat.photo_url ? [publicUrl(cat.photo_url)] : undefined,
        description: cat.short_description || cat.status_label || '',
      },
    }));

  if (!items.length) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: options.name || 'Каталог кошек Котокафе',
    itemListElement: items,
  };
}

function selectRelatedWebAnimals(catalogAnimals, currentAnimalId, limit = 4) {
  const currentId = String(currentAnimalId || '');
  const candidates = (catalogAnimals || [])
    .filter((animal) => String(animal?.id || '') !== currentId && animal?.photo_url);
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, limit);
}

async function getRelatedWebAnimals(animalId) {
  try {
    const record = await getCachedWebCatalogPayload();
    return selectRelatedWebAnimals(record?.payload?.animals, animalId, 4);
  } catch (error) {
    console.error('WEB RELATED CATS ERROR:', error.response?.data || error.message);
    return [];
  }
}

async function buildWebAnimalPayloadUncached(animalId) {
  const animal = await getAnimalById(animalId);
  if (!isAnimalPublicForWeb(animal)) return null;

  const [needs, donations, photoRows, videoRows, avatarRows, relatedAnimals, publicReviews] = await Promise.all([
    getActiveAnimalNeeds(animal.id),
    getAnimalSuccessfulDonations(animal.id, 5),
    getAnimalMedia(animal.id, 'photo', 10),
    getAnimalMedia(animal.id, 'video', 10),
    getAnimalMedia(animal.id, 'avatar', 1),
    getRelatedWebAnimals(animal.id),
    animalReviews.getPublicReviews(animal.id, 500),
  ]);
  const orderedVideoRows = [...(videoRows || [])].sort((a, b) => {
    const mainDelta = Number(Boolean(b?.is_main)) - Number(Boolean(a?.is_main));
    if (mainDelta) return mainDelta;
    return Number(a?.sort || 0) - Number(b?.sort || 0);
  });
  const photoIds = getAnimalMediaFileIds(photoRows);
  const mainPhotoId = extractFileId((photoRows || []).find((row) => row.is_main)?.file_id) || photoIds[0] || null;
  const mainPhotoUrl = mainPhotoId ? assetUrl(mainPhotoId, { width: 1200, format: 'webp' }) : null;
  const avatarFileId = extractFileId(avatarRows?.[0]?.file_id) || mainPhotoId || null;
  return {
    animal: publicAnimalDto(animal),
    needs: (needs || []).map(publicNeedDto).filter(Boolean),
    support_enabled: locationAllowsHelp(animal.location),
    donation_url: locationAllowsDonations(animal.location) && animal?.id ? `/donate?animal=${encodeURIComponent(animal.id)}` : '',
    feed_enabled: mixplatDonationsEnabled() && Boolean(animal?.id) && locationAllowsFeed(animal.location),
    feed_count: Number.isFinite(Number(animal?.feed_count)) ? Number(animal.feed_count) : 0,
    review_count: Array.isArray(publicReviews) ? publicReviews.length : 0,
    donation_summary: locationAllowsHelp(animal.location) ? publicDonationSummary(animal, donations) : {},
    donations: locationAllowsHelp(animal.location) ? (donations || []).map(publicDonationDto).filter(Boolean) : [],
    status_label: formatStatus(animal.status),
    location_label: formatLocation(animal.location),
    sex_label: formatSex(animal.sex),
    age: ageFromBirthDate(animal.birth_date),
    human_age: humanAgeFromBirthDate(animal.birth_date),
    color_label: animal.color || animal.color_note ? colorLabel(animal.color, animal.color_note) : null,
    human_lead: animalHumanLead(animal),
    life_lead: animalLifeLead(animal),
    health_lead: animalHealthLead(animal),
    adoption_requirements: adoptionRequirementsText(animal),
    cafe_visit: buildCafeVisitPayload(animal.location),
    avatar_url: avatarFileId ? assetUrl(avatarFileId, { width: 160, format: 'webp' }) : null,
    avatar_full_url: avatarFileId ? assetUrl(avatarFileId, { format: 'webp' }) : null,
    main_photo_url: mainPhotoUrl,
    main_photo_full_url: mainPhotoId ? assetUrl(mainPhotoId, { format: 'webp' }) : null,
    photos: photoIds.map((fileId) => assetUrl(fileId, { width: 480, format: 'webp' })).filter(Boolean),
    full_photos: photoIds.map((fileId) => assetUrl(fileId, { format: 'webp' })).filter(Boolean),
    related_animals: relatedAnimals,
    videos: orderedVideoRows.map((row, index) => {
      const sources = publicVideoSources(row);
      return sources.length ? {
        url: sources[0].url,
        sources,
        caption: row.caption || `Видео ${index + 1}`,
        poster_url: null,
      } : null;
    }).filter(Boolean),
  };
}

function webAnimalCacheFile(animalId) {
  const id = String(animalId || '').replace(/[^0-9a-f-]/gi, '').toLowerCase();
  return path.join(WEB_ANIMAL_CACHE_DIR, `${id || 'unknown'}.json`);
}

function webAnimalCacheRecordFromPayload(payload) {
  const json = JSON.stringify(payload);
  return {
    payload,
    json,
    etag: `"${crypto.createHash('sha256').update(json).digest('base64url')}"`,
  };
}

async function readWebAnimalDiskCache(animalId) {
  try {
    const file = webAnimalCacheFile(animalId);
    const stat = await fs.promises.stat(file);
    if (Date.now() - stat.mtimeMs > WEB_ANIMAL_DISK_CACHE_TTL_MS) return null;
    const json = await fs.promises.readFile(file, 'utf8');
    const payload = JSON.parse(json);
    if (payload?.donation_url && !String(payload.donation_url).includes('/donate?animal=')) return null;
    if (mixplatDonationsEnabled() && !Object.prototype.hasOwnProperty.call(payload || {}, 'feed_enabled')) return null;
    return webAnimalCacheRecordFromPayload(payload);
  } catch (_) {
    return null;
  }
}

async function writeWebAnimalDiskCache(animalId, payload) {
  try {
    await fs.promises.mkdir(WEB_ANIMAL_CACHE_DIR, { recursive: true });
    await fs.promises.writeFile(webAnimalCacheFile(animalId), JSON.stringify(payload), 'utf8');
  } catch (error) {
    console.error('WEB ANIMAL DISK CACHE WRITE ERROR:', error.message);
  }
}

async function getCachedWebAnimalPayload(animalId) {
  const key = String(animalId || '').trim();
  if (!key) return null;
  const cached = webAnimalPayloadCache.get(key);
  if (cached) {
    // Map одновременно служит простым LRU: недавно открытые анкеты остаются дольше.
    webAnimalPayloadCache.delete(key);
    webAnimalPayloadCache.set(key, cached);
    return cached;
  }

  const diskRecord = await readWebAnimalDiskCache(key);
  if (diskRecord) {
    webAnimalPayloadCache.set(key, Promise.resolve(diskRecord));
    return diskRecord;
  }

  const pending = buildWebAnimalPayloadUncached(key)
    .then((payload) => {
      if (!payload) {
        webAnimalPayloadCache.delete(key);
        return null;
      }
      writeWebAnimalDiskCache(key, payload);
      return webAnimalCacheRecordFromPayload(payload);
    })
    .catch((error) => {
      webAnimalPayloadCache.delete(key);
      throw error;
    });

  webAnimalPayloadCache.set(key, pending);
  while (webAnimalPayloadCache.size > WEB_ANIMAL_PAYLOAD_CACHE_MAX) {
    const oldestKey = webAnimalPayloadCache.keys().next().value;
    if (oldestKey === undefined) break;
    webAnimalPayloadCache.delete(oldestKey);
  }
  return pending;
}

async function buildWebCatalogPayload() {
  const animals = await directusGet('animals', {
    filter: { published: { _eq: true } },
    fields: 'id,name,status,location,sex,birth_date,short_description,published',
    sort: 'name',
    limit: 200,
  });
  const publicAnimals = (animals || []).filter(isAnimalPublicForWeb);
  const ids = publicAnimals.map((animal) => animal.id);
  let mediaRows = [];

  if (ids.length) {
    mediaRows = await directusGet('animal_media', {
      filter: {
        animal_id: { _in: ids },
        type: { _eq: 'photo' },
      },
      fields: 'id,animal_id,file_id,is_main,sort',
      sort: 'animal_id,-is_main,sort',
      limit: Math.max(200, ids.length * 5),
    });
  }

  const photoByAnimal = new Map();
  for (const row of mediaRows || []) {
    const animalId = extractFileId(row.animal_id) || row.animal_id;
    const fileId = extractFileId(row.file_id);
    if (!animalId || !fileId || photoByAnimal.has(String(animalId))) continue;
    photoByAnimal.set(String(animalId), fileId);
  }

  return {
    animals: publicAnimals.map((animal) => {
      const photoId = photoByAnimal.get(String(animal.id));
      return {
        id: animal.id,
        name: animal.name || null,
        status: animal.status || null,
        status_label: formatStatus(animal.status),
        location: animal.location || null,
        location_label: formatLocation(animal.location),
        sex_label: formatSex(animal.sex),
        age: ageFromBirthDate(animal.birth_date),
        short_description: animal.short_description || null,
        photo_url: photoId ? assetUrl(photoId, { width: 720, format: 'webp' }) : null,
      };
    }),
  };
}

async function getCachedWebCatalogPayload() {
  if (webCatalogPayloadCache) return webCatalogPayloadCache;

  const diskRecord = await readWebCatalogDiskCache();
  if (diskRecord) {
    webCatalogPayloadCache = Promise.resolve(diskRecord);
    return webCatalogPayloadCache;
  }

  const pending = buildWebCatalogPayload()
    .then((payload) => {
      writeWebCatalogDiskCache(payload);
      return webCatalogCacheRecordFromPayload(payload);
    })
    .catch((error) => {
      webCatalogPayloadCache = null;
      throw error;
    });

  webCatalogPayloadCache = pending;
  return pending;
}

function webCatalogCacheRecordFromPayload(payload) {
  const json = JSON.stringify(payload);
  return {
    payload,
    json,
    etag: `"${crypto.createHash('sha256').update(json).digest('base64url')}"`,
  };
}

async function readWebCatalogDiskCache() {
  try {
    const stat = await fs.promises.stat(WEB_CATALOG_CACHE_FILE);
    if (Date.now() - stat.mtimeMs > WEB_CATALOG_DISK_CACHE_TTL_MS) return null;
    const json = await fs.promises.readFile(WEB_CATALOG_CACHE_FILE, 'utf8');
    const payload = JSON.parse(json);
    return webCatalogCacheRecordFromPayload(payload);
  } catch (_) {
    return null;
  }
}

async function writeWebCatalogDiskCache(payload) {
  try {
    await fs.promises.mkdir(WEB_CACHE_DIR, { recursive: true });
    await fs.promises.writeFile(WEB_CATALOG_CACHE_FILE, JSON.stringify(payload), 'utf8');
  } catch (error) {
    console.error('WEB CATALOG DISK CACHE WRITE ERROR:', error.message);
  }
}

function warmWebCatalogPayloadCache() {
  getCachedWebCatalogPayload()
    .then((record) => console.log(`Web catalog cache warmed (${record.payload?.animals?.length || 0} animals)`))
    .catch((error) => console.error('WEB CATALOG CACHE WARM ERROR:', error.response?.data || error.message));
}

let shutdownRequested = false;
let retryTimer = null;
let resolveRetryWait = null;
let telegramReady = false;

async function directusReadyCheck() {
  await axios.get(`${DIRECTUS_URL}/items/animals`, {
    headers: apiHeaders(),
    params: { fields: 'id', limit: 1 },
    timeout: READY_CHECK_TIMEOUT_MS,
  });
  return true;
}

async function readinessPayload() {
  const checks = {
    process: true,
    telegram: telegramReady && !shutdownRequested,
    directus: false,
  };
  const errors = {};

  try {
    await directusReadyCheck();
    checks.directus = true;
  } catch (error) {
    errors.directus = error.response?.data?.errors?.[0]?.message || error.message || 'Directus is not ready';
  }

  const ok = Object.values(checks).every(Boolean);
  return {
    ok,
    service: 'cat-bot-webapp',
    checks,
    ...(Object.keys(errors).length ? { errors } : {}),
  };
}

function startWebAppServer() {
  const http = require('http');
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const requestPath = url.pathname.replace(/\/+$/, '') || '/';
      const mixplatWebhookPath = (process.env.MIXPLAT_WEBHOOK_PATH || '/mixplat/webhook').replace(/\/+$/, '') || '/mixplat/webhook';

      if (requestPath === mixplatWebhookPath) {
        return jsonResponse(res, 410, { error: 'mixplat_webhook_moved_to_kotocats_core' });
      }

      const apiPath = requestPath.replace(/^\/webapp(?=\/)/, '');

      if (kotocatsCore.coreModeEnabled()) {
        const coreRedirects = new Set([
          '/', '/webapp', '/catalog', '/webapp/catalog', '/donate', '/webapp/donate', '/success', '/webapp/success',
        ]);
        if (coreRedirects.has(requestPath)) {
          const animalId = url.searchParams.get('animal') || url.searchParams.get('id') || '';
          const target = requestPath.includes('donate')
            ? kotocatsCore.donateUrl(animalId)
            : requestPath.includes('success')
              ? kotocatsCore.successUrl(animalId, { kind: url.searchParams.get('kind') || '' })
              : animalId
                ? kotocatsCore.catPageUrl(animalId)
                : kotocatsCore.catalogUrl();
          if (target) {
            res.writeHead(302, { Location: target, 'Cache-Control': 'no-store' });
            return res.end();
          }
        }
        if (['/api/catalog', '/api/animal', '/api/donate', '/api/asset'].includes(apiPath)) {
          return jsonResponse(res, 410, { error: 'webapp_api_moved_to_kotocats_core' });
        }
      }

      if (animalReviews.route(req, res, url)) return;

      if (req.method === 'OPTIONS' && (apiPath === '/api/catalog' || apiPath === '/api/animal')) {
        res.writeHead(204, applyPublicApiCors(req));
        return res.end();
      }

      if (apiPath === '/health') {
        return jsonResponse(res, 200, { ok: true, service: 'cat-bot-webapp' });
      }

      if (apiPath === '/ready') {
        const payload = await readinessPayload();
        return jsonResponse(res, payload.ok ? 200 : 503, payload);
      }

      if (apiPath === '/api/cache/invalidate') {
        return handleCacheInvalidateWebhook(req, res, url);
      }

      if (apiPath === '/api/donate') {
        return handleWebDonateApi(req, res);
      }

      if (requestPath === '/cat-card.css' || requestPath === '/cat-card.js' || requestPath === '/cat-catalog.css' || requestPath === '/cat-catalog.js') {
        const minifiedAssetMap = {
          '/cat-card.css': 'cat-card.min.css',
          '/cat-card.js': 'cat-card.js',
          '/cat-catalog.css': 'cat-catalog.min.css',
          '/cat-catalog.js': 'cat-catalog.min.js',
        };
        const assetPath = path.join(__dirname, minifiedAssetMap[requestPath] || requestPath.slice(1));
        const buffer = await fs.promises.readFile(assetPath);
        res.writeHead(200, {
          'Content-Type': requestPath.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8',
          'Content-Length': buffer.length,
          'Cache-Control': 'public, max-age=86400',
        });
        return res.end(buffer);
      }

      if (requestPath === '/favicon.png' || requestPath === '/og-cats.png') {
        const imagePath = path.join(__dirname, requestPath.slice(1));
        const buffer = await fs.promises.readFile(imagePath);
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': buffer.length,
          'Cache-Control': 'public, max-age=86400',
        });
        return res.end(buffer);
      }

      if (requestPath === '/pm-logo-stamp.png' || requestPath === '/pm-hero-a.jpeg' || requestPath === '/pm-hero-b.jpeg' || requestPath === '/pm-hero-c.jpeg') {
        const imagePath = path.join(__dirname, requestPath.slice(1));
        const buffer = await fs.promises.readFile(imagePath);
        res.writeHead(200, {
          'Content-Type': requestPath.endsWith('.png') ? 'image/png' : 'image/jpeg',
          'Content-Length': buffer.length,
          'Cache-Control': 'public, max-age=86400',
        });
        return res.end(buffer);
      }

      if (requestPath === '/robots.txt') {
        const body = robotsTxtBody();
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'public, max-age=3600',
        });
        return res.end(body);
      }

      if (requestPath === '/sitemap.xml') {
        const body = await sitemapXmlBody();
        res.writeHead(200, {
          'Content-Type': 'application/xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'public, max-age=3600',
        });
        return res.end(body);
      }

      if (apiPath === '/api/asset') {
        const fileId = url.searchParams.get('id');
        if (!fileId) return jsonResponse(res, 400, { error: 'file id is required' });
        if (!(await assetBelongsToPublicAnimal(fileId))) return jsonResponse(res, 404, { error: 'asset not found' });

        const assetUrl = new URL(`${DIRECTUS_URL}/assets/${encodeURIComponent(fileId)}`);
        const width = Number(url.searchParams.get('w') || 0);
        const roundedWidth = Number.isFinite(width) && width >= 120 && width <= 2000 ? Math.round(width) : 0;
        const requestedFormat = String(url.searchParams.get('format') || '').trim().toLowerCase();
        const outputFormat = ['webp', 'jpg', 'jpeg', 'png'].includes(requestedFormat) ? requestedFormat : '';
        const responseCacheKey = roundedWidth
          ? `${fileId}:w${roundedWidth}${outputFormat ? `:f${outputFormat}` : ''}`
          : null;
        const cachedAsset = responseCacheKey ? webAssetResponseCache.get(responseCacheKey) : null;
        if (cachedAsset) {
          res.writeHead(200, {
            'Content-Type': cachedAsset.contentType,
            'Content-Length': cachedAsset.buffer.length,
            'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}`,
          });
          return res.end(cachedAsset.buffer);
        }

        const upstreamHeaders = apiHeaders();
        if (!roundedWidth && req.headers.range) upstreamHeaders.Range = req.headers.range;

        const upstream = await axios.get(assetUrl.toString(), {
          headers: upstreamHeaders,
          responseType: roundedWidth || outputFormat ? 'arraybuffer' : 'stream',
          timeout: 30000,
          validateStatus: (status) => status >= 200 && status < 300,
        });

        if (roundedWidth || outputFormat) {
          const sourceBuffer = Buffer.from(upstream.data);
          const transform = sharp(sourceBuffer, { animated: false });
          if (roundedWidth) {
            transform.resize({
              width: roundedWidth,
              fit: 'cover',
              withoutEnlargement: true,
            });
          }
          if (outputFormat === 'webp') transform.webp({ quality: 78 });
          else if (outputFormat === 'png') transform.png({ quality: 78 });
          else if (outputFormat === 'jpeg' || outputFormat === 'jpg') transform.jpeg({ quality: 78 });

          const { data, info } = await transform.toBuffer({ resolveWithObject: true });
          const buffer = Buffer.from(data);
          const contentType = sharpFormatToContentType(info?.format);
          webAssetResponseCache.set(responseCacheKey, { buffer, contentType });
          while (webAssetResponseCache.size > WEB_ASSET_RESPONSE_CACHE_MAX) {
            const oldestKey = webAssetResponseCache.keys().next().value;
            if (oldestKey === undefined) break;
            webAssetResponseCache.delete(oldestKey);
          }
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': buffer.length,
            'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}`,
          });
          return res.end(buffer);
        }

        let contentType = upstream.headers['content-type'] || 'application/octet-stream';
        if (!roundedWidth && (!contentType || contentType === 'application/octet-stream')) {
          try {
            const fileMeta = await getDirectusFileMetadata(fileId);
            contentType = fileMeta?.type && fileMeta.type !== 'application/octet-stream'
              ? fileMeta.type
              : inferAssetContentType(fileMeta?.filename_download) || contentType;
          } catch (error) {
            console.error('WEBAPP ASSET METADATA ERROR:', error.response?.data || error.message);
          }
        }

        const responseHeaders = {
          'Content-Type': contentType,
          'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}`,
          'Accept-Ranges': upstream.headers['accept-ranges'] || 'bytes',
        };
        if (upstream.headers['content-length']) responseHeaders['Content-Length'] = upstream.headers['content-length'];
        if (upstream.headers['content-range']) responseHeaders['Content-Range'] = upstream.headers['content-range'];
        if (upstream.headers.etag) responseHeaders.ETag = upstream.headers.etag;
        if (upstream.headers['last-modified']) responseHeaders['Last-Modified'] = upstream.headers['last-modified'];

        res.writeHead(upstream.status || 200, responseHeaders);

        upstream.data.on('error', (error) => {
          console.error('WEBAPP ASSET STREAM ERROR:', error.message);
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });

        return upstream.data.pipe(res);
      }

      if (apiPath === '/api/animal') {
        const animalId = url.searchParams.get('animal') || url.searchParams.get('id');
        if (!animalId) return jsonResponse(res, 400, { error: 'animal id is required' });

        const cacheRecord = await getCachedWebAnimalPayload(animalId);
        if (!cacheRecord) {
          const payload = JSON.stringify({
            error: 'animal_not_found_or_unpublished',
            message: WEB_ANIMAL_UNAVAILABLE_MESSAGE,
          });
          res.writeHead(404, applyPublicApiCors(req, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(payload),
            'Cache-Control': 'no-store',
          }));
          return res.end(payload);
        }

        const etag = cacheRecord.etag;
        const headers = applyPublicApiCors(req, {
          'Cache-Control': 'public, no-cache',
          ETag: etag,
        });
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, headers);
          return res.end();
        }
        res.writeHead(200, {
          ...headers,
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(cacheRecord.json),
        });
        return res.end(cacheRecord.json);
      }

      if (apiPath === '/api/catalog') {
        const cacheRecord = await getCachedWebCatalogPayload();
        const etag = cacheRecord.etag;
        const headers = applyPublicApiCors(req, {
          'Cache-Control': 'public, no-cache',
          ETag: etag,
        });
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, headers);
          return res.end();
        }
        res.writeHead(200, {
          ...headers,
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(cacheRecord.json),
        });
        return res.end(cacheRecord.json);
      }

      if (requestPath === '/catalog' || requestPath === '/catalog/' || requestPath === '/webapp/catalog' || requestPath === '/webapp/catalog/') {
        const cacheRecord = await getCachedWebCatalogPayload();
        const profilePath = requestPath.startsWith('/webapp') ? '/webapp' : '/';
        res.writeHead(200, htmlResponseHeaders());
        return res.end(minifyHtml(catalogWebAppHtml(cacheRecord?.payload || null, { profilePath })));
      }

      if (requestPath === '/1' || requestPath === '/1/') {
        const cacheRecord = await getCachedWebCatalogPayload();
        res.writeHead(200, htmlResponseHeaders());
        return res.end(minifyHtml(prospektMiraLandingHtml(cacheRecord?.payload || null)));
      }

      if (requestPath === '/success' || requestPath === '/success/' || requestPath === '/webapp/success' || requestPath === '/webapp/success/') {
        const animalId = String(url.searchParams.get('animal') || url.searchParams.get('id') || '').trim();
        const paymentKind = String(url.searchParams.get('kind') || 'donate').trim().toLowerCase() === 'feed' ? 'feed' : 'donate';
        let meta = {
          title: paymentKind === 'feed' ? 'Спасибо за вкусняшку' : 'Спасибо за донат',
          description: paymentKind === 'feed' ? 'Спасибо за вкусняшку для кошек Котокафе.' : 'Спасибо за помощь кошкам Котокафе.',
          canonicalUrl: publicUrl('/success'),
          imageUrl: publicUrl('/og-cats.png'),
          imageAlt: 'Котокафе',
        };
        let payload = null;
        if (animalId) {
          const cacheRecord = await getCachedWebAnimalPayload(animalId);
          if (cacheRecord) {
            payload = cacheRecord.payload || null;
            meta = {
              ...buildAnimalWebMeta(cacheRecord, animalId),
              title: paymentKind === 'feed'
                ? `${cacheRecord.payload?.animal?.name || 'Кошка'} благодарит вас за вкусняшку`
                : `${cacheRecord.payload?.animal?.name || 'Кошка'} благодарит вас за донат`,
              description: paymentKind === 'feed'
                ? `${cacheRecord.payload?.animal?.name || 'Кошка'} благодарит вас за вкусняшку.`
                : `${cacheRecord.payload?.animal?.name || 'Кошка'} благодарит вас за донат.`,
              canonicalUrl: publicUrl(`/success?animal=${encodeURIComponent(animalId)}`),
            };
          }
        }
        res.writeHead(200, htmlResponseHeaders());
        return res.end(minifyHtml(paymentSuccessWebAppHtml(meta, payload, { animalName: payload?.animal?.name || null, paymentKind })));
      }

      if (requestPath === '/donate' || requestPath === '/webapp/donate') {
        const animalId = url.searchParams.get('animal') || url.searchParams.get('id') || '';
        const profilePath = requestPath.startsWith('/webapp') ? '/webapp' : '/';
        let animalName = '';
        if (animalId) {
          const cacheRecord = await getCachedWebAnimalPayload(animalId);
          animalName = cacheRecord?.payload?.animal?.name || '';
        }
        res.writeHead(200, htmlResponseHeaders());
        return res.end(minifyHtml(donateWebAppHtml({ animalId, animalName, profilePath })));
      }

      if (requestPath === '/' || requestPath === '/webapp') {
        const animalId = url.searchParams.get('animal') || url.searchParams.get('id');
        if (!animalId) {
          const cacheRecord = await getCachedWebCatalogPayload();
          const profilePath = requestPath.startsWith('/webapp') ? '/webapp' : '/';
          res.writeHead(200, htmlResponseHeaders());
          return res.end(minifyHtml(catalogWebAppHtml(cacheRecord?.payload || null, { profilePath })));
        }

        let meta = {};
        let payload = null;
        const cacheRecord = await getCachedWebAnimalPayload(animalId);
        if (cacheRecord) {
          meta = buildAnimalWebMeta(cacheRecord, animalId);
          payload = cacheRecord.payload || null;
        } else {
          meta = {
            title: WEB_ANIMAL_UNAVAILABLE_MESSAGE,
            description: WEB_ANIMAL_UNAVAILABLE_MESSAGE,
            canonicalUrl: publicUrl('/'),
            imageUrl: publicUrl('/og-cats.png'),
            imageAlt: 'Котокафе',
          };
        }
        res.writeHead(200, htmlResponseHeaders());
        return res.end(minifyHtml(webAppHtml(meta, payload)));
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    } catch (error) {
      console.error('WEBAPP SERVER ERROR:', error.response?.data || error.message);
      return jsonResponse(res, 500, { error: 'server error' });
    }
  });

  server.on('error', (error) => console.error('WEBAPP LISTEN ERROR:', error.message));
  server.listen(CAT_WEBAPP_PORT, CAT_WEBAPP_HOST, () => {
    if (kotocatsCore.coreModeEnabled()) {
      console.log(`Cat WebApp compatibility server started on ${CAT_WEBAPP_HOST}:${CAT_WEBAPP_PORT}`);
      console.log('Cat pages, catalog and donation pages are delegated to kotocats-core');
      return;
    }

    console.log(`Cat WebApp server started on ${CAT_WEBAPP_HOST}:${CAT_WEBAPP_PORT}`);
    warmWebCatalogPayloadCache();
  });
  return server;
}

// Public pages and APIs are served by koshkivgorode-site and kotocats-core.
// The old compatibility webapp is intentionally no longer started.
const webAppServer = null;

try {
  initMixplatDonations();
} catch (error) {
  console.error('MIXPLAT INIT ERROR:', error.response?.data || error.message);
}

const TELEGRAM_RETRY_DELAYS_MS = [2000, 5000, 15000, 30000];

function telegramErrorDescription(error) {
  return error?.response?.description || error?.response?.data || error?.message || String(error);
}

function telegramErrorCode(error) {
  return Number(error?.code || error?.response?.error_code || error?.response?.status || 0);
}

function retryDelayWithJitter(attempt) {
  const base = TELEGRAM_RETRY_DELAYS_MS[Math.min(attempt, TELEGRAM_RETRY_DELAYS_MS.length - 1)];
  return Math.max(500, Math.round(base * (0.8 + Math.random() * 0.4)));
}

function waitForTelegramRetry(delayMs) {
  return new Promise((resolve) => {
    resolveRetryWait = resolve;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      resolveRetryWait = null;
      resolve();
    }, delayMs);
  });
}

async function launchBotWithRetry() {
  let attempt = 0;

  while (!shutdownRequested) {
    let stableTimer = null;
    try {
      await bot.launch({}, () => {
        telegramReady = true;
        startDonationThanksWorker();
        processDonationThanksQueue('telegram_connected');
        console.log('Cat bot connected to Telegram');
        stableTimer = setTimeout(() => {
          attempt = 0;
        }, 60 * 1000);
      });
      if (stableTimer) clearTimeout(stableTimer);
      if (shutdownRequested) return;
      throw new Error('Telegram polling stopped unexpectedly');
    } catch (error) {
      if (stableTimer) clearTimeout(stableTimer);
      if (shutdownRequested) return;

      telegramReady = false;
      const code = telegramErrorCode(error);
      console.error('BOT CONNECTION ERROR:', telegramErrorDescription(error));
      if (code === 401) {
        console.error('BOT CONNECTION FATAL: Telegram token is invalid');
        process.exitCode = 1;
        shutdown('INVALID_TOKEN');
        return;
      }

      const delayMs = retryDelayWithJitter(attempt);
      attempt += 1;
      console.warn(`Telegram reconnect in ${(delayMs / 1000).toFixed(1)}s (attempt ${attempt})`);
      await waitForTelegramRetry(delayMs);
    }
  }
}

function shutdown(reason) {
  if (shutdownRequested) return;
  shutdownRequested = true;
  telegramReady = false;
  stopDonationThanksWorker();
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (resolveRetryWait) resolveRetryWait();
  resolveRetryWait = null;
  try { bot.stop(reason); } catch (_) {}
  try { webAppServer?.close(); } catch (_) {}
}

launchBotWithRetry().catch((error) => {
  console.error('BOT RETRY LOOP ERROR:', telegramErrorDescription(error));
  process.exitCode = 1;
});

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
