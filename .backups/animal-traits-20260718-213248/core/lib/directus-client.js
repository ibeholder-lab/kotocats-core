const axios = require("axios");

function createDirectusClient(options = {}) {
  const directusUrl = String(options.directusUrl || "").replace(/\/$/, "");
  const directusToken = options.directusToken || "";

  if (!directusUrl) {
    throw new Error("kotocats-core: directusUrl is required");
  }

  const client = axios.create({
    baseURL: directusUrl,
    timeout: options.timeout || 15000,
    headers: directusToken
      ? {
          Authorization: `Bearer ${directusToken}`,
        }
      : {},
  });

  async function get(path, params = {}) {
    const response = await client.get(path, { params });
    return response.data;
  }

  return {
    client,
    get,
  };
}

module.exports = createDirectusClient;
