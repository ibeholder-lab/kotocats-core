const express = require("express");
const heroImages = require("../lib/hero-images");

function createHeroImagesRouter() {
  const router = express.Router();
  router.get("/hero-images", (_req, res) => res.json(heroImages.getAll()));
  router.get("/hero-images/:slug", (req, res) => {
    const hero = heroImages.getBySlug(req.params.slug);
    return hero ? res.json(hero) : res.status(404).json({ error: "hero_image_not_found" });
  });
  return router;
}

module.exports = { createHeroImagesRouter };
