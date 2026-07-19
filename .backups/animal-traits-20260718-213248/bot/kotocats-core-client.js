const axios = require('axios');

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();

  if (!raw) return fallback;

  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function trimSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function coreBaseUrl() {
  return trimSlash(
    process.env.KOTOCATS_CORE_PUBLIC_URL ||
    process.env.KOTOCATS_CORE_BASE_URL ||
    ''
  );
}

function coreInternalUrl() {
  return trimSlash(
    process.env.KOTOCATS_CORE_INTERNAL_URL ||
    'http://127.0.0.1:3010'
  );
}

function coreAuthHeaders() {
  const token = String(process.env.KOTOCATS_CORE_INTERNAL_TOKEN || '').trim();
  return token ? { 'X-Kotocats-Core-Token': token } : {};
}

function coreModeEnabled() {
  return boolEnv('KOTOCATS_CORE_MODE', true);
}

function fillTemplate(template, values = {}) {
  return String(template || '').replace(
    /\{([a-zA-Z0-9_]+)\}/g,
    (_, key) =>
      encodeURIComponent(
        values[key] == null ? '' : String(values[key])
      )
  );
}

function buildUrl(pathname = '/', params = {}) {
  const base = coreBaseUrl();

  if (!base || !/^https?:\/\//i.test(base)) {
    return null;
  }

  const url = new URL(String(pathname || '/'), `${base}/`);

  Object.entries(params || {}).forEach(([key, value]) => {
    if (
      value !== undefined &&
      value !== null &&
      value !== ''
    ) {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

function animalId(animalOrId) {
  if (!animalOrId) return '';

  if (typeof animalOrId === 'string') {
    return animalOrId;
  }

  return (
    animalOrId.id ||
    animalOrId.uuid ||
    animalOrId.slug ||
    ''
  );
}

function catalogUrl() {
  const template =
    process.env.KOTOCATS_CORE_CATALOG_URL_TEMPLATE || '';

  if (template) {
    return fillTemplate(template, {});
  }

  return buildUrl(
    process.env.KOTOCATS_CORE_CATALOG_PATH || '/cats'
  );
}

function catPageUrl(animalOrId) {
  const id = animalId(animalOrId);

  if (!id) return null;

  const template =
    process.env.KOTOCATS_CORE_CAT_PAGE_URL_TEMPLATE || '';

  if (template) {
    return fillTemplate(template, {
      id,
      animal: id,
      slug: id,
    });
  }

  return buildUrl(
    process.env.KOTOCATS_CORE_CAT_PAGE_PATH ||
      `/cats/${encodeURIComponent(id)}`
  );
}

function donateUrl(animalOrId, extra = {}) {
  const id = animalId(animalOrId);
  const slug = String(
    animalOrId && typeof animalOrId === 'object'
      ? animalOrId.slug || id
      : id
  ).trim() || id;

  if (!id) return null;

  const template =
    process.env.KOTOCATS_CORE_DONATE_URL_TEMPLATE || '';

  if (template) {
    return fillTemplate(template, {
      id,
      animal: id,
      slug,
      ...extra,
    });
  }

  return buildUrl(
    process.env.KOTOCATS_CORE_DONATE_PATH || '/donate',
    {
      animal: id,
      ...extra,
    }
  );
}

function successUrl(animalOrId, extra = {}) {
  const id = animalId(animalOrId);

  const template =
    process.env.KOTOCATS_CORE_SUCCESS_URL_TEMPLATE || '';

  if (template) {
    return fillTemplate(template, {
      id,
      animal: id,
      slug: id,
      ...extra,
    });
  }

  return buildUrl(
    process.env.KOTOCATS_CORE_SUCCESS_PATH || '/success',
    {
      ...(id ? { animal: id } : {}),
      ...extra,
    }
  );
}

async function postCore(pathname, payload = {}) {
  const base = coreInternalUrl();

  if (!base || !/^https?:\/\//i.test(base)) {
    throw new Error(
      'KOTOCATS_CORE_INTERNAL_URL is not configured'
    );
  }

  const timeout = Number(
    process.env.KOTOCATS_CORE_TIMEOUT_MS || 30000
  );

  const url = `${base}${pathname.startsWith('/') ? '' : '/'}${pathname}`;

  try {
    const response = await axios.post(url, payload, {
      timeout,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...coreAuthHeaders(),
      },
    });

    return response.data;
  } catch (error) {
    const status = error?.response?.status;
    const responseData = error?.response?.data;

    const message =
      responseData?.error ||
      responseData?.message ||
      (typeof responseData === 'string'
        ? responseData
        : error.message);

    const wrapped = new Error(
      `kotocats-core request failed${
        status ? ` (${status})` : ''
      }: ${message}`
    );

    wrapped.status = status || null;
    wrapped.responseData = responseData || null;
    wrapped.cause = error;

    throw wrapped;
  }
}

async function createDonationPayment(payload = {}) {
  if (!coreModeEnabled()) {
    throw new Error(
      'KOTOCATS_CORE_MODE must be enabled for donations'
    );
  }

  const animal = payload.animal || {
    id: payload.animalId || null,
    name: payload.animalName || 'Кошка',
  };

  if (!animal?.id) {
    throw new Error(
      'animal.id is required for donation payment'
    );
  }

  const donor = payload.donor || {};
  const telegram = payload.telegramContext || {};

  const requestPayload = {
    animal_id: animal.id,
    animalId: animal.id,

    animal_name:
      animal.name ||
      payload.animalName ||
      'Кошка',

    animalName:
      animal.name ||
      payload.animalName ||
      'Кошка',

    amount:
      Number(payload.amountRub || payload.amount),

    amountRub:
      Number(payload.amountRub || payload.amount),

    payment_type:
      payload.paymentType === 'feed'
        ? 'feed'
        : 'donate',

    paymentType:
      payload.paymentType === 'feed'
        ? 'feed'
        : 'donate',

    source:
      payload.source ||
      'telegram_bot',

    need_id:
      payload.needId ||
      null,

    need_title:
      payload.needTitle ||
      null,

    comment:
      payload.comment ||
      null,

    public_thanks:
      payload.publicThanks ?? null,

    ask_public_thanks_after_payment:
      Boolean(
        payload.askPublicThanksAfterPayment
      ),

    donor_telegram_id:
      donor.telegramId ||
      payload.donorTelegramId ||
      null,

    donor_username:
      donor.username ||
      payload.donorUsername ||
      null,

    donor_first_name:
      donor.firstName ||
      null,

    donor_last_name:
      donor.lastName ||
      null,

    donor_phone:
      donor.phone ||
      payload.donorPhone ||
      null,

    donor_email:
      donor.email ||
      payload.donorEmail ||
      null,

    success_url:
      payload.successUrl ||
      null,

    failure_url:
      payload.failureUrl ||
      null,

    telegram_context: {
      sourceChatId:
        telegram.sourceChatId ||
        null,

      sourceMessageId:
        telegram.sourceMessageId ||
        null,

      sourceThreadId:
        telegram.sourceThreadId ||
        null,

      thanksChatId:
        telegram.thanksChatId ||
        null,

      thanksThreadId:
        telegram.thanksThreadId ||
        null,
    },

    raw_request_extra:
      payload.rawRequestExtra &&
      typeof payload.rawRequestExtra === 'object'
        ? payload.rawRequestExtra
        : null,
  };

  const path =
    process.env.KOTOCATS_CORE_MIXPLAT_CREATE_PATH ||
    '/api/donations/create';

  return postCore(path, requestPayload);
}


async function getDonationThanksQueue(limit = 20) {
  const base = coreInternalUrl();
  const response = await axios.get(`${base}/api/donations/thanks-queue`, {
    timeout: Number(process.env.KOTOCATS_CORE_TIMEOUT_MS || 30000),
    headers: { Accept: 'application/json', ...coreAuthHeaders() },
    params: { limit },
  });
  return response.data?.data || [];
}

async function getDonationById(donationId) {
  const id = String(donationId || '').trim();
  if (!id) throw new Error('donationId is required');
  const base = coreInternalUrl();
  const response = await axios.get(`${base}/api/donations/${encodeURIComponent(id)}`, {
    timeout: Number(process.env.KOTOCATS_CORE_TIMEOUT_MS || 30000),
    headers: { Accept: 'application/json', ...coreAuthHeaders() },
  });
  return response.data?.data || null;
}

async function patchDonation(donationId, patch = {}) {
  const id = String(donationId || '').trim();
  if (!id) throw new Error('donationId is required');
  const base = coreInternalUrl();
  const response = await axios.patch(
    `${base}/api/donations/${encodeURIComponent(id)}`,
    patch,
    {
      timeout: Number(process.env.KOTOCATS_CORE_TIMEOUT_MS || 30000),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...coreAuthHeaders(),
      },
    }
  );
  return response.data?.data || null;
}

async function getDonationStatus(paymentId) {
  const id = String(paymentId || '').trim();

  if (!id) {
    throw new Error('paymentId is required');
  }

  const base = coreInternalUrl();

  const response = await axios.get(
    `${base}/api/donations/${encodeURIComponent(id)}`,
    {
      timeout: Number(
        process.env.KOTOCATS_CORE_TIMEOUT_MS || 30000
      ),
      headers: {
        Accept: 'application/json',
        ...coreAuthHeaders(),
      },
    }
  );

  return response.data;
}

module.exports = {
  coreModeEnabled,
  coreBaseUrl,
  coreInternalUrl,
  buildUrl,
  catalogUrl,
  catPageUrl,
  donateUrl,
  successUrl,
  createDonationPayment,
  getDonationStatus,
  getDonationThanksQueue,
  getDonationById,
  patchDonation,
};
