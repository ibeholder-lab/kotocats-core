'use strict';

/**
 * animal-reviews.module.js
 *
 * Отдельный модуль отзывов о кошках.
 *
 * Функциональность:
 * - POST /api/animal-review — оставить отзыв с сайта / веб-анкеты;
 * - GET  /api/animal-reviews?animal=<uuid> — получить опубликованные отзывы;
 * - Telegram-команды: отзыв Мандарин / отзывы Мандарин;
 * - админская модерация: опубликовать / удалить;
 * - топ-5 последних публичных отзывов для Telegram-анкеты.
 */

function json(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(status === 204 ? '' : JSON.stringify(payload));
}

function envPositiveInteger(name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const raw = process.env[name];
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) return fallback;
  return Math.min(Math.floor(value), max);
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function originFromUrl(value) {
  try { return new URL(value).origin; } catch (_) { return null; }
}

function normalizedHostHeader(value) {
  return String(value || '').split(',')[0].trim().toLowerCase();
}

function requestOrigin(req) {
  const host = normalizedHostHeader(req.headers.host);
  if (!host) return null;
  // Не доверяем X-Forwarded-Proto внутри модуля: защищённый WebApp-сервер
  // может передать свою проверенную функцию requestOrigin через options.
  const proto = req.socket?.encrypted ? 'https' : 'http';
  return `${proto}://${host}`;
}

