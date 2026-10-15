import { Hono } from 'hono';

/**
 * Aetherium secure-code exchange.
 *
 * Two Aetherium Phone users who want an end-to-end encrypted call need a shared
 * secret that never travels over the carriers voice path. When both phones are
 * online they meet here, hand in their own account id plus the peer account id,
 * and both receive the same short lived one-time code.
 *
 * Contract:
 *   GET /phone/codesetup?ownid=<me>&accountid=<peer>
 *
 * - the code is 60 characters,
 * - it lives for 60 seconds,
 * - it is destroyed after it has been retrieved twice (once per side).
 *
 * The pair is order independent, so both sides converge on the same record.
 */

export interface CodeRecord {
  code: string;
  createdAt: number;
  retrieved: number;
}

export interface PhoneEnv {
  // Optional D1 binding. When it is not provisioned we fall back to an
  // in-memory map, which is enough for a single worker isolate / local dev.
  DB?: D1Database;
}

const CODE_TTL_MS = 60_000;
const MAX_RETRIEVALS = 2;
const CODE_LENGTH = 60;
const CODE_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** In-memory fallback store. */
const memoryStore = new Map<string, CodeRecord>();

function canonicalPair(a: string, b: string): string {
  return [a, b].sort().join('|');
}

function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

async function load(db: D1Database | undefined, key: string): Promise<CodeRecord | null> {
  if (!db) {
    return memoryStore.get(key) ?? null;
  }
  try {
    const row = await db
      .prepare('SELECT code, created_at, retrieved FROM codes WHERE pair_key = ?1')
      .bind(key)
      .first<{ code: string; created_at: number; retrieved: number }>();
    if (!row) {
      return null;
    }
    return { code: row.code, createdAt: row.created_at, retrieved: row.retrieved };
  } catch {
    return memoryStore.get(key) ?? null;
  }
}

async function save(db: D1Database | undefined, key: string, rec: CodeRecord): Promise<void> {
  if (!db) {
    memoryStore.set(key, rec);
    return;
  }
  try {
    await db
      .prepare(
        'INSERT INTO codes (pair_key, code, created_at, retrieved) VALUES (?1, ?2, ?3, ?4) ' +
          'ON CONFLICT(pair_key) DO UPDATE SET code = ?2, created_at = ?3, retrieved = ?4',
      )
      .bind(key, rec.code, rec.createdAt, rec.retrieved)
      .run();
  } catch {
    memoryStore.set(key, rec);
  }
}

async function remove(db: D1Database | undefined, key: string): Promise<void> {
  memoryStore.delete(key);
  if (db) {
    try {
      await db.prepare('DELETE FROM codes WHERE pair_key = ?1').bind(key).run();
    } catch {
      // ignore, memory already cleared
    }
  }
}

export const phoneRoutes = new Hono<{ Bindings: PhoneEnv }>();

phoneRoutes.get('/codesetup', async (c) => {
  const ownid = (c.req.query('ownid') ?? '').trim();
  const accountid = (c.req.query('accountid') ?? '').trim();

  if (!ownid || !accountid) {
    return c.json({ ok: false, error: 'ownid and accountid are required' }, 400);
  }

  const db = c.env?.DB;
  const key = canonicalPair(ownid, accountid);
  const now = Date.now();

  let record = await load(db, key);

  if (record && now - record.createdAt > CODE_TTL_MS) {
    await remove(db, key);
    record = null;
  }

  if (!record) {
    record = { code: generateCode(), createdAt: now, retrieved: 0 };
  }

  if (record.retrieved >= MAX_RETRIEVALS) {
    await remove(db, key);
    return c.json({ ok: false, error: 'code already consumed', code: null }, 410);
  }

  record.retrieved += 1;
  await save(db, key, record);

  // Once both sides have read it the code is burned.
  if (record.retrieved >= MAX_RETRIEVALS) {
    await remove(db, key);
  }

  return c.json({
    ok: true,
    code: record.code,
    expires_in_ms: Math.max(0, CODE_TTL_MS - (now - record.createdAt)),
    retrieved_count: record.retrieved,
  });
});
