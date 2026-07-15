const axios = require("axios");

const DIRECTUS_URL = String(process.env.DIRECTUS_URL || "").replace(/\/$/, "");
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN || "";

const DIRECTUS_TIMEOUT_MS = Number(process.env.DIRECTUS_TIMEOUT_MS || 15000);
const CATS_WIDGET_LIMIT = Number(process.env.CATS_WIDGET_LIMIT || 10);
const CATS_CACHE_TTL_MS = Number(
  process.env.CATS_CACHE_TTL_MS || 5 * 60 * 1000,
);

let catsCache = {
  updatedAt: 0,
  cats: [],
};

function requireDirectusConfig() {
  if (!DIRECTUS_URL) {
    throw new Error("DIRECTUS_URL is required");
  }

  if (!DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_TOKEN is required");
  }
}

function apiHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${DIRECTUS_TOKEN}`,
    ...extra,
  };
}

function formatStatus(status) {
  const map = {
    looking_home: "Ищет дом",
    meeting: "На знакомстве",
    reserved: "Забронирована",
    adopted: "Уже дома",
  };

  return map[status] || "не указан";
}

function formatSex(sex) {
  if (!sex) return "";

  const value = String(sex).toLowerCase();

  if (["male", "m", "кот"].includes(value)) return "кот";
  if (["female", "f", "кошка"].includes(value)) return "кошка";

  return "";
}

function formatLocation(location) {
  const map = {
    novokuznetskaya: "Новокузнецкая",
    prospekt_mira: "Проспект Мира",
    tovarishcheskiy: "Таганка",
  };

  return map[location] || location || "";
}

function ageFromBirthDate(birthDate) {
  if (!birthDate) return "";

  const birth = new Date(birthDate);

  if (Number.isNaN(birth.getTime())) return "";

  const now = new Date();

  let months =
    (now.getFullYear() - birth.getFullYear()) * 12 +
    (now.getMonth() - birth.getMonth());

  if (now.getDate() < birth.getDate()) {
    months -= 1;
  }

  if (months < 0) return "";
  if (months < 12) return `${months} мес.`;

  const years = Math.floor(months / 12);
  const rest = months % 12;

  return rest ? `${years} г. ${rest} мес.` : `${years} г.`;
}

function truncateText(value, maxLen) {
  const text = String(value || "")
    .trim()
    .replace(/\s+/g, " ");

  if (!text) return "";
  if (text.length <= maxLen) return text;

  return text.slice(0, maxLen - 1).trim() + "…";
}

function extractFileId(value) {
  if (!value) return "";

  if (typeof value === "string") return value;

  if (typeof value === "object") {
    return value.id || value.directus_files_id || value.file_id || "";
  }

  return "";
}

function directusAssetUrl(fileId, options = {}) {
  const id = extractFileId(fileId);

  if (!id) return "";

  const params = new URLSearchParams();

  if (options.width) params.set("width", String(options.width));
  if (options.height) params.set("height", String(options.height));
  if (options.format) params.set("format", options.format);

  const query = params.toString();

  return `/directus-asset/${encodeURIComponent(id)}${query ? `?${query}` : ""}`;
}

function localMediaThumbUrl(fileId, extension) {
  const id = extractFileId(fileId);

  if (!id || !extension) return "";

  const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, "_");

  return `/cat-media/thumbs/${encodeURIComponent(safeId)}.${extension}`;
}

function photoThumbUrl(fileId) {
  return directusAssetUrl(fileId, { width: 480, format: "webp" });
}

function normalizeCat(animal, photoByAnimal = new Map(), mediaByAnimal = new Map()) {
  const id = animal.id;
  const slug = animal.slug || "";

  const photoId =
    extractFileId(animal.main_photo) || photoByAnimal.get(String(id)) || "";

  const photoUrl = photoId
    ? directusAssetUrl(photoId, { width: 720, format: "webp" })
    : "";
const sexLabel = formatSex(animal.sex);
const age = ageFromBirthDate(animal.birth_date);
const locationLabel = formatLocation(animal.location);

const category = String(animal.category || "")
  .trim()
  .toLowerCase();

const sex = String(animal.sex || "")
  .trim()
  .toLowerCase();

const isMale =
  sex === "male" ||
  sex === "m" ||
  sex === "кот";

let categoryLabel = "";

switch (category) {
  case "kitten":
    categoryLabel = "Котёнок";
    break;

  case "young":
    categoryLabel = isMale
      ? "Молодой кот"
      : "Молодая кошка";
    break;

  case "adult":
    categoryLabel = isMale
      ? "Взрослый кот"
      : "Взрослая кошка";
    break;

  case "senior":
    categoryLabel = "На доживании";
    break;

  case "special":
    categoryLabel = isMale
      ? "Особенный кот"
      : "Особенная кошка";
    break;

  default:
    categoryLabel = "";
}

let facts;

switch (category) {
  case "kitten":
  case "young":
  case "adult":
  case "special":
    facts = [
      age,
      locationLabel,
    ].filter(Boolean);
    break;

  case "senior":
  default:
    facts = [
      sexLabel,
      age,
      locationLabel,
    ].filter(Boolean);
    break;
}


return {
    id,
    slug,
    location: animal.location || "",
    locationLabel,
    name: animal.name || "Без имени",
    href: "/cats/" + encodeURIComponent(slug || id),
    photoUrl,
    
status: animal.status || "",
statusLabel: formatStatus(animal.status),

category,
categoryLabel,
categoryClass: category,

facts,

shortDescription: truncateText(
  animal.short_description,
  120,
),    description: animal.story || animal.short_description || "",
    sexLabel,
    age,
    locationLabel,
mediaGallery: (mediaByAnimal.get(String(id)) || []).filter(
  (item) => item.source !== "street",
),

streetMediaGallery: (mediaByAnimal.get(String(id)) || []).filter(
  (item) => item.source === "street",
),  };
}

async function directusGet(collection, params = {}) {
  requireDirectusConfig();

  const response = await axios.get(`${DIRECTUS_URL}/items/${collection}`, {
    headers: apiHeaders(),
    params,
    timeout: DIRECTUS_TIMEOUT_MS,
  });

  return Array.isArray(response.data && response.data.data)
    ? response.data.data
    : [];
}

async function loadCatalogRows() {
  return directusGet("animals", {
    filter: {
      published: {
        _eq: true,
      },
      status: {
        _eq: "looking_home",
      },
    },
fields: [
  "id",
  "name",
  "slug",
  "status",
  "category",
  "location",
  "sex",
  "birth_date",
  "short_description",
  "story",
  "published",
  "main_photo",
  "updated_at",
  "created_at",
].join(","),
    sort: "name",
    limit: 500,
  });
}

function normalizeAnimalMediaRows(rows) {
  const byAnimal = new Map();

  for (const row of rows) {
    const animalId = extractFileId(row.animal_id) || row.animal_id;
    const fileId = extractFileId(row.file_id);
    const type = String(row.type || "").toLowerCase();
    const source = String(row.source || "").trim().toLowerCase();

    if (!animalId || !fileId) continue;
    if (!['photo', 'image', 'video'].includes(type)) continue;

    const item = type === 'video'
      ? {
          type: 'video',
          fileId,
               source,
          poster: localMediaThumbUrl(fileId, 'webp'),
          thumbWebm: localMediaThumbUrl(fileId, 'webm'),
          thumbMp4: localMediaThumbUrl(fileId, 'mp4'),
          fullUrl: directusAssetUrl(fileId),
        }
      : {
          type: 'photo',
          fileId,
               source,
          thumbUrl: photoThumbUrl(fileId),
          fullUrl: directusAssetUrl(fileId, { width: 1600, format: 'webp' }),
        };

    const key = String(animalId);

    if (!byAnimal.has(key)) byAnimal.set(key, []);
    byAnimal.get(key).push(item);
  }

  for (const [key, items] of byAnimal.entries()) {
    const photos = items.filter((item) => item.type === 'photo');
    const videos = items.filter((item) => item.type === 'video');
    const mixed = [];
    const max = Math.max(photos.length, videos.length);

    for (let index = 0; index < max; index += 1) {
      if (photos[index]) mixed.push(photos[index]);
      if (videos[index]) mixed.push(videos[index]);
    }

    byAnimal.set(key, mixed.slice(0, 8));
  }

  return byAnimal;
}

async function loadAnimalMedia(animalIds) {
  if (!animalIds.length) return new Map();

  const rows = await directusGet('animal_media', {
    filter: {
      animal_id: {
        _in: animalIds,
      },
      type: {
        _in: ['photo', 'image', 'video'],
      },
    },
    fields: "id,animal_id,file_id,type,is_main,sort,source",
    sort: 'animal_id,-is_main,sort,id',
    limit: Math.max(500, animalIds.length * 12),
  });

  return normalizeAnimalMediaRows(rows);
}

async function loadMainPhotos(animalIds) {
  if (!animalIds.length) return new Map();

  const rows = await directusGet("animal_media", {
    filter: {
      animal_id: {
        _in: animalIds,
      },
      type: {
        _eq: "photo",
      },
    },
    fields: "id,animal_id,file_id,is_main,sort",
    sort: "animal_id,-is_main,sort",
    limit: Math.max(500, animalIds.length * 5),
  });

  const photoByAnimal = new Map();

  for (const row of rows) {
    const animalId = extractFileId(row.animal_id) || row.animal_id;
    const fileId = extractFileId(row.file_id);

    if (!animalId || !fileId) continue;
    if (photoByAnimal.has(String(animalId))) continue;

    photoByAnimal.set(String(animalId), fileId);
  }

  return photoByAnimal;
}

function shuffle(items) {
  const list = Array.isArray(items) ? items.slice() : [];

  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }

  return list;
}

async function loadCatsFromDirectus({ force = false } = {}) {
  const now = Date.now();

  if (
    !force &&
    catsCache.cats.length &&
    now - catsCache.updatedAt < CATS_CACHE_TTL_MS
  ) {
    return catsCache.cats;
  }

  const animals = await loadCatalogRows();
  const ids = animals.map((animal) => animal.id).filter(Boolean);
  const photoByAnimal = await loadMainPhotos(ids);
  const mediaByAnimal = await loadAnimalMedia(ids);
  const cats = animals.map((animal) => normalizeCat(animal, photoByAnimal, mediaByAnimal));

  catsCache = {
    updatedAt: now,
    cats,
  };

  return cats;
}

async function loadCatsForCatalog() {
  try {
    const cats = await loadCatsFromDirectus();

    return {
      cats,
      error: null,
    };
  } catch (error) {
    console.error(
      "Failed to load cats from Directus:",
      error.response?.data || error.message,
    );

    if (catsCache.cats.length) {
      return {
        cats: catsCache.cats,
        error: null,
      };
    }

    return {
      cats: [],
      error: "Не получилось загрузить кошек. Попробуйте обновить страницу.",
    };
  }
}

async function loadCatsForWidget(limit = CATS_WIDGET_LIMIT) {
  const result = await loadCatsForCatalog();

  return {
    cats: shuffle(result.cats).slice(0, limit),
    error: result.error,
  };
}

async function loadCatBySlugOrId(slugOrId) {
  const identifier = String(slugOrId || "").trim();

  if (!identifier) return null;

  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      identifier,
    );

  const filter = isUuid
    ? {
        id: {
          _eq: identifier,
        },
        published: {
          _eq: true,
        },
      }
    : {
        slug: {
          _eq: identifier,
        },
        published: {
          _eq: true,
        },
      };

  const rows = await directusGet("animals", {
    filter,
    fields: [
      "id",
      "name",
      "slug",
      "status",
      "location",
      "sex",
      "birth_date",
      "short_description",
      "story",
      "published",
      "main_photo",
      "updated_at",
      "created_at",
    ].join(","),
    limit: 1,
  });

  const animal = rows[0];

  if (!animal || animal.status !== "looking_home") {
    return null;
  }

  const photoByAnimal = await loadMainPhotos([animal.id]);
  const mediaByAnimal = await loadAnimalMedia([animal.id]);

  return normalizeCat(animal, photoByAnimal, mediaByAnimal);
}

async function loadCatsForSitemap() {
  const rows = await directusGet("animals", {
    filter: {
      published: {
        _eq: true,
      },
      status: {
        _eq: "looking_home",
      },
    },
    fields: [
      "id",
      "name",
      "slug",
      "short_description",
      "main_photo",
      "updated_at",
      "created_at",
    ].join(","),
    sort: "name",
    limit: 500,
  });

  const ids = rows.map((cat) => cat.id).filter(Boolean);
  const photoByAnimal = await loadMainPhotos(ids);

  return rows
    .filter((cat) => cat && cat.id && (cat.slug || cat.id))
    .map((cat) => {
      const photoId =
        extractFileId(cat.main_photo) ||
        photoByAnimal.get(String(cat.id)) ||
        "";

const categoryInfo = {
  kitten: {
    label: "🐱 Котёнок",
    className: "kitten",
  },
  young: {
    label: "🌿 Молодая кошка",
    className: "young",
  },
  adult: {
    label: "🐈 Зрелая кошка",
    className: "adult",
  },
  senior: {
    label: "💜 На доживании",
    className: "senior",
  },
  special: {
    label: "💙 Особенная кошка",
    className: "special",
  },
};

const category =
  String(animal.category || "")
    .trim()
    .toLowerCase();

const categoryMeta =
  categoryInfo[category] || null;

      return {
        id: cat.id,
        name: cat.name || "",
        slug: cat.slug || "",
        category,

categoryLabel:
  categoryMeta?.label || "",

categoryClass:
  categoryMeta?.className || "",
        shortDescription: truncateText(cat.short_description, 180),
        updatedAt: cat.updated_at || cat.created_at || "",
        imageUrl: photoId
          ? directusAssetUrl(photoId, { width: 1200, format: "jpg" })
          : "",
      };
    });
}

module.exports = {
  loadCatsForCatalog,
  loadCatsForWidget,
  loadCatBySlugOrId,
  loadCatsForSitemap,
};
