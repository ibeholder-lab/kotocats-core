"use strict";

const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.env.MEDIA_UPLOAD_STORAGE_DIR || path.join(__dirname, "..", "storage", "media-uploads");
const UUID = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function uploadDir(id) { if (!UUID.test(id)) throw new Error("invalid_upload_id"); return path.join(ROOT, id); }
async function ensureRoot() { await fs.mkdir(ROOT, { recursive: true, mode: 0o700 }); }
async function writeMetadata(dir, data) { const tmp = path.join(dir, `.metadata-${crypto.randomUUID()}.tmp`); await fs.writeFile(tmp, JSON.stringify(data), { mode: 0o600 }); await fs.rename(tmp, path.join(dir, "metadata.json")); }
async function read(id) { const dir = uploadDir(id); const metadata = JSON.parse(await fs.readFile(path.join(dir, "metadata.json"), "utf8")); return { dir, metadata }; }
async function save(dir, metadata) { metadata.updated_at = new Date().toISOString(); await writeMetadata(dir, metadata); return metadata; }
async function create(data) { await ensureRoot(); const id = crypto.randomUUID(); const dir = uploadDir(id); await fs.mkdir(path.join(dir, "chunks"), { recursive: true, mode: 0o700 }); await writeMetadata(dir, { ...data, id }); return { id, dir }; }
async function cleanup() { await ensureRoot(); const entries = await fs.readdir(ROOT, { withFileTypes: true }); await Promise.all(entries.filter(x => x.isDirectory() && UUID.test(x.name)).map(async (entry) => { try { const { metadata } = await read(entry.name); if (Date.now() - Date.parse(metadata.updated_at || metadata.created_at) > MAX_AGE_MS) await fs.rm(uploadDir(entry.name), { recursive: true, force: true }); } catch { await fs.rm(path.join(ROOT, entry.name), { recursive: true, force: true }); } })); }
module.exports = { ROOT, create, read, save, cleanup, uploadDir };