function readJsonBody(req, maxBytes = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (_) {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function cleanText(value, maxLen = 3000) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, maxLen);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function getClientIp(req) {
  return req.socket?.remoteAddress || null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const TELEGRAM_HTML_SAFE_LIMIT = 3900;
const TELEGRAM_REVIEWS_LIST_LIMIT = 5;
const TELEGRAM_REVIEW_TEXT_LIMIT = 420;
const TELEGRAM_MODERATION_PENDING_LIMIT = 5;
const TELEGRAM_MODERATION_PUBLIC_LIMIT = 3;
const TELEGRAM_MODERATION_TEXT_LIMIT = 360;

function escapeHtmlLimited(value, maxLen = 500) {
  const source = String(value ?? '');
  let out = '';
  let truncated = false;

  for (const char of source) {
    const escaped = char === '&' ? '&amp;' : (char === '<' ? '&lt;' : (char === '>' ? '&gt;' : char));
    if (out.length + escaped.length > maxLen) {
      truncated = true;
      break;
    }
    out += escaped;
  }

  return truncated ? `${out}…` : out;
}

function joinTelegramHtmlBlocks(blocks, maxLen = TELEGRAM_HTML_SAFE_LIMIT) {
  const out = [];
  for (const block of blocks || []) {
    const value = String(block || '').trim();
    if (!value) continue;
    const candidate = [...out, value].join('\n\n');
    if (candidate.length > maxLen) return out.join('\n\n').trim();
    out.push(value);
  }
  return out.join('\n\n').trim();
}

function formatReviewDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function publicReviewErrorMessage(error) {
  const code = String(error || '').trim();
  const map = {
    'reviews disabled': 'Отзывы временно недоступны.',
    'origin not allowed': 'Отправка отзывов сейчас недоступна.',
    'method not allowed': 'Метод запроса не поддерживается.',
    'bad request': 'Некорректный запрос.',
    'animal_id is required': 'Не удалось определить кошку для отзыва.',
    'review_text is required': 'Введите текст отзыва.',
    'too many reviews, try later': 'Слишком много попыток. Попробуйте чуть позже.',
    'animal not found': 'Кошка не найдена.',
    'review create failed': 'Не удалось отправить отзыв. Попробуйте позже.',
    'animal is required': 'Не удалось загрузить отзывы.',
    'offset is too large': 'Не удалось загрузить отзывы.',
    'review list failed': 'Не удалось загрузить отзывы.',
    'request body too large': 'Отзыв получился слишком большим.',
    'invalid json': 'Некорректный формат запроса.'
  };
  return map[code] || code || 'Произошла ошибка.';
}

function createAnimalReviewsModule(options) {
  const {
    axios,
    DIRECTUS_URL,
    DIRECTUS_TIMEOUT_MS = envPositiveInteger('DIRECTUS_TIMEOUT_MS', 30000, 1000, 120000),
    apiHeaders,
    directusGet,
    directusPost,
    directusPatch,
    getAnimalById,
    searchAnimalsByName,
    findAnimalFromText,
    Markup,
    sessions,
    enabled = true,
    collection = 'animal_reviews',
    isAnimalPublicForWeb,
    getClientIp: trustedClientIp,
    allowedOrigins: explicitAllowedOrigins,
    reviewAllowedOrigins,
    requestOrigin: trustedRequestOrigin,
  } = options || {};

  function reviewsEnabled() {
    return enabled !== false && String(enabled).toLowerCase() !== 'false';
  }

  function disabledText() {
    return 'Функция отзывов временно отключена.';
  }

  const reviewRateLimitWindowMs = envPositiveInteger('ANIMAL_REVIEWS_RATE_LIMIT_WINDOW_MS', 10 * 60 * 1000, 1000, 24 * 60 * 60 * 1000);
  const reviewRateLimitMax = envPositiveInteger('ANIMAL_REVIEWS_RATE_LIMIT_MAX', 5, 1, 1000);
  const reviewRateLimitGlobalMax = envPositiveInteger('ANIMAL_REVIEWS_RATE_LIMIT_GLOBAL_MAX', 20, 1, 5000);
  const reviewRateLimitBucketsMax = envPositiveInteger('ANIMAL_REVIEWS_RATE_LIMIT_BUCKETS_MAX', 5000, 100, 100000);
  const reviewRateLimitBuckets = new Map();
  let reviewRateLimitLastCleanup = 0;

  const telegramReviewRateLimitWindowMs = envPositiveInteger('ANIMAL_REVIEWS_TG_RATE_LIMIT_WINDOW_MS', 10 * 60 * 1000, 1000, 24 * 60 * 60 * 1000);
  const telegramReviewRateLimitMax = envPositiveInteger('ANIMAL_REVIEWS_TG_RATE_LIMIT_MAX', 5, 1, 1000);
  const telegramReviewRateLimitBucketsMax = envPositiveInteger('ANIMAL_REVIEWS_TG_RATE_LIMIT_BUCKETS_MAX', 5000, 100, 100000);
  const telegramReviewRateLimitBuckets = new Map();
  let telegramReviewRateLimitLastCleanup = 0;

  const allowedReviewOrigins = [
    ...(Array.isArray(explicitAllowedOrigins) ? explicitAllowedOrigins : []),
    ...(Array.isArray(reviewAllowedOrigins) ? reviewAllowedOrigins : []),
    ...splitCsv(process.env.ANIMAL_REVIEWS_ALLOWED_ORIGINS),
    ...splitCsv(process.env.CAT_WEBAPP_ALLOWED_ORIGINS),
    ...splitCsv(process.env.CAT_WEBAPP_URL),
  ]
    .map(originFromUrl)
    .filter(Boolean);

  for (const host of splitCsv(process.env.CAT_WEBAPP_ALLOWED_HOSTS)) {
    allowedReviewOrigins.push(`https://${host}`);
    if (process.env.NODE_ENV !== 'production') allowedReviewOrigins.push(`http://${host}`);
  }

  const allowedReviewOriginSet = new Set(allowedReviewOrigins);

  const publicReviewsCacheTtlMs = envPositiveInteger('ANIMAL_REVIEWS_PUBLIC_CACHE_TTL_MS', 30 * 1000, 1000, 5 * 60 * 1000);
  const animalPublicCacheTtlMs = envPositiveInteger('ANIMAL_REVIEWS_ANIMAL_CACHE_TTL_MS', 30 * 1000, 1000, 5 * 60 * 1000);
  const publicReviewsCacheMax = envPositiveInteger('ANIMAL_REVIEWS_PUBLIC_CACHE_MAX', 1000, 10, 100000);
  const animalPublicCacheMax = envPositiveInteger('ANIMAL_REVIEWS_ANIMAL_CACHE_MAX', 1000, 10, 100000);
  const publicReviewsMaxOffset = envPositiveInteger('ANIMAL_REVIEWS_PUBLIC_MAX_OFFSET', 500, 0, 10000);
  const telegramReviewSessionTtlMs = envPositiveInteger('ANIMAL_REVIEWS_TG_SESSION_TTL_MS', 30 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000);
  const publicReviewsCache = new Map();
  const animalPublicCache = new Map();
  let publicReviewsCacheLastCleanup = 0;
  let animalPublicCacheLastCleanup = 0;
  let telegramReviewSessionLastCleanup = 0;

  function cacheGet(map, key) {
    const item = map.get(key);
    if (!item) return null;
    if (item.expiresAt <= Date.now()) {
      map.delete(key);
      return null;
    }
    return item.value;
  }

  function cleanupCacheMap(map, maxSize, lastCleanupName, force = false) {
    const now = Date.now();
    if (!force) {
      if (lastCleanupName === 'public' && now - publicReviewsCacheLastCleanup < 60 * 1000) return;
      if (lastCleanupName === 'animal' && now - animalPublicCacheLastCleanup < 60 * 1000) return;
    }

    if (lastCleanupName === 'public') publicReviewsCacheLastCleanup = now;
    if (lastCleanupName === 'animal') animalPublicCacheLastCleanup = now;

    for (const [key, item] of map.entries()) {
      if (!item?.expiresAt || item.expiresAt <= now) map.delete(key);
    }

    while (map.size > maxSize) {
      const oldestKey = map.keys().next().value;
      if (!oldestKey) break;
      map.delete(oldestKey);
    }
  }

  function cacheSet(map, key, value, ttlMs, maxSize, cacheName) {
    cleanupCacheMap(map, maxSize, cacheName, map.size >= maxSize);
    map.set(key, { value, expiresAt: Date.now() + ttlMs });
    if (map.size > maxSize) cleanupCacheMap(map, maxSize, cacheName, true);
  }

  function clearPublicReviewsCache(animalId) {
    const prefix = `${animalId || ''}:`;
    for (const key of publicReviewsCache.keys()) {
      if (key.startsWith(prefix)) publicReviewsCache.delete(key);
    }
  }

  function ownRequestOrigin(req) {
    if (typeof trustedRequestOrigin === 'function') {
      const value = trustedRequestOrigin(req);
      return value ? String(value) : null;
    }
    return requestOrigin(req);
  }

  function isSameOriginRequest(req, origin) {
    const ownOrigin = ownRequestOrigin(req);
    return Boolean(ownOrigin && origin === ownOrigin);
  }

  function corsHeadersForRequest(req) {
    const origin = String(req.headers.origin || '').trim();
    if (!origin) return {};
    if (!allowedReviewOriginSet.has(origin) && !isSameOriginRequest(req, origin)) return null;
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
  }

  function respond(req, res, status, payload) {
    const headers = corsHeadersForRequest(req);
    if (headers === null) return json(res, 403, { error: 'origin not allowed' });
    return json(res, status, payload, headers);
  }

  function rateLimitKey(req, animalId = '') {
    const ip = typeof trustedClientIp === 'function' ? trustedClientIp(req) : getClientIp(req);
    return `${ip || 'unknown'}:${animalId || 'global'}`;
  }

  function cleanupReviewRateLimitBuckets(now = Date.now(), force = false) {
    if (!force && now - reviewRateLimitLastCleanup < 60 * 1000) return;
    reviewRateLimitLastCleanup = now;

    for (const [key, bucket] of reviewRateLimitBuckets.entries()) {
      if (!bucket?.resetAt || bucket.resetAt <= now) reviewRateLimitBuckets.delete(key);
    }

    while (reviewRateLimitBuckets.size > reviewRateLimitBucketsMax) {
      const oldestKey = reviewRateLimitBuckets.keys().next().value;
      if (!oldestKey) break;
      reviewRateLimitBuckets.delete(oldestKey);
    }
  }

  function bumpReviewRateLimitBucket(key, now, maxCount) {
    const bucket = reviewRateLimitBuckets.get(key) || { count: 0, resetAt: now + reviewRateLimitWindowMs };
    if (bucket.resetAt <= now) {
      bucket.count = 0;
      bucket.resetAt = now + reviewRateLimitWindowMs;
    }
    bucket.count += 1;
    reviewRateLimitBuckets.set(key, bucket);
    return bucket.count <= maxCount;
  }

  function checkReviewRateLimit(req, animalId = '') {
    const now = Date.now();
    cleanupReviewRateLimitBuckets(now, reviewRateLimitBuckets.size > reviewRateLimitBucketsMax);

    const perAnimalKey = rateLimitKey(req, animalId);
    const globalKey = rateLimitKey(req, '');

    const perAnimalOk = bumpReviewRateLimitBucket(perAnimalKey, now, reviewRateLimitMax);
    const globalOk = bumpReviewRateLimitBucket(globalKey, now, reviewRateLimitGlobalMax);

    if (reviewRateLimitBuckets.size > reviewRateLimitBucketsMax) cleanupReviewRateLimitBuckets(now, true);
    return perAnimalOk && globalOk;
  }

  function cleanupTelegramReviewRateLimitBuckets(now = Date.now(), force = false) {
    if (!force && now - telegramReviewRateLimitLastCleanup < 60 * 1000) return;
    telegramReviewRateLimitLastCleanup = now;

    for (const [key, bucket] of telegramReviewRateLimitBuckets.entries()) {
      if (!bucket?.resetAt || bucket.resetAt <= now) telegramReviewRateLimitBuckets.delete(key);
    }

    while (telegramReviewRateLimitBuckets.size > telegramReviewRateLimitBucketsMax) {
      const oldestKey = telegramReviewRateLimitBuckets.keys().next().value;
      if (!oldestKey) break;
      telegramReviewRateLimitBuckets.delete(oldestKey);
    }
  }

  function checkTelegramReviewRateLimit(ctx) {
    const now = Date.now();
    cleanupTelegramReviewRateLimitBuckets(now, telegramReviewRateLimitBuckets.size > telegramReviewRateLimitBucketsMax);

    const userId = ctx.from?.id ? String(ctx.from.id) : `chat:${ctx.chat?.id || 'unknown'}`;
    const key = `tg:${userId}`;
    const bucket = telegramReviewRateLimitBuckets.get(key) || { count: 0, resetAt: now + telegramReviewRateLimitWindowMs };
    if (bucket.resetAt <= now) {
      bucket.count = 0;
      bucket.resetAt = now + telegramReviewRateLimitWindowMs;
    }
    bucket.count += 1;
    telegramReviewRateLimitBuckets.set(key, bucket);

    if (telegramReviewRateLimitBuckets.size > telegramReviewRateLimitBucketsMax) cleanupTelegramReviewRateLimitBuckets(now, true);
    return bucket.count <= telegramReviewRateLimitMax;
  }

  function animalVisibleForPublicReviews(animal) {
    if (!animal) return false;
    if (typeof isAnimalPublicForWeb === 'function') return Boolean(isAnimalPublicForWeb(animal));
    if (animal.is_archived === true || animal.archived === true) return false;
    if (animal.status === 'archived' || animal.status === 'hidden') return false;
    if (animal.is_public !== undefined) return animal.is_public === true || animal.is_public === 'true';
    if (animal.published !== undefined) return animal.published === true || animal.published === 'true';
    // Fail closed: без явного признака публичности не принимаем и не показываем отзывы.
    return false;
  }

  if (!DIRECTUS_URL) throw new Error('DIRECTUS_URL is required for animal reviews module');
  if (!apiHeaders) throw new Error('apiHeaders is required for animal reviews module');

  async function directusDelete(collectionName, id) {
    if (!axios) throw new Error('axios is required for delete action');
    if (!isUuid(id)) throw new Error('invalid review id');
    await axios.delete(`${DIRECTUS_URL}/items/${collectionName}/${encodeURIComponent(id)}`, {
      headers: apiHeaders(),
      timeout: DIRECTUS_TIMEOUT_MS,
    });
    return true;
  }

  async function animalExists(animalId) {
    if (typeof getAnimalById === 'function') {
      return getAnimalById(animalId);
    }

    const rows = await directusGet('animals', {
      filter: { id: { _eq: animalId } },
      fields: 'id,name,status,location,is_public,published,is_archived,archived',
      limit: 1,
    });
    return rows?.[0] || null;
  }

  async function publicAnimalForReviews(animalId) {
    if (!isUuid(animalId)) return null;
    const cached = cacheGet(animalPublicCache, animalId);
    if (cached !== null) return cached || null;

    const animal = await animalExists(animalId);
    const visible = animal && animalVisibleForPublicReviews(animal) ? animal : null;
    cacheSet(animalPublicCache, animalId, visible || false, animalPublicCacheTtlMs, animalPublicCacheMax, 'animal');
    return visible;
  }

  async function saveReview(payload) {
    if (typeof directusPost === 'function') return directusPost(collection, payload);

    const res = await axios.post(`${DIRECTUS_URL}/items/${collection}`, payload, {
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      timeout: DIRECTUS_TIMEOUT_MS,
    });
    return res.data?.data;
  }

  function reviewerNameFromCtx(ctx) {
    return cleanText(
      [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username || 'Гость',
      120
    ) || 'Гость';
  }

  async function saveTelegramReview(ctx, animalId, reviewText) {
    const animal = await publicAnimalForReviews(animalId);
    if (!animal) throw new Error('animal not found');

    await saveReview({
      animal_id: animalId,
      reviewer_telegram_id: ctx.from?.id ? String(ctx.from.id) : null,
      reviewer_name: reviewerNameFromCtx(ctx),
      review_text: cleanText(reviewText, 3000),
      is_public: false,
    });

    return animal;
  }

  function cleanupExpiredTelegramReviewSessions(force = false) {
    if (!sessions || typeof sessions.entries !== 'function') return;
    const now = Date.now();
    if (!force && now - telegramReviewSessionLastCleanup < 60 * 1000) return;
    telegramReviewSessionLastCleanup = now;

    for (const [userId, session] of sessions.entries()) {
      if (session?.step === 'leave_review' && session?.data?.expires_at && session.data.expires_at <= now) {
        sessions.delete(userId);
      }
    }
  }

  async function startLeaveReview(ctx, animalId) {
    if (!reviewsEnabled()) return ctx.reply(disabledText());
    const animal = await publicAnimalForReviews(animalId);
    if (!animal) return ctx.reply('Кошка не найдена.');

    if (!sessions) {
      return ctx.reply('Не получилось начать отзыв: сессии не подключены.');
    }

    cleanupExpiredTelegramReviewSessions();

    sessions.set(ctx.from.id, {
      step: 'leave_review',
      data: { animal_id: animal.id, expires_at: Date.now() + telegramReviewSessionTtlMs },
    });

    return ctx.reply([
      `💬 Отзыв о ${animal.name || 'кошке'}`,
      '',
      'Напишите отзыв одним сообщением.',
      'Он попадёт куратору на модерацию и появится после публикации.',
      '',
      'Если передумали — /cancel',
    ].join('\n'));
  }

  async function handleReviewTextMessage(ctx, text) {
    if (!reviewsEnabled()) {
      sessions?.delete(ctx.from.id);
      return ctx.reply(disabledText());
    }
    cleanupExpiredTelegramReviewSessions();
    const session = sessions?.get(ctx.from.id);
    if (session?.data?.expires_at && session.data.expires_at <= Date.now()) {
      sessions?.delete(ctx.from.id);
      return ctx.reply('Время на отправку отзыва истекло. Откройте анкету и начните заново.');
    }
    const animalId = session?.data?.animal_id;
    const reviewText = cleanText(text, 3000);

    if (!animalId) {
      sessions?.delete(ctx.from.id);
      return ctx.reply('Не нашёл кошку для отзыва. Откройте анкету заново.');
    }

    if (reviewText.length < 3) {
      return ctx.reply('Отзыв слишком короткий. Напишите чуть подробнее или нажмите /cancel.');
    }

    if (!checkTelegramReviewRateLimit(ctx)) {
      return ctx.reply('Слишком много отзывов подряд. Попробуйте позже.');
    }

    try {
      const animal = await saveTelegramReview(ctx, animalId, reviewText);
      sessions.delete(ctx.from.id);
      return ctx.reply([
        'Спасибо! 💬',
        '',
        `Отзыв о ${animal.name || 'кошке'} отправлен куратору на модерацию.`,
      ].join('\n'));
    } catch (error) {
      console.error('TELEGRAM REVIEW SAVE ERROR:', error.response?.data || error.message);
      return ctx.reply('Не получилось сохранить отзыв. Посмотри логи catbot.');
    }
  }

  async function getReviews(animalId, options = {}) {
    const filter = { animal_id: { _eq: animalId } };
    if (options.publicOnly) filter.is_public = { _eq: true };
    if (options.hiddenOnly) filter.is_public = { _eq: false };

    const params = {
      filter,
      fields: options.fields || (options.publicOnly
        ? 'reviewer_name,review_text,created_at'
        : 'id,animal_id,reviewer_telegram_id,reviewer_name,review_text,is_public,created_at'),
      sort: '-created_at',
      limit: options.limit || 20,
    };
    if (Number.isFinite(Number(options.offset)) && Number(options.offset) > 0) {
      params.offset = Math.floor(Number(options.offset));
    }

    return directusGet(collection, params);
  }

  async function getPublicReviews(animalId, limit = 20, offset = 0) {
    const cacheKey = `${animalId}:${Number(limit) || 20}:${Number(offset) || 0}`;
    const cached = cacheGet(publicReviewsCache, cacheKey);
    if (cached) return cached;

    const rows = await getReviews(animalId, {
      publicOnly: true,
      limit,
      offset,
      fields: 'reviewer_name,review_text,created_at',
    });
    cacheSet(publicReviewsCache, cacheKey, rows || [], publicReviewsCacheTtlMs, publicReviewsCacheMax, 'public');
    return rows || [];
  }

  function publicReviewDto(review) {
    return {
      reviewer_name: cleanText(review?.reviewer_name, 120) || 'Гость',
      review_text: cleanText(review?.review_text, 3000),
      created_at: review?.created_at || null,
    };
  }

  async function getPendingReviews(animalId, limit = 20) {
    return getReviews(animalId, { hiddenOnly: true, limit });
  }

  async function publishReview(reviewId) {
    if (!isUuid(reviewId)) throw new Error('invalid review id');
    const before = await getReviewById(reviewId);
    const updated = await directusPatch(collection, reviewId, { is_public: true });
    const animalId = updated?.animal_id?.id || updated?.animal_id || before?.animal_id?.id || before?.animal_id;
    clearPublicReviewsCache(animalId);
    return updated;
  }

  async function deleteReview(reviewId) {
    if (!isUuid(reviewId)) throw new Error('invalid review id');
    const before = await getReviewById(reviewId);
    await directusDelete(collection, reviewId);
    const animalId = before?.animal_id?.id || before?.animal_id;
    clearPublicReviewsCache(animalId);
    return true;
  }

  async function getReviewById(reviewId) {
    if (!isUuid(reviewId)) return null;
    const rows = await directusGet(collection, {
      filter: { id: { _eq: reviewId } },
      fields: 'id,animal_id,reviewer_telegram_id,reviewer_name,review_text,is_public,created_at',
      limit: 1,
    });
    return rows?.[0] || null;
  }

  async function handleCreateReview(req, res) {
    if (!reviewsEnabled()) return respond(req, res, 503, { error: publicReviewErrorMessage('reviews disabled') });
    if (corsHeadersForRequest(req) === null) return respond(req, res, 403, { error: publicReviewErrorMessage('origin not allowed') });
    if (req.method === 'OPTIONS') return respond(req, res, 204, {});
    if (req.method !== 'POST') return respond(req, res, 405, { error: publicReviewErrorMessage('method not allowed') });

    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return respond(req, res, 400, { error: publicReviewErrorMessage(error.message || 'bad request') });
    }

    const animalId = cleanText(body.animal_id || body.animalId, 80);
    const reviewerName = cleanText(body.reviewer_name || body.name, 120);
    const reviewText = cleanText(body.review_text || body.text || body.review, 3000);
    const website = cleanText(body.website, 200);

    if (website) return respond(req, res, 200, { ok: true });
    if (!isUuid(animalId)) return respond(req, res, 400, { error: publicReviewErrorMessage('animal_id is required') });
    if (reviewText.length < 3) return respond(req, res, 400, { error: publicReviewErrorMessage('review_text is required') });
    if (!checkReviewRateLimit(req, animalId)) return respond(req, res, 429, { error: publicReviewErrorMessage('too many reviews, try later') });

    try {
      const animal = await publicAnimalForReviews(animalId);
      if (!animal) return respond(req, res, 404, { error: publicReviewErrorMessage('animal not found') });

      await saveReview({
        animal_id: animalId,
        reviewer_name: reviewerName || null,
        review_text: reviewText,
        is_public: false,
      });

      return respond(req, res, 200, {
        ok: true,
        message: 'Спасибо! Отзыв отправлен куратору и появится после проверки.',
      });
    } catch (error) {
      console.error('ANIMAL REVIEW CREATE ERROR:', error.response?.data || error.message);
      return respond(req, res, 500, { error: publicReviewErrorMessage('review create failed') });
    }
  }

  async function handleListReviews(req, res, parsedUrl) {
    if (!reviewsEnabled()) return respond(req, res, 503, { error: publicReviewErrorMessage('reviews disabled') });
    if (corsHeadersForRequest(req) === null) return respond(req, res, 403, { error: publicReviewErrorMessage('origin not allowed') });
    if (req.method === 'OPTIONS') return respond(req, res, 204, {});
    if (req.method !== 'GET') return respond(req, res, 405, { error: publicReviewErrorMessage('method not allowed') });

    const animalId = cleanText(parsedUrl.searchParams.get('animal'), 80);
    const limit = Math.min(envPositiveInteger('ANIMAL_REVIEWS_PUBLIC_PAGE_LIMIT', 5, 1, 30), 30);
    const offset = Math.max(0, Math.floor(Number(parsedUrl.searchParams.get('offset') || 0) || 0));
    if (!isUuid(animalId)) return respond(req, res, 400, { error: publicReviewErrorMessage('animal is required') });
    if (offset > publicReviewsMaxOffset) return respond(req, res, 400, { error: publicReviewErrorMessage('offset is too large') });

    try {
      const animal = await publicAnimalForReviews(animalId);
      if (!animal) return respond(req, res, 404, { error: publicReviewErrorMessage('animal not found') });
      const rows = await getPublicReviews(animalId, limit + 1, offset);
      const page = rows.slice(0, limit);
      return respond(req, res, 200, {
        ok: true,
        reviews: page.map(publicReviewDto),
        limit,
        offset,
        next_offset: offset + page.length,
        has_more: rows.length > limit,
      });
    } catch (error) {
      console.error('ANIMAL REVIEW LIST ERROR:', error.response?.data || error.message);
      return respond(req, res, 500, { error: publicReviewErrorMessage('review list failed') });
    }
  }

  function route(req, res, parsedUrl) {
    const rawPathname = parsedUrl?.pathname || '';
    const pathname = rawPathname.replace(/^\/webapp(?=\/)/, '');
    if (pathname === '/api/animal-review' || pathname === '/webapp/api/animal-review') {
      handleCreateReview(req, res);
      return true;
    }
    if (pathname === '/api/animal-reviews' || pathname === '/webapp/api/animal-reviews') {
      handleListReviews(req, res, parsedUrl);
      return true;
    }
    return false;
  }

  async function findAnimalByQuery(query) {
    const q = cleanText(query, 200);
    if (!q) return null;

    if (typeof findAnimalFromText === 'function') {
      const result = await findAnimalFromText(q);
      if (result?.animals?.length === 1) return result.animals[0];
      if (result?.animals?.length > 1) return { multiple: result.animals };
    }

    if (typeof searchAnimalsByName === 'function') {
      const animals = await searchAnimalsByName(q, 10);
      if (animals.length === 1) return animals[0];
      if (animals.length > 1) return { multiple: animals };
    }

    return null;
  }

  function formatReviewsText(animal, reviews) {
    if (!reviews?.length) {
      return [
        `💬 Отзывов о ${animal.name || 'этой кошке'} пока нет.`,
        '',
        'Но вы можете стать первым человеком, который поддержит её добрым словом.',
        'Чем больше людей пишут хорошее о кошке, тем легче ей найти дом.',
      ].join('\n');
    }

    const blocks = [`💬 <b>Отзывы о ${escapeHtmlLimited(animal.name || 'кошке', 120)}</b>`];
    let shownCount = 0;

    for (const review of reviews.slice(0, TELEGRAM_REVIEWS_LIST_LIMIT)) {
      const author = cleanText(review.reviewer_name, 120) || 'Гость';
      const text = cleanText(review.review_text, TELEGRAM_REVIEW_TEXT_LIMIT);
      const dateText = formatReviewDate(review.created_at);
      const block = [
        `<b>${escapeHtmlLimited(author, 160)}</b>${dateText ? ` · ${escapeHtmlLimited(dateText, 80)}` : ''}`,
        escapeHtmlLimited(text, 900),
      ].join('\n');

      const candidate = joinTelegramHtmlBlocks([...blocks, block]);
      if (candidate.length >= TELEGRAM_HTML_SAFE_LIMIT || !candidate.includes(block)) break;
      blocks.push(block);
      shownCount += 1;
    }

    if (reviews.length > shownCount) {
      const footer = 'Показаны последние отзывы, есть ещё отзывы.';
      const candidate = joinTelegramHtmlBlocks([...blocks, footer]);
      if (candidate.includes(footer)) blocks.push(footer);
    }

    return joinTelegramHtmlBlocks(blocks);
  }

  async function topReviewsBlock(animalId, limit = 5) {
    if (!reviewsEnabled()) return null;
    const reviews = await getPublicReviews(animalId, limit);
    if (!reviews?.length) return null;

    const lines = ['<b>💬 Последние отзывы</b>'];
    for (const review of reviews.slice(0, limit)) {
      const author = cleanText(review.reviewer_name, 80) || 'Гость';
      const text = cleanText(review.review_text, 220);
      const dateText = formatReviewDate(review.created_at);
      lines.push(`<b>${escapeHtml(author)}</b>${dateText ? ` · ${escapeHtml(dateText)}` : ''}: ${escapeHtml(text)}`);
    }
    return lines.join('\n');
  }

  async function sendReviews(ctx, animal) {
    if (!reviewsEnabled()) return ctx.reply(disabledText());
    const reviews = await getPublicReviews(animal.id, TELEGRAM_REVIEWS_LIST_LIMIT + 1);
    const extra = { parse_mode: 'HTML' };
    if (!reviews?.length) {
      extra.reply_markup = Markup.inlineKeyboard([
        [Markup.button.callback('✍️ Написать отзыв', `leave_review:${animal.id}`)],
      ]).reply_markup;
    }
    return ctx.reply(formatReviewsText(animal, reviews), extra);
  }

  function registerBotHandlers(bot) {
    if (!bot?.hears) throw new Error('Telegraf bot instance is required');

    bot.hears(/^\/?(отзыв|отзывы|review|reviews)(@\w+)?(?:\s+(.+))?$/i, async (ctx) => {
      try {
        if (!reviewsEnabled()) return ctx.reply(disabledText());
        const query = cleanText(ctx.match?.[3], 200);
        if (!query) return ctx.reply('Напишите: отзыв Имя кошки');

        const animal = await findAnimalByQuery(query);
        if (!animal) return ctx.reply('Не нашёл кошку. Напишите имя явно, например: отзыв Мандарин');

        if (animal.multiple) {
          return ctx.reply(
            'Нашёл несколько кошек. Уточните имя:\n' +
            animal.multiple.slice(0, 10).map((item) => `• ${item.name || 'Без имени'}`).join('\n')
          );
        }

        return sendReviews(ctx, animal);
      } catch (error) {
        console.error('ANIMAL REVIEWS COMMAND ERROR:', error.response?.data || error.message);
        return ctx.reply('Не получилось показать отзывы. Посмотри логи catbot.');
      }
    });
  }

  function reviewModerationKeyboard(animalId, reviews) {
    const rows = [];
    for (const review of reviews || []) {
      rows.push([
        Markup.button.callback('✅ Опубликовать', `pub_review:${review.id}`),
        Markup.button.callback('🗑 Удалить', `del_review:${review.id}`),
      ]);
    }
    rows.push([Markup.button.callback('⬅️ Назад к редактированию', `open_cat:${animalId}`)]);
    return Markup.inlineKeyboard(rows);
  }

  async function showModeration(ctx, animal) {
    if (!reviewsEnabled()) return ctx.reply(disabledText());
    const [pendingAll, publicReviewsAll] = await Promise.all([
      getPendingReviews(animal.id, TELEGRAM_MODERATION_PENDING_LIMIT + 1),
      getPublicReviews(animal.id, TELEGRAM_MODERATION_PUBLIC_LIMIT + 1),
    ]);
    const pending = pendingAll.slice(0, TELEGRAM_MODERATION_PENDING_LIMIT);
    const publicReviews = publicReviewsAll.slice(0, TELEGRAM_MODERATION_PUBLIC_LIMIT);
    const blocks = [`💬 Отзывы: ${escapeHtmlLimited(animal.name || 'Кошка', 120)}`];

    if (pending.length) {
      blocks.push('<b>На модерации:</b>');
      for (let index = 0; index < pending.length; index += 1) {
        const review = pending[index];
        const dateText = formatReviewDate(review.created_at);
        const block = [
          `${index + 1}. ${escapeHtmlLimited(review.reviewer_name || 'Гость', 160)}${dateText ? ` · ${escapeHtmlLimited(dateText, 80)}` : ''}`,
          escapeHtmlLimited(cleanText(review.review_text, TELEGRAM_MODERATION_TEXT_LIMIT), 850),
        ].join('\n');
        const candidate = joinTelegramHtmlBlocks([...blocks, block]);
        if (!candidate.includes(block)) break;
        blocks.push(block);
      }
      if (pendingAll.length > pending.length) {
        const footer = 'Показаны первые отзывы на модерации, есть ещё отзывы.';
        const candidate = joinTelegramHtmlBlocks([...blocks, footer]);
        if (candidate.includes(footer)) blocks.push(footer);
      }
    } else {
      blocks.push('Новых отзывов на модерации нет.');
    }

    if (publicReviews.length) {
      blocks.push('<b>Последние опубликованные:</b>');
      for (const review of publicReviews) {
        const dateText = formatReviewDate(review.created_at);
        const block = `• ${escapeHtmlLimited(review.reviewer_name || 'Гость', 120)}${dateText ? ` · ${escapeHtmlLimited(dateText, 80)}` : ''}: ${escapeHtmlLimited(cleanText(review.review_text, 120), 360)}`;
        const candidate = joinTelegramHtmlBlocks([...blocks, block]);
        if (!candidate.includes(block)) break;
        blocks.push(block);
      }
      if (publicReviewsAll.length > publicReviews.length) {
        const footer = 'Показаны последние опубликованные отзывы, есть ещё отзывы.';
        const candidate = joinTelegramHtmlBlocks([...blocks, footer]);
        if (candidate.includes(footer)) blocks.push(footer);
      }
    }

    return ctx.reply(joinTelegramHtmlBlocks(blocks), {
      parse_mode: 'HTML',
      ...reviewModerationKeyboard(animal.id, pending),
    });
  }

  function registerAdminHandlers(bot, deps = {}) {
    const getAnimal = deps.getAnimalById || getAnimalById;
    const ensureAdminCallbackAccess = deps.ensureAdminCallbackAccess || options.ensureAdminCallbackAccess;

    async function requireAdminCallbackAccess(ctx) {
      if (typeof ensureAdminCallbackAccess === 'function') {
        return ensureAdminCallbackAccess(ctx);
      }

      try {
        await ctx.answerCbQuery('Нет прав на модерацию отзывов', { show_alert: true });
      } catch (_) {}
      await ctx.reply('Нет прав на модерацию отзывов.');
      return null;
    }

    bot.action(/^leave_review:([^:]+)$/, async (ctx) => {
      try {
        await ctx.answerCbQuery('Отзыв');
        return startLeaveReview(ctx, ctx.match[1]);
      } catch (error) {
        console.error('LEAVE REVIEW ACTION ERROR:', error.response?.data || error.message);
        await ctx.answerCbQuery('Ошибка');
      }
    });

    bot.action(/^edit_reviews:([0-9a-fA-F-]{36})$/, async (ctx) => {
      try {
        const user = await requireAdminCallbackAccess(ctx);
        if (!user) return;
        await ctx.answerCbQuery();
        const animal = await getAnimal(ctx.match[1]);
        if (!animal) return ctx.reply('Кошка не найдена.');
        return showModeration(ctx, animal);
      } catch (error) {
        console.error('EDIT REVIEWS ERROR:', error.response?.data || error.message);
        await ctx.answerCbQuery('Ошибка');
      }
    });

    bot.action(/^pub_review:([0-9a-fA-F-]{36})$/, async (ctx) => {
      try {
        const user = await requireAdminCallbackAccess(ctx);
        if (!user) return;
        if (!isUuid(ctx.match[1])) return ctx.answerCbQuery('Некорректный ID отзыва', { show_alert: true });
        await ctx.answerCbQuery('Публикую');
        const before = await getReviewById(ctx.match[1]);
        const review = await publishReview(ctx.match[1]);
        const animalId = review?.animal_id?.id || review?.animal_id || before?.animal_id?.id || before?.animal_id;
        const animal = await getAnimal(animalId);
        await ctx.reply('Отзыв опубликован ✅');
        if (animal) return showModeration(ctx, animal);
      } catch (error) {
        console.error('PUBLISH REVIEW ERROR:', error.response?.data || error.message);
        await ctx.answerCbQuery('Ошибка');
      }
    });

    bot.action(/^del_review:([0-9a-fA-F-]{36})$/, async (ctx) => {
      try {
        const user = await requireAdminCallbackAccess(ctx);
        if (!user) return;
        if (!isUuid(ctx.match[1])) return ctx.answerCbQuery('Некорректный ID отзыва', { show_alert: true });
        await ctx.answerCbQuery('Удаляю');
        const review = await getReviewById(ctx.match[1]);
        await deleteReview(ctx.match[1]);
        const animalId = review?.animal_id?.id || review?.animal_id;
        const animal = animalId ? await getAnimal(animalId) : null;
        await ctx.reply('Отзыв удалён ✅');
        if (animal) return showModeration(ctx, animal);
      } catch (error) {
        console.error('DELETE REVIEW ERROR:', error.response?.data || error.message);
        await ctx.answerCbQuery('Ошибка');
      }
    });
  }

  function clientScript(animalIdExpression = 'animalId') {
    return `
<script>
function animalReviewEsc(value){
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
async function submitAnimalReview(form){
  const status = form.querySelector('[data-review-status]');
  const payload = {
    animal_id: ${animalIdExpression},
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

    if (!response.ok || data.error) throw new Error(data.error || 'Ошибка');

    form.reset();
    status.textContent = data.message || 'Спасибо! Отзыв отправлен.';
  } catch (error) {
    status.textContent = 'Не получилось отправить отзыв. Попробуйте позже.';
  }
  return false;
}

function formatReviewDateClient(value){
  if(!value) return '';
  const date = new Date(value);
  if(Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'});
}

function renderAnimalReviewItems(reviews){
  return (reviews || []).map(function(review){
    return '<div class="review-item">' +
      '<div class="review-author">' + animalReviewEsc(review.reviewer_name || 'Гость') + (review.created_at ? ' · ' + animalReviewEsc(formatReviewDateClient(review.created_at)) : '') + '</div>' +
      '<div class="review-text">' + animalReviewEsc(review.review_text || '') + '</div>' +
    '</div>';
  }).join('');
}

async function loadAnimalReviews(animalId, offset, triggerButton){
  const box = document.querySelector('[data-animal-reviews]');
  if (!box || !animalId) return;
  box.dataset.animalId = animalId;
  const currentOffset = Number(offset || box.dataset.nextOffset || 0) || 0;

  try {
    const response = await fetch('/api/animal-reviews?animal=' + encodeURIComponent(animalId) + '&offset=' + encodeURIComponent(currentOffset), {cache:'no-store'});
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || 'Ошибка');

    const reviews = data.reviews || [];
    const button = data.has_more
      ? '<button type="button" class="review-more" data-review-more="1">Показать ещё</button>'
      : '';

    if (!reviews.length && currentOffset === 0) {
      box.innerHTML = '<div class="muted">Отзывов пока нет.</div>';
      box.dataset.nextOffset = 0;
      return;
    }

    const oldButton = box.querySelector('.review-more');
    if (oldButton) oldButton.remove();
    const html = renderAnimalReviewItems(reviews) + button;
    if (currentOffset === 0) box.innerHTML = html;
    else box.insertAdjacentHTML('beforeend', html);
    box.dataset.nextOffset = data.next_offset || (currentOffset + reviews.length);
  } catch (error) {
    if (currentOffset === 0) box.innerHTML = '<div class="muted">Не получилось загрузить отзывы.</div>';
    if (triggerButton) {
      triggerButton.disabled = false;
      triggerButton.textContent = 'Показать ещё';
    }
  }
}

document.addEventListener('click', function(event){
  const button = event.target && event.target.closest ? event.target.closest('[data-review-more]') : null;
  if (!button) return;
  if (button.disabled) return;
  const box = button.closest('[data-animal-reviews]');
  const animalId = box && box.dataset ? box.dataset.animalId : '';
  if (!animalId) return;
  button.disabled = true;
  button.textContent = 'Загружаю...';
  loadAnimalReviews(animalId, undefined, button);
});
</script>`;
  }

  function formHtml() {
    return `
<div class="section">
  <div data-animal-reviews class="reviews-list"></div>
</div>
<div class="section">
  <h2>Оставить отзыв о кошке</h2>
  <p>Чем больше добрых слов получает кошка, тем больше шансов у нее на пристройство.</p>
  <form class="review-form" onsubmit="return submitAnimalReview(this)">
    <input type="text" name="reviewer_name" placeholder="Ваше имя">
    <textarea name="review_text" placeholder="Ваш отзыв" required minlength="3"></textarea>
    <input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px">
    <button type="submit">💬 Отправить отзыв</button>
    <div class="review-status" data-review-status></div>
  </form>
</div>`;
  }

  function css() {
    return `
.review-form{display:grid;gap:10px}
.review-form input,.review-form textarea{
  width:100%;box-sizing:border-box;border:1px solid var(--border);
  border-radius:14px;padding:12px;font:inherit;background:#fffdf8;color:var(--text)
}
.review-form textarea{min-height:110px;resize:vertical}
.review-form button{
  border:0;border-radius:999px;padding:12px 16px;
  background:var(--accent);color:#fff;font-weight:700;cursor:pointer
}
.review-status{font-size:14px;color:var(--muted)}
.review-more{border:1px solid var(--border);border-radius:999px;padding:10px 14px;background:#fffdf8;color:var(--text);font-weight:700;cursor:pointer}
.reviews-list{display:grid;gap:10px}
.review-item{background:#fff7ec;border:1px solid var(--border);border-radius:14px;padding:12px}
.review-author{font-weight:700;margin-bottom:6px}
.review-text{white-space:pre-wrap;line-height:1.45}
.muted{color:var(--muted)}
`;
  }

  return {
    route,
    handleCreateReview,
    handleListReviews,
    getPublicReviews,
    publicReviewDto,
    getPendingReviews,
    publishReview,
    deleteReview,
    topReviewsBlock,
    formatReviewsText,
    sendReviews,
    startLeaveReview,
    handleReviewTextMessage,
    showModeration,
    registerBotHandlers,
    registerAdminHandlers,
    clientScript,
    formHtml,
    css,
  };
}

module.exports = {
  createAnimalReviewsModule,
};
