const path = require("path");

const createCatsRouter = require("./routes/create-cats-router");
const createDirectusClient = require("./lib/directus-client");
const directusCats = require("./lib/directus-cats");

const coreRoot = __dirname;

const donationsRouter = require("./routes/donations");
const mixplat = require("./lib/payments/mixplat");

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

  createCatsRouter,
  createDirectusClient,

  ...directusCats,

  partial,
  asset,
 	

donationsRouter,
...mixplat,
 register(app, options) {
    return require("./register")(app, options);
  },
};
