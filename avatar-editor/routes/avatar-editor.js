const express = require("express");
const path = require("path");
const controller = require("../controllers/avatar-editor-controller");
const {
  isEnabled,
  requireSession,
  rateLimit,
  editorHeaders,
} = require("../middleware/security");

module.exports = function createAvatarEditorRouter() {
  const router = express.Router();
  const api = express.Router();

  api.post(
    "/auth",
    express.json({ limit: "12kb" }),
    rateLimit({ windowMs: 60000, max: 10 }),
    controller.auth,
  );
  api.use(requireSession);
  api.get("/animals", controller.animals);
  api.get("/animals/:id/media", controller.media);
  api.get("/maps/:animalId/:fileId", controller.getMap);
  api.put(
    "/maps/:animalId/:fileId",
    express.json({ limit: "16kb" }),
    rateLimit({ windowMs: 60000, max: 30 }),
    controller.putMap,
  );

  // Never apply editor feature flags to the whole core application.
  router.use(
    "/avatar-editor",
    isEnabled,
    editorHeaders,
    express.static(path.join(__dirname, "..", "public")),
  );
  router.get("/avatar-editor", isEnabled, editorHeaders, controller.page);
  router.use("/api/avatar-editor", isEnabled, editorHeaders, api);

  router.use((error, req, res, next) => {
    if (!req.path.startsWith("/avatar-editor") && !req.path.startsWith("/api/avatar-editor")) {
      return next(error);
    }
    console.error("avatar-editor request failed", error.message);
    return res.status(502).json({ ok: false, error: "editor_unavailable" });
  });

  return router;
};
