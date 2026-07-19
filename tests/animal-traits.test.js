"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createAnimalTraitsService,
  getTraitDisplayName,
  normalizeTrait,
} = require("../lib/animal-traits");

function fakeDirectus() {
  const animals = [
    { id: "animal-1", name: "Антоновка", sex: "female" },
    { id: "animal-2", name: "Бусик", sex: "male" },
  ];
  const traits = [
    { id: "trait-1", slug: "affectionate", name: "Ласковый", name_male: "Ласковый", name_female: "Ласковая", icon: "❤️", sort: 20, is_active: true, show_on_site: true },
    { id: "trait-2", slug: "shy", name: "Застенчивый", name_male: "Застенчивый", name_female: "Застенчивая", sort: 10, is_active: true, show_on_site: false },
    { id: "trait-3", slug: "old", name: "Неактивный", sort: 30, is_active: false, show_on_site: true },
  ];
  const links = [];
  let sequence = 0;

  function response(data) { return Promise.resolve({ data: { data } }); }
  const client = {
    get(path, { params = {} } = {}) {
      const item = path.match(/^\/items\/(animals|animal_traits)\/(.+)$/);
      if (item) {
        const source = item[1] === "animals" ? animals : traits;
        const value = source.find((entry) => entry.id === decodeURIComponent(item[2]));
        if (!value) return Promise.reject({ response: { status: 404 } });
        return response(value);
      }
      if (path === "/items/animal_traits") {
        return response(traits.filter((trait) => !params.filter?.is_active || trait.is_active === true));
      }
      if (path === "/items/animals_animal_traits") {
        let rows = links.slice();
        const filter = params.filter || {};
        if (filter.animal_id?._eq) rows = rows.filter((link) => link.animal_id === filter.animal_id._eq);
        if (filter.animal_id?._in) rows = rows.filter((link) => filter.animal_id._in.includes(link.animal_id));
        if (filter.trait_id?._eq) rows = rows.filter((link) => link.trait_id === filter.trait_id._eq);
        rows = rows.map((link) => ({ ...link, trait_id: traits.find((trait) => trait.id === link.trait_id) }));
        if (filter.trait_id?.is_active) rows = rows.filter((link) => link.trait_id.is_active);
        if (filter.trait_id?.show_on_site) rows = rows.filter((link) => link.trait_id.show_on_site);
        return response(rows);
      }
      throw new Error(`Unexpected GET ${path}`);
    },
    post(path, data) {
      assert.equal(path, "/items/animals_animal_traits");
      if (links.some((link) => link.pair_key === data.pair_key)) {
        return Promise.reject({ response: { status: 409 } });
      }
      links.push({ id: `link-${++sequence}`, ...data });
      return response(links.at(-1));
    },
    delete(path) {
      const id = decodeURIComponent(path.split("/").at(-1));
      const index = links.findIndex((link) => link.id === id);
      if (index >= 0) links.splice(index, 1);
      return response(id);
    },
  };
  return { client, links };
}

test("assignment is idempotent and one trait can belong to many animals", async () => {
  const fake = fakeDirectus();
  const service = createAnimalTraitsService({ client: fake.client });
  await service.setAnimalTrait("animal-1", "trait-1", true);
  await service.setAnimalTrait("animal-1", "trait-1", true);
  await service.setAnimalTrait("animal-2", "trait-1", true);
  assert.equal(fake.links.length, 2);
});

test("inactive trait cannot be assigned and removing a link keeps the trait", async () => {
  const fake = fakeDirectus();
  const service = createAnimalTraitsService({ client: fake.client });
  await assert.rejects(service.setAnimalTrait("animal-1", "trait-3", true), /Неактивный/);
  await service.setAnimalTrait("animal-1", "trait-1", true);
  await service.setAnimalTrait("animal-1", "trait-1", false);
  await service.setAnimalTrait("animal-1", "trait-1", false);
  assert.equal(fake.links.length, 0);
  assert.equal((await service.getActiveTraits()).some((trait) => trait.id === "trait-1"), true);
});

test("public enrichment hides show_on_site=false and sorts by sort then name", async () => {
  const fake = fakeDirectus();
  const service = createAnimalTraitsService({ client: fake.client });
  await service.setAnimalTrait("animal-1", "trait-1", true);
  await service.setAnimalTrait("animal-1", "trait-2", true);
  const internal = await service.getAnimalTraits("animal-1");
  assert.deepEqual(internal.map((trait) => trait.id), ["trait-2", "trait-1"]);
  const publicTraits = await service.getAnimalTraits("animal-1", { publicOnly: true });
  assert.deepEqual(publicTraits.map((trait) => trait.id), ["trait-1"]);
});

test("getTraitDisplayName selects male and female forms", () => {
  const trait = { slug: "affectionate", nameMale: "Ласковый", nameFemale: "Ласковая" };
  assert.equal(getTraitDisplayName(trait, "male"), "Ласковый");
  assert.equal(getTraitDisplayName(trait, "female"), "Ласковая");
});

test("getTraitDisplayName uses safe fallbacks", () => {
  assert.equal(getTraitDisplayName({ slug: "one", nameMale: "Мужская" }, "female"), "Мужская");
  assert.equal(getTraitDisplayName({ slug: "two", nameFemale: "Женская" }, "male"), "Женская");
  assert.equal(getTraitDisplayName({ slug: "three" }, "female"), "three");
  assert.equal(getTraitDisplayName({ slug: "four", nameMale: "Основная", nameFemale: "Другая" }, "unknown"), "Основная");
  assert.equal(getTraitDisplayName({ slug: "five", nameMale: "Без рода", nameFemale: "Без рода" }, "female"), "Без рода");
});

test("normalizeTrait preserves both forms with legacy fallbacks", () => {
  const legacy = normalizeTrait({ id: "legacy", slug: "legacy-slug", name: "Старое имя" });
  assert.equal(legacy.nameMale, "Старое имя");
  assert.equal(legacy.nameFemale, "Старое имя");
  assert.equal(legacy.name_male, "Старое имя");
  assert.equal(legacy.name_female, "Старое имя");
});

test("internal state returns sex-specific display name and legacy name alias", async () => {
  const fake = fakeDirectus();
  const service = createAnimalTraitsService({ client: fake.client });
  const femaleState = await service.getAnimalTraitsState("animal-1");
  const maleState = await service.getAnimalTraitsState("animal-2");
  assert.equal(femaleState.animal.sex, "female");
  assert.equal(femaleState.traits.find((trait) => trait.id === "trait-1").displayName, "Ласковая");
  assert.equal(femaleState.traits.find((trait) => trait.id === "trait-1").name, "Ласковая");
  assert.equal(maleState.traits.find((trait) => trait.id === "trait-1").display_name, "Ласковый");
});
