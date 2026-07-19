#!/usr/bin/env node

require("./lib/load-env")();

const express = require("express");
const core = require("./index");
const avatarEditorRouter = require("./avatar-editor/routes/avatar-editor");
const createAssetsRouter = require("./routes/assets");
const { createAnimalReviewsRouter } = require("./routes/animal-reviews-router");
const { createSubscriptionsRouter } = require("./routes/subscriptions");
const createVideoPostersRouter = require("./routes/video-posters");
const { startPosterWorker } = require("./lib/media/video-posters");
const { createInternalAlertsRouter } = require("./lib/alerts");
const { createInternalAdoptionNotificationsRouter } = require("./lib/adoption-notifications");
const { createDoodlesRouter } = require("./routes/doodles");
const { createHeroImagesRouter } = require("./routes/hero-images");
const { createInternalAnimalTraitsRouter } = require("./routes/internal-animal-traits");

const app = express();
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3010);

app.set("trust proxy", true);

app.post("/mixplat/webhook", async (req, res) => {
  try {
    const urlObject = new URL(req.originalUrl, "http://localhost");
    return await core.handleMixplatWebhook(req, res, urlObject);
  } catch (error) {
    console.error("MIXPLAT WEBHOOK ROUTE ERROR:", error?.response?.data || error?.message || error);
    if (!res.headersSent) return res.status(500).json({ ok: false, error: "webhook_route_failed" });
    return null;
  }
});

app.use(createAnimalReviewsRouter());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const traitDirectus = core.createDirectusClient({
  directusUrl: process.env.DIRECTUS_URL,
  directusToken: process.env.DIRECTUS_TOKEN,
  timeout: Number(process.env.DIRECTUS_TIMEOUT_MS || 15000),
});
const animalTraitsService = core.createAnimalTraitsService({ client: traitDirectus.client });
app.use("/api/internal", createInternalAnimalTraitsRouter({
  service: animalTraitsService,
  internalToken: process.env.KOTOCATS_CORE_INTERNAL_TOKEN,
}));
app.use("/kotocats-core", express.static(core.publicPath));
app.use(createInternalAlertsRouter());
app.use(createInternalAdoptionNotificationsRouter());
app.use("/api", createAssetsRouter());
app.use("/api", createVideoPostersRouter());
app.use("/api/kotprosvet", core.createKotprosvetRouter());
app.use("/api", createDoodlesRouter());
app.use("/api", createHeroImagesRouter());
app.use(avatarEditorRouter());

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "kotocats-core" });
});

app.use("/api/donations", core.donationsRouter);
app.use("/api/subscriptions", createSubscriptionsRouter());

core.initMixplatDonations();
startPosterWorker();

app.listen(PORT, HOST, () => {
  console.log(`kotocats-core started on http://${HOST}:${PORT}`);
});
