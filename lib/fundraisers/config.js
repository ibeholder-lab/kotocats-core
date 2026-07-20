"use strict";
const fs = require("fs");
const path = require("path");
const ALLOWED = "www.donation.ru";
const CAT_SLUG=/^[a-z0-9_-]+$/;
function catSlugs(v){return Array.isArray(v)?[...new Set(v.filter(s=>typeof s==="string").map(s=>s.trim().toLowerCase()).filter(s=>CAT_SLUG.test(s)))]:[]}
function image(v){try{const u=new URL(v);return u.protocol==="https:"&&u.hostname==="file.donation.ru"&&u.port==="4443"&&!u.username&&!u.password&&!u.search&&!u.hash?u.href:null}catch{return null}}
function parseItem(item, index, warn = console.warn) {
  if (!item || typeof item !== "object" || item.enabled === false) return null;
  if (typeof item.url !== "string" || typeof item.sort !== "number" || !Number.isFinite(item.sort)) { warn("fundraisers: invalid config item skipped"); return null; }
  let url;
  try { url = new URL(item.url); } catch { warn("fundraisers: invalid URL skipped"); return null; }
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname !== ALLOWED || url.port || url.search || url.hash || parts.length !== 2 || !parts.every((part) => /^[a-zA-Z0-9_-]+$/.test(part))) { warn("fundraisers: disallowed URL skipped"); return null; }
  return { url: url.href, fund_page: parts[0], slug: parts[1], sort: item.sort, cat_slugs: catSlugs(item.cat_slugs), image: image(item.image), featured: item.featured === true, title_override: typeof item.title_override === "string" ? item.title_override : null, description_override: typeof item.description_override === "string" ? item.description_override : null, index };
}
function loadConfig(file = path.resolve(__dirname, "../../config/fundraisers.json"), warn = console.warn) {
  let raw; try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { throw new Error(error instanceof SyntaxError ? "fundraisers_config_invalid_json" : "fundraisers_config_missing"); }
  if (!raw || raw.source !== "donation.ru" || !Array.isArray(raw.items)) throw new Error("fundraisers_config_invalid");
  for (const key of ["cache_ttl_seconds","stale_ttl_seconds","request_timeout_ms"]) if (!Number.isFinite(raw[key]) || raw[key] <= 0) throw new Error("fundraisers_config_invalid");
  return { source: raw.source, cache_ttl_seconds: raw.cache_ttl_seconds, stale_ttl_seconds: raw.stale_ttl_seconds, request_timeout_ms: raw.request_timeout_ms, items: raw.items.map((x,i) => parseItem(x,i,warn)).filter(Boolean).sort((a,b) => a.sort - b.sort || a.index - b.index) };
}
module.exports = { loadConfig, parseItem, catSlugs, image };
