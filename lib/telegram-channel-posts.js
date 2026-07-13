const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeTelegramPostUrl(channel, messageId) {
  const cleanChannel = String(channel || "").replace(/^@/, "");
  return `https://t.me/${cleanChannel}/${messageId}`;
}

async function ensureAnimalChannelPostsTable() {
  await pool.query(`
    create table if not exists animal_channel_posts (
      id uuid primary key default gen_random_uuid(),
      animal_id uuid not null references animals(id),
      channel text not null,
      message_id bigint not null,
      text text,
      post_date timestamptz,
      post_url text,
      created_at timestamptz default now(),

      unique(channel, message_id, animal_id)
    );
  `);
}

async function loadAnimalsForTelegramPostMatching() {
  const result = await pool.query(`
    select
      id,
      name,
      slug
    from animals
    where name is not null
      and trim(name) <> ''
  `);

  return result.rows.map((animal) => {
    const searchNames = [
      animal.name,
      animal.slug
    ]
      .filter(Boolean)
      .map(normalizeText)
      .filter(Boolean);

    return {
      ...animal,
      searchNames: Array.from(new Set(searchNames))
    };
  });
}

function findAnimalsInTelegramText(text, animals) {
  const normalizedText = normalizeText(text);
  const foundAnimals = [];

  for (const animal of animals) {
    for (const name of animal.searchNames || []) {
      if (!name || name.length < 2) continue;

      const pattern = new RegExp(
        `(^|\\s)${escapeRegExp(name)}($|\\s)`,
        "iu"
      );

      if (pattern.test(normalizedText)) {
        foundAnimals.push(animal);
        break;
      }
    }
  }

  return foundAnimals;
}

async function saveAnimalChannelPost({
  animalId,
  channel,
  messageId,
  text,
  postDate
}) {
  const postUrl = makeTelegramPostUrl(channel, messageId);

  await pool.query(
    `
      insert into animal_channel_posts (
        animal_id,
        channel,
        message_id,
        text,
        post_date,
        post_url
      )
      values ($1, $2, $3, $4, $5, $6)
      on conflict (channel, message_id, animal_id)
      do update set
        text = excluded.text,
        post_date = excluded.post_date,
        post_url = excluded.post_url
    `,
    [
      animalId,
      channel,
      messageId,
      text || null,
      postDate || null,
      postUrl
    ]
  );

  return postUrl;
}

async function loadAnimalChannelPosts(animalId, options = {}) {
  const limit = Number(options.limit || 20);

  const result = await pool.query(
    `
      select
        id,
        animal_id,
        channel,
        message_id,
        text,
        post_date,
        post_url
      from animal_channel_posts
      where animal_id = $1
      order by post_date desc nulls last, message_id desc
      limit $2
    `,
    [
      animalId,
      limit
    ]
  );

  return result.rows;
}

async function closeTelegramPostsPool() {
  await pool.end();
}

module.exports = {
  ensureAnimalChannelPostsTable,
  loadAnimalsForTelegramPostMatching,
  findAnimalsInTelegramText,
  saveAnimalChannelPost,
  loadAnimalChannelPosts,
  makeTelegramPostUrl,
  closeTelegramPostsPool
};
