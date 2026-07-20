"use strict";

const { Pool } = require("pg");

let pool;

function getPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

async function closePool() {
  if (pool) {
    const activePool = pool;
    pool = undefined;
    await activePool.end();
  }
}

module.exports = { getPool, closePool };
