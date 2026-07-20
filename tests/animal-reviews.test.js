"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAnimalReviewsModule } = require("../routes/animal-reviews.module");
const { ANIMAL_REVIEW_ANIMAL_FIELDS } = require("../routes/animal-reviews-router");

const animalId = "11111111-1111-4111-8111-111111111111";

function response() {
  const result = { status: null, body: null };
  return {
    result,
    writeHead(status) { result.status = status; },
    end(body) { result.body = body ? JSON.parse(body) : null; },
  };
}

function moduleWith(get) {
  return createAnimalReviewsModule({
    DIRECTUS_URL: "https://directus.test",
    apiHeaders: () => ({}),
    directusGet: get,
  });
}

test("animal review lookup requests only real animal fields", async () => {
  const calls = [];
  const reviews = moduleWith(async (collection, params) => {
    calls.push({ collection, params });
    return collection === "animals"
      ? [{ id: animalId, name: "Листик", published: true, status: "looking_home" }]
      : [];
  });
  const res = response();
  await reviews.handleListReviews({ method: "GET", headers: {} }, res, new URL(`https://site.test/api/animal-reviews?animal=${animalId}`));
  const animalQuery = calls.find((call) => call.collection === "animals");
  assert.equal(res.result.status, 200);
  assert.equal(animalQuery.params.fields, "id,name,status,published");
  assert.equal(animalQuery.params.fields.includes("is_public"), false);
  assert.equal(animalQuery.params.fields.includes("is_archived"), false);
  assert.equal(animalQuery.params.fields.includes("archived"), false);
  assert.equal(ANIMAL_REVIEW_ANIMAL_FIELDS, animalQuery.params.fields);
});

test("animal review visibility requires published looking_home animals", async () => {
  for (const animal of [
    { id: animalId, published: false, status: "looking_home" },
    { id: animalId, published: true, status: "test" },
  ]) {
    const reviews = moduleWith(async (collection) => collection === "animals" ? [animal] : []);
    const res = response();
    await reviews.handleListReviews({ method: "GET", headers: {} }, res, new URL(`https://site.test/api/animal-reviews?animal=${animalId}`));
    assert.equal(res.result.status, 404);
  }
});

test("animal review Directus errors return a controlled response", async () => {
  const reviews = moduleWith(async () => { throw new Error("Directus unavailable"); });
  const res = response();
  const originalError = console.error;
  console.error = () => {};
  try {
    await reviews.handleListReviews({ method: "GET", headers: {} }, res, new URL(`https://site.test/api/animal-reviews?animal=${animalId}`));
  } finally {
    console.error = originalError;
  }
  assert.equal(res.result.status, 500);
  assert.equal(res.result.body.error, "Не удалось загрузить отзывы.");
});
