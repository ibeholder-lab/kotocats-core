const path = require("path");
const express = require("express");

const coreRoot = path.join(__dirname, "..");

const kotocatsCore = {
  coreRoot,
  viewsPath: path.join(coreRoot, "views"),
  partialsPath: path.join(coreRoot, "views", "partials"),
  publicPath: path.join(coreRoot, "public"),

  partial(name) {
    return path.join(coreRoot, "views", "partials", name);
  },

  asset(name) {
    return path.join(coreRoot, "public", name);
  },
};

function createCatsRouter(options = {}) {
  const router = express.Router();

  const {
    loadCatsForCatalog,
    loadCatsForWidget,
    loadCatBySlugOrId,
    siteUrl = "",
    defaultOgImage = "",
    notFoundView = "404",
  } = options;

  if (typeof loadCatsForCatalog !== "function") {
    throw new Error("kotocats-core: loadCatsForCatalog is required");
  }

  if (typeof loadCatsForWidget !== "function") {
    throw new Error("kotocats-core: loadCatsForWidget is required");
  }

  if (typeof loadCatBySlugOrId !== "function") {
    throw new Error("kotocats-core: loadCatBySlugOrId is required");
  }

  router.get("/cats", async (req, res, next) => {
    try {
      if (req.query.animal) {
        return res.redirect(
          301,
          "/cats/" + encodeURIComponent(String(req.query.animal)),
        );
      }

      const catsData = await loadCatsForCatalog();

res.render("cats", {
  kotocatsCore,
  cats: catsData.cats,
  catsError: catsData.error,
  selectedCat: null,
  selectedCatMissing: false,
  styles: ["cats"],
});
    } catch (err) {
      next(err);
    }
  });

  router.get("/cats/:slug", async (req, res, next) => {
    try {
      const cat = await loadCatBySlugOrId(req.params.slug);

      if (!cat) {
        return res.status(404).render(notFoundView, {
          pageTitle: "Кошка не найдена",
          pageDescription:
            "Запрошенная анкета кошки не найдена или больше не опубликована.",
          pageUrl: siteUrl + "/cats/" + encodeURIComponent(req.params.slug),
          ogImage: defaultOgImage,
        });
      }

      const catsData = await loadCatsForWidget(6);

      const relatedCats = catsData.cats
        .filter((item) => String(item.id) !== String(cat.id))
        .slice(0, 4);

res.render("cat", {
  kotocatsCore,
  cat,
  relatedCats,
  catsError: catsData.error,
  query: req.query || {},
  paymentQuery: req.query || {},
  styles: [
      "home-fixes",
    "gallery",
    "cat-detail",
    "cat-donate",
  ],
});
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = createCatsRouter;
