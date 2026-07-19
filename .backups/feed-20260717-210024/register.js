const express = require("express");

const core = require("./index");

function registerKotocats(app, options = {}) {
  if (!app || typeof app.use !== "function") {
    throw new Error("kotocats-core: Express app is required");
  }

  const {
    assetsPath = "/kotocats-core",
    siteUrl = "",
    defaultOgImage = "",
    notFoundView = "404",

    loadCatsForCatalog = core.loadCatsForCatalog,
    loadCatsForWidget = core.loadCatsForWidget,
    loadCatBySlugOrId = core.loadCatBySlugOrId,
  } = options;

  app.use(assetsPath, express.static(core.publicPath));

  app.locals.kotocatsCore = {
    ...core,
    assetsPath,
    siteUrl,
    defaultOgImage,
  };

  const router = core.createCatsRouter({
    loadCatsForCatalog,
    loadCatsForWidget,
    loadCatBySlugOrId,
    siteUrl,
    defaultOgImage,
    notFoundView,
  });

  app.use(router);
  app.use("/api/kotprosvet", core.createKotprosvetRouter());


if (options.enableDonations !== false) {
  app.use("/api/donations", core.donationsRouter);

  app.post("/mixplat/webhook", async (req, res) => {
    const urlObject = new URL(req.originalUrl, "http://localhost");
    return core.handleMixplatWebhook(req, res, urlObject);
  });

  core.initMixplatDonations();
}

  return {
    router,
    assetsPath,
    publicPath: core.publicPath,
  };
}

module.exports = registerKotocats;
