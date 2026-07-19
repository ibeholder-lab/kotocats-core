const QTICKETS_API_URL = "https://qtickets.ru/api/rest/v1";

const ticketProducts = [
  { id: "207918", hours: "1 час", price: 450, oldPrice: 600, checkoutUrl: "https://t.me/QticketsBuyBot/buy?startapp=207918" },
  { id: "207917", hours: "2 часа", price: 765, oldPrice: 1020, checkoutUrl: "https://t.me/QticketsBuyBot/buy?startapp=207917" },
  { id: "207916", hours: "Целый день", price: 1080, oldPrice: 1440, checkoutUrl: "https://t.me/QticketsBuyBot/buy?startapp=207916" },
];

let cache = { expiresAt: 0, events: new Map() };

async function loadEvent(eventId) {
  if (!process.env.QTICKETS_TOKEN) return null;
  const response = await fetch(`${QTICKETS_API_URL}/events/${eventId}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${process.env.QTICKETS_TOKEN}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Qtickets returned ${response.status}`);
  const payload = await response.json();
  return payload.data || payload;
}

async function getTicketProducts() {
  if (cache.expiresAt < Date.now()) {
    try {
      cache = {
        expiresAt: Date.now() + 5 * 60 * 1000,
        events: new Map(await Promise.all(ticketProducts.map(async ({ id }) => [id, await loadEvent(id)]))),
      };
    } catch (error) {
      console.error("Qtickets events unavailable:", error.message);
      cache = { expiresAt: Date.now() + 60 * 1000, events: new Map() };
    }
  }
  return ticketProducts.map((product) => ({
    ...product,
    name: cache.events.get(product.id)?.name || `Посещение котокафе — ${product.hours}`,
  }));
}

function getTicketProduct(id) {
  return ticketProducts.find((product) => product.id === String(id)) || null;
}

module.exports = { getTicketProducts, getTicketProduct };
