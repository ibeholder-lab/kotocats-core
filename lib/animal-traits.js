"use strict";

const TRAIT_FIELDS = "id,slug,name,name_male,name_female,icon,description,group,sort,is_active,show_on_site";
const JUNCTION_FIELDS = [
  "id",
  "animal_id",
  "sort",
  ...TRAIT_FIELDS.split(",").map((field) => `trait_id.${field}`),
].join(",");

function unwrap(response) {
  const payload = response && Object.prototype.hasOwnProperty.call(response, "data")
    ? response.data
    : response;
  return payload && Object.prototype.hasOwnProperty.call(payload, "data")
    ? payload.data
    : payload;
}

function asId(value) {
  if (value && typeof value === "object") return String(value.id || "").trim();
  return String(value || "").trim();
}

function normalizeTrait(value) {
  if (!value || typeof value !== "object") return null;
  const id = asId(value.id);
  if (!id) return null;
  const slug = String(value.slug || "").trim();
  const nameMale = String(
    value.nameMale || value.name_male || value.name || value.title || value.nameFemale || value.name_female || slug,
  ).trim();
  const nameFemale = String(
    value.nameFemale || value.name_female || value.nameMale || value.name_male || value.name || value.title || slug,
  ).trim();
  return {
    id,
    slug,
    name: nameMale,
    nameMale,
    nameFemale,
    name_male: nameMale,
    name_female: nameFemale,
    icon: value.icon ? String(value.icon).trim() : null,
    description: value.description ? String(value.description).trim() : null,
    group: value.group ? String(value.group).trim() : null,
    sort: Number.isFinite(Number(value.sort)) ? Number(value.sort) : 100,
  };
}

function sortTraits(traits) {
  return traits.sort((left, right) => (
    left.sort - right.sort || left.nameMale.localeCompare(right.nameMale, "ru")
  ));
}

function getTraitDisplayName(trait, animalSex) {
  const slug = String(trait?.slug || "").trim();
  const nameMale = String(
    trait?.nameMale || trait?.name_male || trait?.name || trait?.title || "",
  ).trim();
  const nameFemale = String(
    trait?.nameFemale || trait?.name_female || "",
  ).trim();
  if (String(animalSex || "").trim().toLowerCase() === "female") {
    return nameFemale || nameMale || slug;
  }
  return nameMale || nameFemale || slug;
}

function withDisplayName(trait, animalSex) {
  const displayName = getTraitDisplayName(trait, animalSex);
  return {
    ...trait,
    name: displayName,
    displayName,
    display_name: displayName,
  };
}

function pairKey(animalId, traitId) {
  return `${animalId}:${traitId}`;
}

function isConflict(error) {
  return error?.response?.status === 409
    || error?.status === 409
    || /unique|duplicate/i.test(error?.response?.data?.errors?.[0]?.message || error?.message || "");
}

