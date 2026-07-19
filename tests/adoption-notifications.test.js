const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createInternalAdoptionNotificationsRouter, validPayload } = require("../lib/adoption-notifications");

function payload(overrides = {}) {
  return {
    requestId: "request-id",
    requestNumber: "ADOPT-20260718-TEST",
    createdAt: "2026-07-18T20:00:00.000Z",
    animalId: "animal-id",
    animalName: "Мура",
    fullName: "Тестовый Пользователь",
    phone: "+7 000 000-00-00",
    email: "test@example.com",
    reason: "Тест",
    about: "Тест",
    catUrl: "https://cafe-test.kotocafe.ru/cats/mura",
    ...overrides,
  };
}

test("adoption notification payload requires all delivery fields", () => {
  assert.equal(validPayload(payload()), true);
  assert.equal(validPayload(payload({ email: "" })), false);
  assert.equal(validPayload(payload({ createdAt: "" })), false);
});

async function callEndpoint(sendAlert, sendEmail) {
  const previous = process.env.KOTOCATS_CORE_INTERNAL_TOKEN;
  process.env.KOTOCATS_CORE_INTERNAL_TOKEN = "test-internal-token";
  const app = express();
  app.use(express.json());
  app.use(createInternalAdoptionNotificationsRouter({ sendAlert, sendEmail }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/internal/adoption-notifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": "test-internal-token" },
      body: JSON.stringify({ type: "adopt_request", payload: payload() }),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.KOTOCATS_CORE_INTERNAL_TOKEN;
    else process.env.KOTOCATS_CORE_INTERNAL_TOKEN = previous;
  }
}

test("Telegram and email failures stay independent after storage", async () => {
  const ok = async () => ({ ok: true });
  const fail = async () => { throw new Error("modeled_delivery_failure"); };
  const telegramFailed = await callEndpoint(fail, ok);
  assert.equal(telegramFailed.status, 202);
  assert.deepEqual(telegramFailed.body.notifications, { telegram: { ok: false }, email: { ok: true } });
  const emailFailed = await callEndpoint(ok, fail);
  assert.deepEqual(emailFailed.body.notifications, { telegram: { ok: true }, email: { ok: false } });
  const bothFailed = await callEndpoint(fail, fail);
  assert.equal(bothFailed.body.ok, true);
  assert.deepEqual(bothFailed.body.notifications, { telegram: { ok: false }, email: { ok: false } });
});
