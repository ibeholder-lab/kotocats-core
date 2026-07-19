const path = require("path");

const { verifyInitData, createSession } = require("../services/telegram-auth");
const maps = require("../services/directus-avatar-maps");
const createDirectusClient = require("../../lib/directus-client");

const themes = new Set(["crown", "wings", "scepter"]);

function editorRoleId() {
  return String(process.env.AVATAR_EDITOR_ROLE_ID || "1").trim();
}

async function canEditAvatars(telegramId) {
  const client = createDirectusClient({
    directusUrl: process.env.DIRECTUS_URL,
    directusToken: process.env.DIRECTUS_TOKEN,
  });
  const result = await client.get("/items/animals_team", {
    filter: {
      telegram_id: { _eq: String(telegramId) },
      is_active: { _eq: true },
      role_id: { _eq: editorRoleId() },
    },
    fields: "id",
    limit: 1,
  });
  return Array.isArray(result.data) && result.data.length > 0;
}

function page(req, res) {
  res.sendFile(path.join(__dirname, "..", "views", "index.html"));
}

async function auth(req, res) {
  const telegramUser = verifyInitData(
    req.body && req.body.initData,
    process.env.TELEGRAM_BOT_TOKEN,
  );

  if (!telegramUser || !process.env.AVATAR_EDITOR_SESSION_SECRET) {
    return res.status(401).json({ ok: false, error: "forbidden" });
  }

  try {
    if (!(await canEditAvatars(telegramUser.id))) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }
  } catch (error) {
    console.error("AVATAR EDITOR ACCESS ERROR:", error.response?.data || error.message);
    return res.status(503).json({ ok: false, error: "access_check_failed" });
  }

  res.setHeader(
    "Set-Cookie",
    "avatar_editor_session=" +
      encodeURIComponent(
        createSession(telegramUser.id, process.env.AVATAR_EDITOR_SESSION_SECRET),
      ) +
      "; Max-Age=28800; Path=/; HttpOnly; Secure; SameSite=Lax",
  );
  return res.json({ ok: true });
}

async function animals(req, res, next) {
  try {
    res.json({ ok: true, data: await maps.listAnimals() });
  } catch (error) {
    next(error);
  }
}

async function media(req, res, next) {
  try {
    if (!maps.validId(req.params.id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }
    return res.json({ ok: true, data: await maps.listMedia(req.params.id) });
  } catch (error) {
    return next(error);
  }
}

async function getMap(req, res, next) {
  try {
    const { animalId, fileId } = req.params;
    if (!maps.validId(animalId) || !maps.validId(fileId)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }
    return res.json({ ok: true, data: await maps.getMap(animalId, fileId) });
  } catch (error) {
    return next(error);
  }
}

function validate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !themes.has(value.previewTheme) || !value.anchors || typeof value.anchors !== "object") {
    return null;
  }
  const anchors = {};
  for (const key of ["head", "back", "left_paw", "right_paw"]) {
    const anchor = value.anchors[key];
    if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) || !Number.isFinite(anchor.angle) || anchor.x < 0 || anchor.x > 1 || anchor.y < 0 || anchor.y > 1 || Math.abs(anchor.angle) > 360) {
      return null;
    }
    anchors[key] = { x: anchor.x, y: anchor.y, angle: anchor.angle };
  }
  return { anchors, previewTheme: value.previewTheme };
}

async function putMap(req, res, next) {
  try {
    const value = validate(req.body);
    const { animalId, fileId } = req.params;
    if (!maps.validId(animalId) || !maps.validId(fileId) || !value) {
      return res.status(400).json({ ok: false, error: "invalid_payload" });
    }
    return res.json({
      ok: true,
      data: await maps.putMap(animalId, fileId, value, req.avatarEditor.telegramId),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { page, auth, animals, media, getMap, putMap };
