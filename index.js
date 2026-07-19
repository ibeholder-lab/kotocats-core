const path = require("path");

const createCatsRouter = require("./routes/create-cats-router");
const createDirectusClient = require("./lib/directus-client");
const { createAnimalTraitsService } = require("./lib/animal-traits");
const directusCats = require("./lib/directus-cats");
const createKotprosvetRouter = require("./routes/kotprosvet");
const { createDoodlesRouter, loadLibrary: loadDoodles } = require("./routes/doodles");
const { createHeroImagesRouter } = require("./routes/hero-images");
const heroImages = require("./lib/hero-images");

const {
  handleMixplatWebhook,
  initMixplatDonations,
} = require("./lib/payments/mixplat");

const partners = require("./lib/partners");

const coreRoot = __dirname;

const donationsRouter = require("./routes/donations");
const mixplat = require("./lib/payments/mixplat");
const qtickets = require("./lib/qtickets");
const adoption = require("./lib/adoption");
const feed = require("./routes/feed");

function partial(name) {
  return path.join(coreRoot, "views", "partials", name);
}

function asset(name) {
  return path.join(coreRoot, "public", name);
}

module.exports = {
  coreRoot,
  viewsPath: path.join(coreRoot, "views"),
  partialsPath: path.join(coreRoot, "views", "partials"),
  publicPath: path.join(coreRoot, "public"),
  partners,

  createCatsRouter,
  createKotprosvetRouter,
  createDoodlesRouter,
  createHeroImagesRouter,
  loadDoodles,
  heroImages,
  createDirectusClient,
  createAnimalTraitsService,
  handleMixplatWebhook,
  initMixplatDonations,

  ...directusCats,

  partial,
  asset,
 	

donationsRouter,
...mixplat,
...qtickets,
adoption,
...feed,
 register(app, options) {
    return require("./register")(app, options);
  },
};
