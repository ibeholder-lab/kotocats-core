const express = require("express");
const { createWebhookDebugLogger } = require("../lib/webhook-debug-logger");
const {
  extractMediaId,
  generatePosterForMedia,
  generateMissingPosters,
} = require("../lib/media/video-posters");

function createVideoPostersRouter() {
  const router = express.Router();

  router.post("/media/video-poster", async (req, res) => {
    const webhookLogger = createWebhookDebugLogger(req, res, { provider: "media-video-poster" });
    webhookLogger.received({ body: req.body });
    const expected = String(process.env.MEDIA_WEBHOOK_SECRET || "");
    const supplied = String(req.get("x-media-webhook-secret") || req.query.secret || "");
    if (!expected) return res.status(503).json({ ok: false, error: "media_webhook_secret_missing" });
    if (supplied !== expected) return res.status(403).json({ ok: false, error: "forbidden" });

    const mediaId = extractMediaId(req.body || {});
    if (!mediaId) return res.status(400).json({ ok: false, error: "animal_media_id_required" });

    try {
      const result = await generatePosterForMedia(mediaId, { force: Boolean(req.body?.force) });
      return res.status(result.ok ? 200 : 202).json(result);
    } catch (error) {
      webhookLogger.error(error, { stage: "poster_generation" });
      console.error("VIDEO POSTER WEBHOOK ERROR:", error.message);
      return res.status(500).json({ ok: false, error: "poster_generation_failed", message: error.message });
    }
  });

  router.post("/media/video-posters/scan", async (req, res) => {
    const webhookLogger = createWebhookDebugLogger(req, res, { provider: "media-video-posters-scan" });
    webhookLogger.received({ body: req.body });
    try {
      const expected = String(process.env.MEDIA_WEBHOOK_SECRET || "");
      const supplied = String(req.get("x-media-webhook-secret") || req.query.secret || "");
      if (!expected || supplied !== expected) return res.status(403).json({ ok: false, error: "forbidden" });
      const results = await generateMissingPosters({ limit: req.body?.limit || 10 });
      return res.json({ ok: true, results });
    } catch (error) {
      webhookLogger.error(error, { stage: "poster_scan" });
      return res.status(500).json({ ok: false, error: "poster_scan_failed" });
    }
  });

  return router;
}

module.exports = createVideoPostersRouter;
