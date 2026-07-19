const assert = require("assert");
const { normalizeCafeCode, getAlertDestinations, dispatchTelegramAlert } = require("../lib/alerts");
process.env.TELEGRAM_ALERTS_GENERAL_CHAT_ID = "-100000000001"; process.env.TELEGRAM_ALERTS_GENERAL_TOPIC_ID = "11";
process.env.TELEGRAM_ALERTS_NOVOKUZNETSKAYA_CHAT_ID = "-100000000002"; process.env.TELEGRAM_ALERTS_PROSPEKT_MIRA_CHAT_ID = "-100000000003"; process.env.TELEGRAM_ALERTS_PROSPEKT_MIRA_TOPIC_ID = "13"; process.env.ALERTS_BOT_TOKEN = "test";
assert.equal(normalizeCafeCode("Павелецкая"), "novokuznetskaya"); assert.equal(normalizeCafeCode("prospekt-mira"), "prospekt_mira");
assert.deepEqual(getAlertDestinations({ type: "feed_request", location: "novokuz" }).map((d) => d.key), ["general", "novokuznetskaya"]);
assert.deepEqual(getAlertDestinations({ type: "feed_request", location: "unknown" }).map((d) => d.key), ["general"]);
assert.deepEqual(getAlertDestinations({ type: "site_request", cafe_code: "novokuznetskaya" }).map((d) => d.key), ["general"]);
(async () => { const calls = []; const outcome = await dispatchTelegramAlert({ type: "feed_request", location: "prospekt_mira", payload: {} }, { post: async (_, body) => { calls.push(body); if (body.chat_id === -100000000003) throw new Error("failed"); return { data: { ok: true } }; } }); assert.equal(calls.length, 2); assert.equal(calls[0].message_thread_id, 11); assert.equal(calls[1].message_thread_id, 13); assert.deepEqual(outcome.deliveries.map((d) => d.ok), [true, false]); console.log("core-alerts tests passed"); })().catch((error) => { console.error(error); process.exitCode = 1; });
