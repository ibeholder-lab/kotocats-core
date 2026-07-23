"use strict";

const assert = require("assert/strict");
const { EventEmitter } = require("events");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { createWebhookDebugLogger, safeValue, safeRawBody, cleanupDebugFiles, writeSnapshot, MAX_BODY_CHARS } = require("../lib/webhook-debug-logger");

function request(overrides = {}) {
  return { method: "POST", originalUrl: "/mixplat/webhook?secret=private", headers: { authorization: "Bearer private", "x-api-key": "private" }, query: { secret: "private" }, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" }, get(name) { return this.headers[name.toLowerCase()]; }, ...overrides };
}
function response(statusCode = 200) { const value = new EventEmitter(); value.statusCode = statusCode; return value; }
function delay() { return new Promise((resolve) => setTimeout(resolve, 80)); }
async function tempDir() { return fs.promises.mkdtemp(path.join(os.tmpdir(), "webhook-debug-")); }
async function files(directory) { return (await fs.promises.readdir(directory)).filter((file) => file.endsWith(".json")); }

test("debug=false does not create a file", async () => {
  const directory = await tempDir(); await fs.promises.rm(directory, { recursive: true });
  process.env.WEBHOOK_DEBUG = "false"; process.env.WEBHOOK_DEBUG_DIR = directory;
  createWebhookDebugLogger(request(), response()).received({ body: { ok: true } }); await delay();
  await assert.rejects(fs.promises.access(directory));
});

test("debug=true creates a valid masked JSON snapshot", async () => {
  const directory = await tempDir(); process.env.WEBHOOK_DEBUG = "true"; process.env.WEBHOOK_DEBUG_DIR = directory;
  const res = response(); const logger = createWebhookDebugLogger(request(), res, { provider: "mixplat" });
  logger.received({ rawBody: '{"signature":"private","email":"person@example.test","phone":"+79991234567"}', body: { signature: "private", email: "person@example.test", phone: "+79991234567" } }); res.emit("finish"); await delay();
  const data = JSON.parse(await fs.promises.readFile(path.join(directory, (await files(directory))[0]), "utf8"));
  assert.equal(data.source, "mixplat"); assert.equal(data.httpStatus, 200); assert.equal(data.stage, "completed");
  assert.equal(data.headers.authorization, "***"); assert.equal(data.query.secret, "***");
  assert.equal(data.parsedBody.signature, "***"); assert.match(data.parsedBody.email, /^p\*\*\*@/); assert.match(data.parsedBody.phone, /^79\*\*\*67$/);
  assert.doesNotMatch(data.rawBody.value, /private|person@example\.test|79991234567/);
});

test("Buffer, circular values and raw truncation are safe", () => {
  const circular = { buffer: Buffer.from("abc") }; circular.self = circular;
  assert.deepEqual(safeValue(circular), { buffer: "[Buffer length=3]", self: "[Circular]" });
  const raw = safeRawBody("x=" + "a".repeat(MAX_BODY_CHARS + 100), "application/x-www-form-urlencoded");
  assert.equal(raw.truncated, true); assert.equal(raw.value.length, MAX_BODY_CHARS);
});

test("write errors do not throw", async () => {
  const directory = path.join(await tempDir(), "not-a-directory"); await fs.promises.writeFile(directory, "x");
  assert.equal(await writeSnapshot(directory, "test.json", { secret: "private" }), null);
});

test("parallel requests get unique files and request IDs", async () => {
  const directory = await tempDir(); process.env.WEBHOOK_DEBUG = "true"; process.env.WEBHOOK_DEBUG_DIR = directory;
  const first = createWebhookDebugLogger(request(), response()); const second = createWebhookDebugLogger(request(), response());
  first.received({ body: { one: true } }); second.received({ body: { two: true } }); await delay();
  const names = await files(directory); assert.equal(names.length, 2); assert.notEqual(first.requestId, second.requestId);
});

test("retention removes expired files and respects maximum count", async () => {
  const directory = await tempDir(); process.env.WEBHOOK_DEBUG_RETENTION_DAYS = "7"; process.env.WEBHOOK_DEBUG_MAX_FILES = "2";
  const old = path.join(directory, "old.json"); await fs.promises.writeFile(old, "{}");
  const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); await fs.promises.utimes(old, oldDate, oldDate);
  for (const name of ["a.json", "b.json", "c.json"]) await fs.promises.writeFile(path.join(directory, name), "{}");
  await cleanupDebugFiles(directory); assert.equal((await files(directory)).length, 2); assert.equal(fs.existsSync(old), false);
});
