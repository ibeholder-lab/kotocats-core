const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data", "hero-images.json");

function read() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function getAll() {
  return read().filter((item) => item.active).sort((a, b) => a.sort - b.sort);
}

function getBySlug(slug) {
  return getAll().find((item) => item.slug === String(slug || "").toLowerCase()) || null;
}

function getFeatured() {
  return getAll().filter((item) => item.featured);
}

module.exports = { getAll, getBySlug, getFeatured };