function createAnimalTraitsService({ client }) {
  if (!client || typeof client.get !== "function") {
    throw new Error("animal-traits: Directus client is required");
  }

  const locks = new Map();

  async function getItems(collection, params) {
    const result = unwrap(await client.get(`/items/${collection}`, { params }));
    return Array.isArray(result) ? result : [];
  }

  async function getItem(collection, id, params = {}) {
    try {
      return unwrap(await client.get(`/items/${collection}/${encodeURIComponent(id)}`, { params }));
    } catch (error) {
      if (error?.response?.status === 404 || error?.status === 404) return null;
      throw error;
    }
  }

  async function getActiveTraits() {
    const rows = await getItems("animal_traits", {
      filter: { is_active: { _eq: true } },
      fields: TRAIT_FIELDS,
      sort: "sort,name",
      limit: -1,
    });
    return sortTraits(rows.map(normalizeTrait).filter(Boolean));
  }

  async function getAnimalTraits(animalId, { publicOnly = false, animalSex = null } = {}) {
    const id = asId(animalId);
    if (!id) return [];
    const traitFilter = { is_active: { _eq: true } };
    if (publicOnly) traitFilter.show_on_site = { _eq: true };
    const rows = await getItems("animals_animal_traits", {
      filter: { animal_id: { _eq: id }, trait_id: traitFilter },
      fields: JUNCTION_FIELDS,
      sort: "sort,trait_id.sort,trait_id.name",
      limit: -1,
    });
    return sortTraits(rows.map((row) => normalizeTrait(row.trait_id)).filter(Boolean))
      .map((trait) => withDisplayName(trait, animalSex));
  }

  async function assertAnimalAndTrait(animalId, traitId) {
    const [animal, trait] = await Promise.all([
      getItem("animals", animalId, { fields: "id,name" }),
      getItem("animal_traits", traitId, { fields: TRAIT_FIELDS }),
    ]);
    if (!animal) {
      const error = new Error("Животное не найдено");
      error.code = "ANIMAL_NOT_FOUND";
      error.status = 404;
      throw error;
    }
    if (!trait) {
      const error = new Error("Атрибут не найден");
      error.code = "TRAIT_NOT_FOUND";
      error.status = 404;
      throw error;
    }
    if (trait.is_active !== true) {
      const error = new Error("Неактивный атрибут нельзя назначить");
      error.code = "TRAIT_INACTIVE";
      error.status = 409;
      throw error;
    }
    return { animal, trait };
  }

  async function findLinks(animalId, traitId) {
    return getItems("animals_animal_traits", {
      filter: { animal_id: { _eq: animalId }, trait_id: { _eq: traitId } },
      fields: "id,animal_id,trait_id",
      limit: 10,
    });
  }

  async function setAnimalTrait(animalIdValue, traitIdValue, enabled) {
    const animalId = asId(animalIdValue);
    const traitId = asId(traitIdValue);
    if (!animalId || !traitId) {
      const error = new Error("animalId и traitId обязательны");
      error.status = 400;
      throw error;
    }

    if (enabled) {
      await assertAnimalAndTrait(animalId, traitId);
      const existing = await findLinks(animalId, traitId);
      if (!existing.length) {
        try {
          await client.post("/items/animals_animal_traits", {
            animal_id: animalId,
            trait_id: traitId,
            pair_key: pairKey(animalId, traitId),
            sort: 100,
          });
        } catch (error) {
          if (!isConflict(error)) throw error;
        }
      }
    } else {
      const animal = await getItem("animals", animalId, { fields: "id" });
      if (!animal) {
        const error = new Error("Животное не найдено");
        error.code = "ANIMAL_NOT_FOUND";
        error.status = 404;
        throw error;
      }
      const existing = await findLinks(animalId, traitId);
      await Promise.all(existing.map((link) => client.delete(
        `/items/animals_animal_traits/${encodeURIComponent(link.id)}`,
      )));
    }

    return { animal_id: animalId, trait_id: traitId, selected: Boolean(enabled) };
  }

  function withLock(key, callback) {
    const previous = locks.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(callback);
    locks.set(key, current);
    return current.finally(() => {
      if (locks.get(key) === current) locks.delete(key);
    });
  }

  async function toggleAnimalTrait(animalIdValue, traitIdValue) {
    const animalId = asId(animalIdValue);
    const traitId = asId(traitIdValue);
    return withLock(pairKey(animalId, traitId), async () => {
      await assertAnimalAndTrait(animalId, traitId);
      const existing = await findLinks(animalId, traitId);
      return setAnimalTrait(animalId, traitId, existing.length === 0);
    });
  }

  async function getAnimalTraitsState(animalIdValue) {
    const animalId = asId(animalIdValue);
    const animal = await getItem("animals", animalId, { fields: "id,name,sex" });
    if (!animal) {
      const error = new Error("Животное не найдено");
      error.code = "ANIMAL_NOT_FOUND";
      error.status = 404;
      throw error;
    }
    const [traits, selectedTraits] = await Promise.all([
      getActiveTraits(),
      getAnimalTraits(animalId, { animalSex: animal.sex }),
    ]);
    const selected = new Set(selectedTraits.map((trait) => trait.id));
    return {
      animal: {
        id: String(animal.id),
        name: String(animal.name || "Без имени"),
        sex: animal.sex || null,
      },
      traits: traits.map((trait) => ({
        ...withDisplayName(trait, animal.sex),
        selected: selected.has(trait.id),
      })),
    };
  }

  async function getAnimalsWithTraits(animals, { publicOnly = false } = {}) {
    const list = Array.isArray(animals) ? animals : [];
    if (!list.length) return [];
    const ids = list.map((animal) => asId(animal)).filter(Boolean);
    const traitFilter = { is_active: { _eq: true } };
    if (publicOnly) traitFilter.show_on_site = { _eq: true };
    const rows = await getItems("animals_animal_traits", {
      filter: { animal_id: { _in: ids }, trait_id: traitFilter },
      fields: JUNCTION_FIELDS,
      sort: "sort,trait_id.sort,trait_id.name",
      limit: -1,
    });
    const byAnimal = new Map(ids.map((id) => [id, []]));
    for (const row of rows) {
      const id = asId(row.animal_id);
      const trait = normalizeTrait(row.trait_id);
      if (trait && byAnimal.has(id)) byAnimal.get(id).push(trait);
    }
    return list.map((animal) => ({
      ...animal,
      traits: sortTraits(byAnimal.get(asId(animal)) || [])
        .map((trait) => withDisplayName(trait, animal.sex)),
    }));
  }

  return {
    getActiveTraits,
    getAnimalTraits,
    getAnimalTraitsState,
    setAnimalTrait,
    toggleAnimalTrait,
    getAnimalsWithTraits,
  };
}

module.exports = {
  createAnimalTraitsService,
  getTraitDisplayName,
  normalizeTrait,
  sortTraits,
};
