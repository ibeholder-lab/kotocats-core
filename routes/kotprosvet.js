const { Readable } = require("stream");

const ARTICLES = [
  {
    slug: "30-sposobov-sdelat-zhizn-koshki-luchshe-za-sekundu",
    title: "30 способов сделать жизнь кошки лучше за секунду",
    cover: "/images/kotocafe/_thumbs/kot/1.webp",
  },
  {
    slug: "blagoslovenie-zhivotnyh-kak-koshek-blagoslovlyayut-v-raznyh-stranah-i-religiyah",
    title: "Благословение животных: как кошек благословляют в разных странах и религиях",
    cover: "/images/kotocafe/_thumbs/kot/2.webp",
  },
  {
    slug: "vsegda-li-nuzhno-zabirat-koshku-s-ulicy",
    title: "Всегда ли нужно забирать кошку с улицы",
    cover: "/images/kotocafe/_thumbs/kot/3.webp",
  },
  {
    slug: "koshachij-tygydyk-pochemu-koshka-rezko-nositsya-po-domu-i-chto-delat",
    title: "Кошачий тыгыдык: почему кошка резко носится по дому и что делать",
    cover: "/images/kotocafe/_thumbs/kot/4.webp",
  },
];

function mediaOrigin() {
  return String(process.env.KOTPROSVET_MEDIA_ORIGIN || "https://koshkivgorode.ru").replace(/\/+$/, "");
}

function publicArticle(article) {
  return {
    slug: article.slug,
    title: article.title,
    coverUrl: `/api/kotprosvet/cover/${encodeURIComponent(article.slug)}`,
  };
}

function createKotprosvetRouter() {
  const express = require("express");
  const router = express.Router();

  router.get("/articles", (req, res) => {
    res.json({ data: ARTICLES.map(publicArticle) });
  });

  router.get("/cover/:slug", async (req, res, next) => {
    const article = ARTICLES.find((item) => item.slug === req.params.slug);
    if (!article) return res.status(404).json({ error: "article_not_found" });

    try {
      const upstream = await fetch(`${mediaOrigin()}${article.cover}`, {
        headers: { Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
      });
      if (!upstream.ok || !upstream.body) {
        return res.status(502).json({ error: "cover_unavailable" });
      }

      res.status(200);
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "image/webp");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return Readable.fromWeb(upstream.body).pipe(res);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = createKotprosvetRouter;
