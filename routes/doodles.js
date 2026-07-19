const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data", "doodles.json");
const DOODLES_DIR = path.join(__dirname, "..", "public", "doodles");

function loadLibrary() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function createDoodlesRouter() {
  const express = require("express");
  const router = express.Router();

  router.get("/doodles", (_req, res, next) => {
    try {
      return res.json(loadLibrary());
    } catch (error) {
      return next(error);
    }
  });

  router.get("/doodles/:id", (req, res, next) => {
    try {
      const doodle = loadLibrary().find((item) => item.id === req.params.id);
      if (!doodle) return res.status(404).json({ error: "doodle_not_found" });
      return res.sendFile(path.join(DOODLES_DIR, doodle.file), {
        headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=86400" },
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createDoodlesRouter, loadLibrary };
