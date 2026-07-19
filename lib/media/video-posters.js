const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const axios = require("axios");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function config() {
  const directusUrl = String(process.env.DIRECTUS_URL || "").replace(/\/+$/, "");
  const directusToken = String(process.env.DIRECTUS_TOKEN || "");
  if (!directusUrl || !directusToken) throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN are required");
  return {
    directusUrl,
    directusToken,
    ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
    frameSecond: Number(process.env.VIDEO_POSTER_SECOND || 2),
    maxWidth: Number(process.env.VIDEO_POSTER_MAX_WIDTH || 1600),
  };
}

function client() {
  const { directusUrl, directusToken } = config();
  return axios.create({
    baseURL: directusUrl,
    timeout: 120000,
    headers: { Authorization: `Bearer ${directusToken}` },
  });
}

function extractId(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.id || value.directus_files_id || value.file_id || "";
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

async function readMediaRow(mediaId) {
  if (!UUID_RE.test(String(mediaId || ""))) throw new Error("invalid animal_media id");
  const response = await client().get(`/items/animal_media/${encodeURIComponent(mediaId)}`, {
    params: { fields: "id,animal_id,file_id,type,poster_file" },
  });
  return response.data?.data || null;
}

async function downloadVideo(fileId, targetPath) {
  const response = await client().get(`/assets/${encodeURIComponent(fileId)}`, { responseType: "stream" });
  await new Promise((resolve, reject) => {
    const output = require("fs").createWriteStream(targetPath);
    response.data.on("error", reject);
    output.on("error", reject);
    output.on("finish", resolve);
    response.data.pipe(output);
  });
}

async function createPoster(inputPath, outputPath) {
  const { ffmpegPath, frameSecond, maxWidth } = config();
  const safeSecond = Number.isFinite(frameSecond) && frameSecond >= 0 ? frameSecond : 2;
  const safeWidth = Number.isFinite(maxWidth) && maxWidth > 0 ? Math.min(maxWidth, 2400) : 1600;
  await run(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", String(safeSecond),
    "-i", inputPath,
    "-frames:v", "1",
    "-vf", `scale='min(${safeWidth},iw)':-2`,
    "-c:v", "libwebp",
    "-quality", "82",
    outputPath,
  ]);
}

async function uploadPoster(outputPath, mediaRow, sourceFileId) {
  const { directusUrl, directusToken } = config();
  const bytes = await fs.readFile(outputPath);
  const form = new FormData();
  const filename = `animal-video-poster-${sourceFileId}.webp`;
  form.append("file", new Blob([bytes], { type: "image/webp" }), filename);
  form.append("title", `Poster for animal media ${mediaRow.id}`);
  form.append("description", `Automatically generated poster for video ${sourceFileId}`);

  const response = await fetch(`${directusUrl}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${directusToken}` },
    body: form,
  });
  if (!response.ok) throw new Error(`Directus file upload failed: ${response.status} ${await response.text()}`);
  const payload = await response.json();
  return extractId(payload?.data);
}

async function generatePosterForMedia(mediaId, { force = false } = {}) {
  const row = await readMediaRow(mediaId);
  if (!row) return { ok: false, skipped: "media_not_found" };
  if (String(row.type || "").toLowerCase() !== "video") return { ok: false, skipped: "not_video" };

  const sourceFileId = extractId(row.file_id);
  const currentPosterId = extractId(row.poster_file);
  if (!UUID_RE.test(sourceFileId)) return { ok: false, skipped: "video_file_missing" };
  if (currentPosterId && !force) return { ok: true, skipped: "poster_exists", posterFileId: currentPosterId };

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "kotocats-poster-"));
  const inputPath = path.join(workDir, `${crypto.randomUUID()}.video`);
  const outputPath = path.join(workDir, `${sourceFileId}.webp`);

  try {
    await downloadVideo(sourceFileId, inputPath);
    await createPoster(inputPath, outputPath);
    const posterFileId = await uploadPoster(outputPath, row, sourceFileId);
    if (!UUID_RE.test(posterFileId)) throw new Error("Directus returned invalid poster file id");
    await client().patch(`/items/animal_media/${encodeURIComponent(row.id)}`, { poster_file: posterFileId });
    try {
      const { clearCatsCache } = require("../directus-cats");
      if (typeof clearCatsCache === "function") clearCatsCache();
    } catch (_) {}
    return { ok: true, mediaId: row.id, sourceFileId, posterFileId };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

function extractMediaId(payload) {
  const candidates = [
    payload?.media_id,
    payload?.mediaId,
    payload?.id,
    payload?.key,
    payload?.payload?.id,
    payload?.payload?.key,
    payload?.event?.key,
    payload?.$trigger?.key,
  ];
  return candidates.map(String).find((value) => UUID_RE.test(value)) || "";
}

async function generateMissingPosters({ limit = 5 } = {}) {
  const response = await client().get("/items/animal_media", {
    params: {
      filter: { type: { _eq: "video" }, poster_file: { _null: true } },
      fields: "id",
      sort: "date_created,id",
      limit: Math.max(1, Math.min(Number(limit) || 5, 25)),
    },
  });
  const rows = response.data?.data || [];
  const results = [];
  for (const row of rows) {
    try {
      results.push(await generatePosterForMedia(row.id));
    } catch (error) {
      console.error("VIDEO POSTER GENERATION ERROR:", row.id, error.message);
      results.push({ ok: false, mediaId: row.id, error: error.message });
    }
  }
  return results;
}

let workerTimer = null;
let workerBusy = false;
function startPosterWorker() {
  if (workerTimer || String(process.env.VIDEO_POSTER_WORKER_ENABLED || "true") === "false") return;
  const intervalMs = Math.max(60000, Number(process.env.VIDEO_POSTER_SCAN_INTERVAL_MS || 120000));
  const tick = async () => {
    if (workerBusy) return;
    workerBusy = true;
    try { await generateMissingPosters({ limit: 3 }); }
    catch (error) { console.error("VIDEO POSTER WORKER ERROR:", error.message); }
    finally { workerBusy = false; }
  };
  setTimeout(tick, 5000).unref();
  workerTimer = setInterval(tick, intervalMs);
  workerTimer.unref();
}

module.exports = {
  extractMediaId,
  generatePosterForMedia,
  generateMissingPosters,
  startPosterWorker,
};
