#!/usr/bin/env node
"use strict";

require("dotenv").config({ quiet: true });
const axios = require("axios");

const baseURL = String(process.env.DIRECTUS_URL || "").replace(/\/+$/, "");
const token = String(process.env.DIRECTUS_TOKEN || "").trim();
if (!baseURL || !token) throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN are required");

const api = axios.create({
  baseURL,
  timeout: 30000,
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
});

const force = process.argv.includes("--force");

const seeds = [
  { slug: "affectionate", nameMale: "Ласковый", nameFemale: "Ласковая", icon: "❤️", group: "character", sort: 10 },
  { slug: "friendly", nameMale: "Дружелюбный", nameFemale: "Дружелюбная", icon: "🤝", group: "social", sort: 20 },
  { slug: "cautious", nameMale: "Осторожный", nameFemale: "Осторожная", icon: "👀", group: "character", sort: 30 },
  { slug: "playful", nameMale: "Игривый", nameFemale: "Игривая", icon: "🎾", group: "activity", sort: 40 },
  { slug: "calm", nameMale: "Спокойный", nameFemale: "Спокойная", icon: "🕊️", group: "character", sort: 50 },
  { slug: "social", nameMale: "Общительный", nameFemale: "Общительная", icon: "💬", group: "social", sort: 60 },
  { slug: "independent", nameMale: "Независимый", nameFemale: "Независимая", icon: "🐾", group: "character", sort: 70 },
  { slug: "curious", nameMale: "Любопытный", nameFemale: "Любопытная", icon: "🔎", group: "activity", sort: 80 },
  { slug: "active", nameMale: "Активный", nameFemale: "Активная", icon: "⚡", group: "activity", sort: 90 },
  { slug: "shy", nameMale: "Застенчивый", nameFemale: "Застенчивая", icon: "🌿", group: "character", sort: 100 },
  { slug: "confident", nameMale: "Уверенный", nameFemale: "Уверенная", icon: "⭐", group: "character", sort: 110 },
  { slug: "gentle", nameMale: "Нежный", nameFemale: "Нежная", icon: "🌸", group: "character", sort: 120 },
  { slug: "human_oriented", nameMale: "Ориентирован на человека", nameFemale: "Ориентирована на человека", icon: "🫶", group: "social", sort: 130 },
  { slug: "does_not_like_being_held", nameMale: "Не любит сидеть на руках", nameFemale: "Не любит сидеть на руках", icon: "🙅", group: "social", sort: 140 },
  { slug: "likes_other_cats", nameMale: "Любит других кошек", nameFemale: "Любит других кошек", icon: "🐈", group: "social", sort: 150 },
  { slug: "only_cat_preferred", nameMale: "Лучше единственным котиком", nameFemale: "Лучше единственной кошкой", icon: "🏠", group: "social", sort: 160 },
  { slug: "needs_time_to_adapt", nameMale: "Нужно время на адаптацию", nameFemale: "Нужно время на адаптацию", icon: "⏳", group: "character", sort: 170 },
];

const report = {
  fieldsCreated: 0,
  fieldsExisting: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  errors: 0,
};

function isMissing(error) {
  return [403, 404].includes(error?.response?.status);
}

