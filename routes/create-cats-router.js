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


function createCatSeo(cat, siteUrl, defaultOgImage) {
  const baseUrl = String(siteUrl || "").replace(/\/+$/, "");
  const name = String(cat?.name || "Кошка").trim() || "Кошка";
  const status = String(cat?.status || "").trim().toLowerCase();
  const pageUrl = baseUrl + "/cats/" + encodeURIComponent(String(cat?.slug || cat?.id || "").trim());
  const description = String(cat?.shortDescription || cat?.description || "").replace(/\s+/g, " ").trim()
    || "Познакомьтесь с кошкой " + name + " на сайте фонда «Кошки в городе».";
  const imagePath = String(cat?.ogImageUrl || cat?.photoUrl || defaultOgImage || "").trim();
  const ogImage = /^https:\/\//i.test(imagePath)
    ? imagePath
    : baseUrl + (imagePath.startsWith("/") ? imagePath : "/" + imagePath);

  return {
    pageTitle: status === "looking_home" ? name + " ищет дом — Кошки в городе" : name + " — Кошки в городе",
    pageDescription: description,
    pageUrl,
    ogImage,
    ogImageAlt: "Фотография кошки " + name,
    ogType: "website",
    ogSiteName: "Кошки в городе",
  };
}


const CATEGORY_FILTERS = [
  { value: "all", label: "Все", icon: "", description: "Здесь живые анкеты кошек фонда «Хорошее дело». Можно выбрать кошку, познакомиться с ней, приехать в котокафе или помочь кормом, лечением и заботой." },
  { value: "kitten", label: "Котята", icon: "🐱", description: "Котята только начинают знакомиться с большим миром. Они быстро привыкают к новому дому, любят играть, исследовать всё вокруг и с интересом познают жизнь рядом с человеком." },
  { value: "young", label: "Молодые кошки", icon: "🌿", description: "Молодые кошки уже выросли, но по-прежнему полны любопытства и энергии. Многие уже освоили домашние правила и легко привыкают к новой семье." },
  { value: "adult", label: "Взрослые кошки", icon: "🐈", description: "Взрослые кошки — спокойные и сформировавшиеся личности. Их характер уже хорошо известен, поэтому подобрать питомца под свой образ жизни становится проще." },
  { value: "senior", label: "На доживании", icon: "💜", description: "Эти кошки уже немолоды и особенно нуждаются в спокойном доме, где смогут провести зрелые годы рядом с любящими людьми." },
  { value: "special", label: "Особенные кошки", icon: "💙", description: "Особенные кошки живут с особенностями здоровья или перенесёнными травмами, но это не мешает им радоваться жизни и быть счастливыми дома." },
];
const CATEGORY_SEO = {
  kitten: { pageTitle: "Котята ищут дом — взять котёнка из приюта | Кошки в городе", pageDescription: "Котята фонда «Кошки в городе», которые ищут дом. Познакомьтесь с котятами, выберите питомца и подайте заявку на знакомство." },
  young: { pageTitle: "Молодые кошки ищут дом | Кошки в городе", pageDescription: "Молодые кошки фонда «Кошки в городе», которые ищут любящую семью. Познакомьтесь с питомцами и выберите своего друга." },
  adult: { pageTitle: "Взрослые кошки ищут дом | Кошки в городе", pageDescription: "Взрослые кошки фонда «Кошки в городе», которым нужен дом. Узнайте характер питомцев и подайте заявку на знакомство." },
  senior: { pageTitle: "Кошки на доживании ищут заботу | Кошки в городе", pageDescription: "Пожилые кошки фонда «Кошки в городе», которым особенно нужны забота, спокойствие и любящий дом." },
  special: { pageTitle: "Особенные кошки ищут дом | Кошки в городе", pageDescription: "Особенные кошки фонда «Кошки в городе», которые ищут понимающую семью. Познакомьтесь с питомцами и узнайте, какая помощь им нужна." },
};
const CATEGORY_PATH_VALUES = new Set(["kitten", "young", "adult", "senior", "special"]);
function createCatsSeo(siteUrl, defaultOgImage, category = "all") {
  const baseUrl = String(siteUrl || "").replace(/\/+$/, "");
  const imagePath = String(defaultOgImage || "").trim();
  const ogImage = /^https:\/\//i.test(imagePath) ? imagePath : baseUrl + (imagePath.startsWith("/") ? imagePath : "/" + imagePath);
  const categorySeo = CATEGORY_SEO[category];
  const pagePath = categorySeo ? "/cats/" + category : "/cats";
  return { pageTitle: categorySeo?.pageTitle || "Кошки ищут дом — Кошки в городе", pageDescription: categorySeo?.pageDescription || "Познакомьтесь с кошками фонда «Кошки в городе», которые ищут любящих хозяев.", pageUrl: baseUrl + pagePath, ogImage, ogImageAlt: categorySeo ? categorySeo.pageTitle : "Кошки фонда «Кошки в городе»", ogType: "website", ogSiteName: "Кошки в городе" };
}
function createCatsRouter(options = {}) {
  const router = express.Router();
  const { loadCatsForCatalog, loadCatsForWidget, loadCatBySlugOrId, loadActiveAnimalNeeds, siteUrl = "", defaultOgImage = "", notFoundView = "404", canonicalSiteUrl = siteUrl } = options;
  if (typeof loadCatsForCatalog !== "function") throw new Error("kotocats-core: loadCatsForCatalog is required");
  if (typeof loadCatsForWidget !== "function") throw new Error("kotocats-core: loadCatsForWidget is required");
  if (typeof loadCatBySlugOrId !== "function") throw new Error("kotocats-core: loadCatBySlugOrId is required");
  async function renderCatalog(req, res, next, activeCategory) {
    try {
      const activeCategoryData = CATEGORY_FILTERS.find((item) => item.value === activeCategory) || CATEGORY_FILTERS[0];
      const catsData = await loadCatsForCatalog(); const allCats = Array.isArray(catsData.cats) ? catsData.cats : [];
      const categoryCounts = allCats.reduce((counts, cat) => { counts.all += 1; const category = String(cat.category || "").trim().toLowerCase(); if (Object.prototype.hasOwnProperty.call(counts, category)) counts[category] += 1; return counts; }, { all: 0, kitten: 0, young: 0, adult: 0, senior: 0, special: 0 });
      const filteredCats = activeCategory === "all" ? allCats : allCats.filter((cat) => String(cat.category || "").trim().toLowerCase() === activeCategory);
      return res.render("cats", { catalogSeo: createCatsSeo(siteUrl, defaultOgImage, activeCategory), kotocatsCore, cats: shuffle(filteredCats), catsError: catsData.error, selectedCat: null, selectedCatMissing: false, activeCategory, activeCategoryData, categoryFilters: CATEGORY_FILTERS, categoryCounts, styles: ["cats"] });
    } catch (err) { return next(err); }
  }
  router.get("/cats", (req, res, next) => {
    if (req.query.animal) return res.redirect(301, "/cats/" + encodeURIComponent(String(req.query.animal)));
    if (Object.prototype.hasOwnProperty.call(req.query, "category")) { const category = String(req.query.category || "").trim().toLowerCase(); return res.redirect(301, CATEGORY_PATH_VALUES.has(category) ? "/cats/" + category : "/cats"); }
    return renderCatalog(req, res, next, "all");
  });
  router.get(["/cats/kitten", "/cats/young", "/cats/adult", "/cats/senior", "/cats/special"], (req, res, next) => renderCatalog(req, res, next, req.path.split("/").pop()));
  router.get("/cats/:slug", async (req, res, next) => {
    try {
      const cat = await loadCatBySlugOrId(req.params.slug);
      if (!cat) return res.status(404).render(notFoundView, { pageTitle: "Кошка не найдена", pageDescription: "Запрошенная анкета кошки не найдена или больше не опубликована.", pageUrl: siteUrl + "/cats/" + encodeURIComponent(req.params.slug), ogImage: defaultOgImage });
      const catsData = await loadCatsForWidget(6); const relatedCats = catsData.cats.filter((item) => String(item.id) !== String(cat.id)).slice(0, 4);
      let activeNeeds = [];
      if (typeof loadActiveAnimalNeeds === "function") {
        try { activeNeeds = await loadActiveAnimalNeeds(cat.id); }
        catch (error) { console.error("[cats] Failed to load active needs", { animalId: cat.id, message: error.message }); }
      }
      return res.render("cat", { catSeo: createCatSeo(cat, siteUrl, defaultOgImage), canonicalUrl: String(canonicalSiteUrl || siteUrl).replace(/\/+$/, "") + "/cats/" + encodeURIComponent(String(cat.slug || req.params.slug || "").trim()), kotocatsCore, cat, relatedCats, activeNeeds: Array.isArray(activeNeeds) ? activeNeeds : [], catsError: catsData.error, query: req.query || {}, paymentQuery: req.query || {}, styles: ["home-fixes", "gallery", "cat-detail", "cat-donate"] });
    } catch (err) { return next(err); }
  });
  return router;
}

module.exports = createCatsRouter;
