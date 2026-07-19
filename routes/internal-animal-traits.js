"use strict";

const crypto = require("crypto");
const express = require("express");

function tokensEqual(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createInternalAnimalTraitsRouter({ service, internalToken }) {
  if (!service) throw new Error("animal-traits router: service is required");
  const router = express.Router();

  router.use((req, res, next) => {
    const actual = req.get("X-Kotocats-Core-Token") || "";
    if (!tokensEqual(actual, internalToken)) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    return next();
  });

  router.get("/animals/:animalId/traits", async (req, res) => {
    try {
      const data = await service.getAnimalTraitsState(req.params.animalId);
      return res.json(data);
    } catch (error) {
      return res.status(error.status || 500).json({
        ok: false,
        error: error.code || "animal_traits_failed",
        message: error.status && error.status < 500 ? error.message : "Не удалось загрузить атрибуты",
      });
    }
  });

  router.post("/animals/:animalId/traits/:traitId/toggle", async (req, res) => {
    try {
      const data = await service.toggleAnimalTrait(req.params.animalId, req.params.traitId);
      return res.json(data);
    } catch (error) {
      return res.status(error.status || 500).json({
        ok: false,
        error: error.code || "animal_trait_toggle_failed",
        message: error.status && error.status < 500 ? error.message : "Не удалось изменить атрибут",
      });
    }
  });

  return router;
}

module.exports = { createInternalAnimalTraitsRouter };
