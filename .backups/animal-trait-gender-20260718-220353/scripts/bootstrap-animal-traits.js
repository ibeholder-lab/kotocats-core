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

const seeds = [
  ["affectionate", "Ласковый", "❤️", "character", 10],
  ["friendly", "Дружелюбный", "🤝", "social", 20],
  ["cautious", "Осторожный", "👀", "character", 30],
  ["playful", "Игривый", "🎾", "activity", 40],
  ["calm", "Спокойный", "🕊️", "character", 50],
  ["social", "Общительный", "💬", "social", 60],
  ["independent", "Независимый", "🐾", "character", 70],
  ["curious", "Любопытный", "🔎", "activity", 80],
  ["active", "Активный", "⚡", "activity", 90],
  ["shy", "Застенчивый", "🌿", "character", 100],
  ["confident", "Уверенный", "⭐", "character", 110],
  ["gentle", "Нежный", "🌸", "character", 120],
  ["human_oriented", "Ориентирован на человека", "🫶", "social", 130],
  ["does_not_like_being_held", "Не любит сидеть на руках", "🙅", "social", 140],
  ["likes_other_cats", "Любит других кошек", "🐈", "social", 150],
  ["only_cat_preferred", "Лучше единственным котиком", "🏠", "social", 160],
  ["needs_time_to_adapt", "Нужно время на адаптацию", "⏳", "character", 170],
];

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
  if (await exists(`/fields/${collection}/${field.field}`)) return;
  await api.post(`/fields/${collection}`, field);
  console.log(`field ${collection}.${field.field}: created`);
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
  let created = 0;
  let existing = 0;
  for (const [slug, name, icon, group, sort] of seeds) {
    const response = await api.get("/items/animal_traits", {
      params: { filter: { slug: { _eq: slug } }, fields: "id", limit: 1 },
    });
    if (response.data?.data?.length) {
      existing += 1;
      continue;
    }
    try {
      await api.post("/items/animal_traits", {
        slug, name, icon, group, sort, is_active: true, show_on_site: true,
      });
      created += 1;
    } catch (error) {
      if (error.response?.status === 409) existing += 1;
      else throw error;
    }
  }
  console.log(`seed: created=${created}, existing=${existing}`);
}

(async () => {
  await ensureSchema();
  await seedTraits();
})().catch((error) => {
  console.error(error.response?.data ? JSON.stringify(error.response.data, null, 2) : error.stack || error.message);
  process.exit(1);
});
