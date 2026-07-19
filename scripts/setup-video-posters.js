#!/usr/bin/env node
require("dotenv").config();
const axios = require("axios");

const baseURL = String(process.env.DIRECTUS_URL || "").replace(/\/+$/, "");
const token = process.env.DIRECTUS_TOKEN || "";
const secret = process.env.MEDIA_WEBHOOK_SECRET || "";
const webhookUrl = process.env.MEDIA_WEBHOOK_URL || "";

if (!baseURL || !token) throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN are required");
const api = axios.create({ baseURL, timeout: 30000, headers: { Authorization: `Bearer ${token}` } });

async function ensurePosterField() {
  try {
    await api.get("/fields/animal_media/poster_file");
    console.log("poster_file field already exists");
  } catch (error) {
    if (error.response?.status !== 403 && error.response?.status !== 404) throw error;
    await api.post("/fields/animal_media", {
      field: "poster_file",
      type: "uuid",
      meta: {
        interface: "file-image",
        display: "image",
        special: ["file"],
        note: "Автоматически сгенерированный постер видео",
        width: "half",
      },
      schema: { is_nullable: true },
    });
    console.log("created poster_file field");
  }

  try {
    const relations = await api.get("/relations/animal_media/poster_file");
    if (relations.data?.data) return console.log("poster_file relation already exists");
  } catch (error) {
    if (error.response?.status !== 403 && error.response?.status !== 404) throw error;
  }

  try {
    await api.post("/relations", {
      collection: "animal_media",
      field: "poster_file",
      related_collection: "directus_files",
      meta: { one_field: null, junction_field: null },
      schema: { on_delete: "SET NULL" },
    });
    console.log("created poster_file relation");
  } catch (error) {
    if (![400, 409].includes(error.response?.status)) throw error;
    console.log("poster_file relation appears to exist");
  }
}

async function ensureFlow() {
  if (!secret || !webhookUrl) {
    console.log("MEDIA_WEBHOOK_SECRET or MEDIA_WEBHOOK_URL missing; skipping Directus Flow creation");
    return;
  }

  const name = "Generate animal video poster";
  const existing = await api.get("/flows", { params: { filter: { name: { _eq: name } }, limit: 1 } });
  if (existing.data?.data?.length) {
    console.log("Directus Flow already exists");
    return;
  }

  const flowResponse = await api.post("/flows", {
    name,
    icon: "movie",
    color: "#2f855a",
    status: "active",
    trigger: "event",
    accountability: "all",
    options: {
      type: "action",
      scope: ["items.create", "items.update"],
      collections: ["animal_media"],
    },
  });
  const flowId = flowResponse.data?.data?.id;
  if (!flowId) throw new Error("Directus did not return flow id");

  const operationResponse = await api.post("/operations", {
    name: "Call kotocats-core poster generator",
    key: "generate_video_poster",
    type: "request",
    position_x: 19,
    position_y: 1,
    flow: flowId,
    options: {
      method: "POST",
      url: webhookUrl,
      headers: [
        { header: "Content-Type", value: "application/json" },
        { header: "x-media-webhook-secret", value: secret },
      ],
      body: '{"media_id":"{{$trigger.key}}"}',
    },
  });
  const operationId = operationResponse.data?.data?.id;
  await api.patch(`/flows/${flowId}`, { operation: operationId });
  console.log("created Directus Flow for video poster generation");
}

(async () => {
  await ensurePosterField();
  try {
    await ensureFlow();
  } catch (error) {
    console.warn("Flow creation failed; background worker remains active:", error.response?.data || error.message);
  }
})().catch((error) => {
  console.error(error.response?.data || error.stack || error.message);
  process.exit(1);
});
