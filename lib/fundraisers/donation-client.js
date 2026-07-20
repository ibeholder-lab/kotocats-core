"use strict";
const ENDPOINT = "https://www.donation.ru/pub/target/get-target-by-page";
class DonationClient {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) { this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; }
  async getTarget({ fund_page, slug }) {
    const url = new URL(ENDPOINT); url.search = new URLSearchParams({ fund_page, target_page: slug });
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try { response = await this.fetchImpl(url, { headers: { Accept: "application/json", "User-Agent": "KotocatsCore/1.0 (+https://kotocafe.ru)" }, signal: controller.signal }); }
    catch (error) { throw new Error(error?.name === "AbortError" ? "upstream_timeout" : "upstream_unavailable"); }
    finally { clearTimeout(timer); }
    if (!response.ok) throw new Error(response.status === 404 ? "upstream_not_found" : "upstream_unavailable");
    if (!/^application\/json\b/i.test(response.headers.get("content-type") || "")) throw new Error("upstream_invalid_content_type");
    try { return await response.json(); } catch { throw new Error("upstream_invalid_json"); }
  }
}
module.exports = { DonationClient, ENDPOINT };
