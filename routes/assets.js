const axios = require("axios");
const express = require("express");

const ALLOWED_FORMATS = new Set(["jpg", "jpeg", "png", "webp", "avif"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function positiveInt(value, max = 2000) {
  const number = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(number) && number > 0 ? Math.min(number, max) : null;
}

function apiHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function fileBelongsToPublicAnimal(client, fileId) {
  const publicAnimalFilter = { published: { _eq: true }, status: { _eq: "looking_home" } };
  const directPhoto = await client.get("/items/animals", {
    params: { filter: { ...publicAnimalFilter, main_photo: { _eq: fileId } }, fields: "id", limit: 1 },
  });
  if (directPhoto.data?.data?.length) return true;

  const media = await client.get("/items/animal_media", {
    params: { filter: { _or: [{ file_id: { _eq: fileId } }, { poster_file: { _eq: fileId } }] }, fields: "animal_id", limit: 100 },
  });
  const animalIds = [...new Set((media.data?.data || []).map((row) => String(row.animal_id?.id || row.animal_id || "")).filter(Boolean))];
  if (!animalIds.length) return false;

  const animals = await client.get("/items/animals", {
    params: { filter: { ...publicAnimalFilter, id: { _in: animalIds } }, fields: "id", limit: 1 },
  });
  return Boolean(animals.data?.data?.length);
}

function createAssetsRouter() {
  const router = express.Router();

  router.get("/asset", async (req, res, next) => {
    const directusUrl = String(process.env.DIRECTUS_URL || "").replace(/\/+$/, "");
    const directusToken = process.env.DIRECTUS_TOKEN || "";
    const fileId = String(req.query.id || "").trim();

    if (!directusUrl || !directusToken) return res.status(503).json({ error: "directus_config_missing" });
    if (!UUID_RE.test(fileId)) return res.status(400).json({ error: "invalid_file_id" });

    try {
      const client = axios.create({ baseURL: directusUrl, headers: apiHeaders(directusToken), timeout: 30000 });
      if (!(await fileBelongsToPublicAnimal(client, fileId))) return res.status(404).json({ error: "asset_not_found" });

      const params = {};
      const width = positiveInt(req.query.w || req.query.width);
      const height = positiveInt(req.query.h || req.query.height);
      const format = String(req.query.format || "").toLowerCase();
      if (width) params.width = width;
      if (height) params.height = height;
      if (ALLOWED_FORMATS.has(format)) params.format = format;

      const upstream = await client.get(`/assets/${encodeURIComponent(fileId)}`, { params, responseType: "stream" });
      const contentTypes = {
        avif: "image/avif",
        jpeg: "image/jpeg",
        jpg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
      };
      const upstreamContentType = upstream.headers["content-type"] || "";
      const contentType = upstreamContentType === "application/octet-stream" || !upstreamContentType
        ? (contentTypes[format] || "application/octet-stream")
        : upstreamContentType;
      res.status(200).set({
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      });
      if (upstream.headers["content-length"]) res.set("Content-Length", upstream.headers["content-length"]);
      upstream.data.on("error", next).pipe(res);
    } catch (error) {
      if (error.response?.status === 404) return res.status(404).json({ error: "asset_not_found" });
      if (error.code === "ECONNABORTED") return res.status(504).json({ error: "directus_timeout" });
      return next(error);
    }
  });

  return router;
}

module.exports = createAssetsRouter;
