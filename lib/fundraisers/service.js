"use strict";
const { DonationClient } = require("./donation-client");
function finiteNumber(value) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function plainText(value) { return typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : null; }
function normalize(target, item) {
  const targetSum = finiteNumber(target?.target_sum), currentSum = finiteNumber(target?.current_sum), totalSum = finiteNumber(target?.total_sum);
  if (!Number.isInteger(target?.id) || !Number.isInteger(target?.company_id) || typeof target?.title !== "string") throw new Error("upstream_invalid_payload");
  const data = target.data && typeof target.data === "object" ? target.data : {};
  const description = item.description_override || plainText(data.shortText) || plainText(data.text) || null;
  return { id: target.id, company_id: target.company_id, source: "donation.ru", fund_page: item.fund_page, slug: item.slug, url: item.url, title: item.title_override || target.title, description, target_sum: targetSum, current_sum: currentSum, total_sum: totalSum, final_sum: target.final_sum ?? null, progress_percent: targetSum > 0 && currentSum >= 0 ? Math.round(Math.min(100, Math.max(0, currentSum / targetSum * 100)) * 10) / 10 : null, collected_sum_text: typeof data.collectedSumText === "string" ? data.collectedSumText : null, target_sum_text: typeof data.targetSumText === "string" ? data.targetSumText : null, image: item.image, cat_slugs: item.cat_slugs, featured: item.featured, sort: item.sort };
}
class FundraisersService {
  constructor({ config, client, now = () => Date.now(), warn = console.warn } = {}) { this.config = config; this.client = client || new DonationClient({ timeoutMs: config.request_timeout_ms }); this.now = now; this.warn = warn; this.cache = null; this.inflight = null; }
  async refresh() { if (this.inflight) return this.inflight; this.inflight = this._refresh().finally(() => { this.inflight = null; }); return this.inflight; }
  async _refresh() { const settled = await Promise.allSettled(this.config.items.map(async item => { try { return { item, value: normalize(await this.client.getTarget(item), item) }; } catch (error) { error.item = item; throw error; } })); const items=[], errors=[]; for (const result of settled) { if (result.status === "fulfilled") items.push(result.value.value); else { const item = result.reason?.item; errors.push({ slug: item?.slug || "unknown", code: result.reason?.message || "upstream_unavailable" }); } } if (errors.length) throw Object.assign(new Error("fundraisers_refresh_failed"), { errors }); const data = { ok: true, source: "donation.ru", updated_at: new Date(this.now()).toISOString(), stale: false, items, errors }; this.cache = { at: this.now(), data }; return data; }
  getCached() { if (!this.cache) throw new Error("fundraisers_unavailable"); return this.cache.data; }
}
module.exports = { FundraisersService, normalize, plainText };
