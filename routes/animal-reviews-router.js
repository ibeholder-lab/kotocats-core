const axios = require("axios");
const express = require("express");
const { createAnimalReviewsModule } = require("./animal-reviews.module");

function createAnimalReviewsRouter() {
  const directusUrl = String(process.env.DIRECTUS_URL || "").replace(/\/+$/, "");
  const token = process.env.DIRECTUS_TOKEN || "";
  if (!directusUrl || !token) throw new Error("animal reviews: Directus config is required");
  const headers = (extra = {}) => ({ Authorization: `Bearer ${token}`, ...extra });
  const get = async (collection, params = {}) => {
    const result = await axios.get(`${directusUrl}/items/${collection}`, { headers: headers(), params, timeout: 30000 });
    return result.data?.data || [];
  };
  const reviews = createAnimalReviewsModule({
    axios,
    DIRECTUS_URL: directusUrl,
    DIRECTUS_TIMEOUT_MS: 30000,
    apiHeaders: headers,
    directusGet: get,
    directusPost: async (collection, body) => (await axios.post(`${directusUrl}/items/${collection}`, body, { headers: headers({ "Content-Type": "application/json" }), timeout: 30000 })).data?.data,
    directusPatch: async (collection, id, body) => (await axios.patch(`${directusUrl}/items/${collection}/${encodeURIComponent(id)}`, body, { headers: headers({ "Content-Type": "application/json" }), timeout: 30000 })).data?.data,
    getAnimalById: async (id) => (await get("animals", { filter: { id: { _eq: id } }, fields: "id,name,status,published,is_public,is_archived,archived", limit: 1 }))[0] || null,
  });
  const router = express.Router();
  router.use((req, res, next) => {
    const url = new URL(req.originalUrl, `http://${req.headers.host || "localhost"}`);
    return reviews.route(req, res, url) ? undefined : next();
  });
  return router;
}

module.exports = { createAnimalReviewsRouter };
