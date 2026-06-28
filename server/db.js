import pg from 'pg';

const { Pool } = pg;

let pool = null;

export function isDbEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool() {
  if (!isDbEnabled()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function initDb() {
  const db = getPool();
  if (!db) return false;

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS solo_saves (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      state_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS user_stats (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      hands_played INT NOT NULL DEFAULT 0,
      hands_won INT NOT NULL DEFAULT 0,
      total_profit BIGINT NOT NULL DEFAULT 0,
      vpip_count INT NOT NULL DEFAULT 0,
      pfr_count INT NOT NULL DEFAULT 0,
      showdown_count INT NOT NULL DEFAULT 0,
      showdown_wins INT NOT NULL DEFAULT 0
    );
  `);

  return true;
}

export async function query(text, params) {
  const db = getPool();
  if (!db) throw new Error('Database not configured.');
  return db.query(text, params);
}