async function exists(path) {
  try {
    await api.get(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function ensureCollection(collection, note) {
  if (await exists(`/collections/${collection}`)) return console.log(`collection ${collection}: exists`);
  await api.post("/collections", {
    collection,
    meta: { icon: "pets", note, hidden: false, singleton: false },
    schema: { name: collection },
    fields: [{
      field: "id",
      type: "uuid",
      meta: { hidden: true, readonly: true, interface: "input", special: ["uuid"] },
      schema: {
        is_primary_key: true,
        is_unique: true,
        is_nullable: false,
        default_value: "gen_random_uuid()",
      },
    }],
  });
  console.log(`collection ${collection}: created`);
}

async function ensureField(collection, field) {
  if (await exists(`/fields/${collection}/${field.field}`)) {
    if (["name_male", "name_female"].includes(field.field)) report.fieldsExisting += 1;
    return false;
  }
  await api.post(`/fields/${collection}`, field);
  console.log(`field ${collection}.${field.field}: created`);
  if (["name_male", "name_female"].includes(field.field)) report.fieldsCreated += 1;
  return true;
}

async function ensureRelation(payload) {
  if (await exists(`/relations/${payload.collection}/${payload.field}`)) return;
  await api.post("/relations", payload);
  console.log(`relation ${payload.collection}.${payload.field}: created`);
}

const input = (field, type, schema = {}, meta = {}) => ({
  field,
  type,
  schema,
  meta: { interface: type === "text" ? "input-multiline" : "input", ...meta },
});

async function ensureSchema() {
  await ensureCollection("animal_traits", "Справочник характера и особенностей животных");
  await ensureField("animal_traits", input("name", "string", { is_nullable: false, max_length: 255 }, { required: true, width: "half" }));
  await ensureField("animal_traits", input("name_male", "string", { is_nullable: true, max_length: 255 }, {
    required: true,
    width: "half",
    sort: 3,
    translations: [{ language: "ru-RU", translation: "Мужская форма" }],
  }));
  await ensureField("animal_traits", input("name_female", "string", { is_nullable: true, max_length: 255 }, {
    required: true,
    width: "half",
    sort: 4,
    translations: [{ language: "ru-RU", translation: "Женская форма" }],
  }));
  await ensureField("animal_traits", input("slug", "string", { is_nullable: false, is_unique: true, max_length: 255 }, { required: true, width: "half" }));
  await ensureField("animal_traits", input("description", "text", { is_nullable: true }, { width: "full" }));
  await ensureField("animal_traits", input("icon", "string", { is_nullable: true, max_length: 32 }, { width: "half" }));
  await ensureField("animal_traits", input("group", "string", { is_nullable: true, max_length: 100 }, { width: "half" }));
  await ensureField("animal_traits", input("sort", "integer", { is_nullable: false, default_value: 100 }, { width: "half" }));
  await ensureField("animal_traits", { field: "is_active", type: "boolean", schema: { is_nullable: false, default_value: true }, meta: { interface: "boolean", width: "half" } });
  await ensureField("animal_traits", { field: "show_on_site", type: "boolean", schema: { is_nullable: false, default_value: true }, meta: { interface: "boolean", width: "half" } });
  await ensureField("animal_traits", { field: "date_created", type: "timestamp", schema: { is_nullable: false, default_value: "now()" }, meta: { special: ["date-created"], interface: "datetime", readonly: true, hidden: true } });
  await ensureField("animal_traits", { field: "date_updated", type: "timestamp", schema: { is_nullable: true }, meta: { special: ["date-updated"], interface: "datetime", readonly: true, hidden: true } });

  await ensureCollection("animals_animal_traits", "Связи животных с атрибутами характера");
  await ensureField("animals_animal_traits", { field: "animal_id", type: "uuid", schema: { is_nullable: false, is_indexed: true }, meta: { special: ["m2o"], interface: "select-dropdown-m2o", required: true, width: "half" } });
  await ensureField("animals_animal_traits", { field: "trait_id", type: "uuid", schema: { is_nullable: false, is_indexed: true }, meta: { special: ["m2o"], interface: "select-dropdown-m2o", required: true, width: "half" } });
  await ensureField("animals_animal_traits", input("pair_key", "string", { is_nullable: false, is_unique: true, max_length: 80 }, { required: true, hidden: true, readonly: true }));
  await ensureField("animals_animal_traits", input("sort", "integer", { is_nullable: false, default_value: 100 }, { width: "half" }));
  await ensureField("animals_animal_traits", { field: "date_created", type: "timestamp", schema: { is_nullable: false, default_value: "now()" }, meta: { special: ["date-created"], interface: "datetime", readonly: true, hidden: true } });
  await ensureField("animals", { field: "traits", type: "alias", schema: null, meta: { special: ["m2m"], interface: "list-m2m", display: "related-values", display_options: { template: "{{trait_id.name}}" } } });

  await ensureRelation({
    collection: "animals_animal_traits",
    field: "animal_id",
    related_collection: "animals",
    schema: { on_delete: "CASCADE" },
    meta: { one_field: "traits", junction_field: "trait_id", sort_field: "sort", one_deselect_action: "delete" },
  });
  await ensureRelation({
    collection: "animals_animal_traits",
    field: "trait_id",
    related_collection: "animal_traits",
    schema: { on_delete: "CASCADE" },
    meta: { one_field: null, junction_field: "animal_id", one_deselect_action: "delete" },
  });
}

async function seedTraits() {
  for (const seed of seeds) {
    try {
      const response = await api.get("/items/animal_traits", {
        params: {
          filter: { slug: { _eq: seed.slug } },
          fields: "id,slug,name,name_male,name_female",
          limit: 1,
        },
      });
      const existing = response.data?.data?.[0];
      if (!existing) {
        await api.post("/items/animal_traits", {
          slug: seed.slug,
          name: seed.nameMale,
          name_male: seed.nameMale,
          name_female: seed.nameFemale,
          icon: seed.icon,
          group: seed.group,
          sort: seed.sort,
          is_active: true,
          show_on_site: true,
        });
        report.created += 1;
        continue;
      }

      const patch = {};
      if (force || !String(existing.name_male || "").trim()) patch.name_male = seed.nameMale;
      if (force || !String(existing.name_female || "").trim()) patch.name_female = seed.nameFemale;
      if (Object.keys(patch).length) {
        await api.patch(`/items/animal_traits/${existing.id}`, patch);
        report.updated += 1;
      } else {
        report.unchanged += 1;
      }
    } catch (error) {
      report.errors += 1;
      console.error(`trait ${seed.slug}: ${error.response?.data?.errors?.[0]?.message || error.message}`);
    }
  }
}

async function finalizeFields() {
  const positions = {
    name_male: 3,
    name_female: 4,
    slug: 5,
    description: 6,
    icon: 7,
    group: 8,
    sort: 9,
    is_active: 10,
    show_on_site: 11,
    date_created: 12,
    date_updated: 13,
  };
  for (const [field, sort] of Object.entries(positions)) {
    const payload = { meta: { sort } };
    if (field === "name_male" || field === "name_female") {
      payload.schema = { is_nullable: false, max_length: 255 };
      payload.meta.required = true;
      payload.meta.width = "half";
      payload.meta.translations = [{
        language: "ru-RU",
        translation: field === "name_male" ? "Мужская форма" : "Женская форма",
      }];
    }
    await api.patch(`/fields/animal_traits/${field}`, payload);
  }
}

(async () => {
  await ensureSchema();
  await seedTraits();
  if (report.errors) throw new Error(`Не удалось обработать атрибуты: ${report.errors}`);
  await finalizeFields();
  console.log([
    `fields: created=${report.fieldsCreated}, existing=${report.fieldsExisting}`,
    `records: created=${report.created}, updated=${report.updated}, unchanged=${report.unchanged}, errors=${report.errors}`,
    `mode: ${force ? "force" : "safe"}`,
  ].join("\n"));
})().catch((error) => {
  console.error(error.response?.data ? JSON.stringify(error.response.data, null, 2) : error.stack || error.message);
  process.exit(1);
});
