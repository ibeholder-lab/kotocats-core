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
const mediaLikesRouter = require("./routes/media-likes");
const { loadConfig } = require("./lib/fundraisers/config");
const { FundraisersService } = require("./lib/fundraisers/service");
const { createFundraisersRouter } = require("./routes/fundraisers");
const { createMediaUploadRouter } = require("./media-upload/router");
const { cleanup: cleanupMediaUploads } = require("./media-upload/store");
const path = require("path");
const internalToolsRouter = require("./internal-tools/router");
const { createWebhookDebugLogger } = require("./lib/webhook-debug-logger");

const app = express();
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3010);

app.set("trust proxy", "loopback");
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.post("/mixplat/webhook", async (req, res) => {
  const webhookLogger = createWebhookDebugLogger(req, res, { provider: "mixplat" });
  try {
    const urlObject = new URL(req.originalUrl, "http://localhost");
    return await core.handleMixplatWebhook(req, res, urlObject, webhookLogger);
  } catch (error) {
    webhookLogger.error(error, { stage: "route" });
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
app.use(internalToolsRouter);
app.use(createInternalAlertsRouter());
app.use(createInternalAdoptionNotificationsRouter());
app.use("/api/media-likes", mediaLikesRouter);
const fundraisersService = new FundraisersService({ config: loadConfig() });
const FUNDRAISERS_REFRESH_MS = 900000;
async function refreshFundraisersCache() {
  const startedAt = Date.now();
  console.log("[fundraisers] refresh started");
  try {
    const data = await fundraisersService.refresh();
    console.log(`[fundraisers] refresh completed items=${data.items.length} duration_ms=${Date.now() - startedAt}`);
  } catch (error) {
    const duration = Date.now() - startedAt;
    const message = JSON.stringify(String(error?.message || "fundraisers_refresh_failed").slice(0, 160));
    console.error(`[fundraisers] refresh failed duration_ms=${duration} error=${message}`);
    try {
      console.error(`[fundraisers] previous cache preserved items=${fundraisersService.getCached().items.length}`);
    } catch {}
  } finally {
    console.log(`[fundraisers] next refresh scheduled in ${FUNDRAISERS_REFRESH_MS} ms`);
    setTimeout(refreshFundraisersCache, FUNDRAISERS_REFRESH_MS);
  }
}
void refreshFundraisersCache();
app.use("/api/fundraisers", createFundraisersRouter({ service: fundraisersService }));
app.use("/api", createAssetsRouter());
app.use("/api", createVideoPostersRouter());
app.use("/api/kotprosvet", core.createKotprosvetRouter());
app.use("/api", createDoodlesRouter());
app.use("/api", createHeroImagesRouter());
app.use(avatarEditorRouter());
app.use("/media-upload", (req, res, next) => { res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Permissions-Policy": "camera=(), microphone=(), geolocation=()", "Cache-Control": "no-store" }); next(); }, express.static(path.join(__dirname, "media-upload", "public")));
app.get("/media-upload", (req, res) => res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Permissions-Policy": "camera=(), microphone=(), geolocation=()", "Cache-Control": "no-store" }).sendFile(path.join(__dirname, "media-upload", "public", "index.html")));
app.use("/api/media-upload", createMediaUploadRouter());
void cleanupMediaUploads().catch((error) => console.error("media_upload_cleanup_failed", error.message));
setInterval(() => void cleanupMediaUploads().catch((error) => console.error("media_upload_cleanup_failed", error.message)), 60 * 60 * 1000).unref();

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
