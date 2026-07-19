"use strict";

const fs = require("fs");
const path = require("path");

const partnersPath = path.join(__dirname, "..", "data", "partners.json");
let cachedMtimeMs = null;
let cachedPartners = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readPartners() {
  let stat;
  try {
    stat = fs.statSync(partnersPath);
  } catch (error) {
    throw new Error(`Unable to read partners data at ${partnersPath}: ${error.message}`);
  }

  if (cachedPartners && cachedMtimeMs === stat.mtimeMs) return cachedPartners;

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(partnersPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid partners JSON at ${partnersPath}: ${error.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new TypeError(`Invalid partners JSON at ${partnersPath}: root value must be an array`);
  }

  cachedMtimeMs = stat.mtimeMs;
  cachedPartners = parsed;
  return cachedPartners;
}

function isActive(partner) {
  return partner && partner.active !== false;
}

function isVisibleForSite(partner, site) {
  if (site === "foundation") return partner.show_on_foundation !== false;
  if (site === "cafe") return partner.show_on_cafe !== false;
  throw new TypeError(`Unknown partners site: ${site}`);
}

function sortPartners(partners) {
  return partners.sort((left, right) => {
    const leftPriority = Number.isFinite(left.priority) ? left.priority : Number.MAX_SAFE_INTEGER;
    const rightPriority = Number.isFinite(right.priority) ? right.priority : Number.MAX_SAFE_INTEGER;
    return leftPriority - rightPriority;
  });
}

function getAll() {
  return clone(readPartners());
}

function getForSite(site) {
  return sortPartners(
    getAll().filter((partner) => isActive(partner) && isVisibleForSite(partner, site)),
  );
}

module.exports = { getAll, getForSite };