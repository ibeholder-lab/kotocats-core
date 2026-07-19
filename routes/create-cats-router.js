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

function shuffle(items) {
  const shuffled = Array.isArray(items) ? [...items] : [];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}

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

const categoryFilters = [
  {
    value: "all",
    label: "Все",
    icon: "",
    description:
      "Здесь живые анкеты кошек фонда «Хорошее дело». Можно выбрать кошку, познакомиться с ней, приехать в котокафе или помочь кормом, лечением и заботой.",
  },
  {
    value: "kitten",
    label: "Котята",
    icon: "🐱",
    description:
      "Котята только начинают знакомиться с большим миром. Они быстро привыкают к новому дому, любят играть, исследовать всё вокруг и с интересом познают жизнь рядом с человеком. Если вы готовы уделять время воспитанию и активным играм, котёнок может стать замечательным другом на долгие годы.",
  },
  {
    value: "young",
    label: "Молодые кошки",
    icon: "🌿",
    description:
      "Молодые кошки уже выросли, но по-прежнему полны любопытства и энергии. У каждой из них свой характер, привычки и любимые занятия. Многие уже освоили домашние правила и легко привыкают к новой семье, сохраняя игривость и открытость к общению.",
  },
  {
    value: "adult",
    label: "Взрослые кошки",
    icon: "🐈",
    description:
      "Взрослые кошки — спокойные и сформировавшиеся личности. Их характер уже хорошо известен, поэтому подобрать питомца под свой образ жизни становится проще. Многие из них ценят внимание человека, любят уют и быстро начинают доверять тем, кто относится к ним с заботой.",
  },
  {
    value: "senior",
    label: "На доживании",
    icon: "💜",
    description:
      "Эти кошки уже немолоды и особенно нуждаются в спокойном доме, где смогут провести зрелые годы рядом с любящими людьми. Им не нужны долгие приключения — гораздо важнее тепло, забота и ощущение, что рядом есть свой человек. Многие пожилые кошки удивительно ласковы, благодарны и становятся самыми преданными домашними друзьями.",
  },
  {
    value: "special",
    label: "Особенные кошки",
    icon: "💙",
    description:
      "Особенные кошки живут с особенностями здоровья или перенесёнными травмами, но это не мешает им радоваться жизни, играть, общаться с людьми и быть счастливыми дома. Многие из них не требуют сложного ухода — лишь немного больше внимания, любви и понимания. Зато они часто отвечают человеку удивительным доверием и привязанностью.",
  },
];
    const allowedCategories = new Set(
      categoryFilters.map((item) => item.value),
    );

    const requestedCategory = String(
      req.query.category || "all",
    )
      .trim()
      .toLowerCase();

    const activeCategory = allowedCategories.has(requestedCategory)
      ? requestedCategory
      : "all";

      const activeCategoryData =
  categoryFilters.find(
    (item) => item.value === activeCategory,
  ) || categoryFilters[0];

    const catsData = await loadCatsForCatalog();

    const allCats = Array.isArray(catsData.cats)
      ? catsData.cats
      : [];

    const categoryCounts = allCats.reduce(
      (counts, cat) => {
        counts.all += 1;

        const category = String(cat.category || "")
          .trim()
          .toLowerCase();

        if (
          Object.prototype.hasOwnProperty.call(
            counts,
            category,
          )
        ) {
          counts[category] += 1;
        }

        return counts;
      },
      {
        all: 0,
        kitten: 0,
        young: 0,
        adult: 0,
        senior: 0,
        special: 0,
      },
    );

    const filteredCats =
      activeCategory === "all"
        ? allCats
        : allCats.filter((cat) => {
            return (
              String(cat.category || "")
                .trim()
                .toLowerCase() === activeCategory
            );
          });

res.render("cats", {
  kotocatsCore,
  cats: shuffle(filteredCats),
  catsError: catsData.error,
  selectedCat: null,
  selectedCatMissing: false,
  activeCategory,
  activeCategoryData,
  categoryFilters,
  categoryCounts,
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
          pageUrl:
            siteUrl +
            "/cats/" +
            encodeURIComponent(req.params.slug),
          ogImage: defaultOgImage,
        });
      }

      const catsData = await loadCatsForWidget(6);

      const relatedCats = catsData.cats
        .filter(
          (item) => String(item.id) !== String(cat.id),
        )
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
