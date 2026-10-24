export interface Attempt { failCount: number; windowStart: number }
export interface Stores {
  getEpoch(): Promise<number>;
  bumpEpoch(): Promise<number>;
  getAttempt(key: string): Promise<Attempt | null>;
  recordFailure(key: string, now: number, windowMs: number): Promise<Attempt>;
  clearAttempt(key: string): Promise<void>;
}

export function d1Stores(db: D1Database): Stores {
  return {
    async getEpoch() {
      const row = await db.prepare("SELECT value FROM settings WHERE key = 'session_epoch'").first<{ value: string }>();
      const epoch = Number(row?.value);
      if (!Number.isSafeInteger(epoch) || epoch < 1) throw new Error('Invalid session epoch.');
      return epoch;
    },
    async bumpEpoch() {
      const results = await db.batch<{ value: string }>([
        db.prepare("UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'session_epoch'"),
        db.prepare("SELECT value FROM settings WHERE key = 'session_epoch'"),
      ]);
      const epoch = Number(results[1].results[0]?.value);
      if (!Number.isSafeInteger(epoch) || epoch < 1) throw new Error('Invalid session epoch.');
      return epoch;
    },
    async getAttempt(key) {
      return db.prepare('SELECT fail_count AS failCount, window_start AS windowStart FROM login_attempts WHERE ip_hash = ?1').bind(key).first<Attempt>();
    },
    async recordFailure(key, now, windowMs) {
      const results = await db.batch<Attempt>([
        db.prepare(`INSERT INTO login_attempts (ip_hash, fail_count, window_start) VALUES (?1, 1, ?2)
ON CONFLICT(ip_hash) DO UPDATE SET
  fail_count = CASE WHEN window_start + ?3 <= ?2 THEN 1 ELSE fail_count + 1 END,
  window_start = CASE WHEN window_start + ?3 <= ?2 THEN ?2 ELSE window_start END`).bind(key, now, windowMs),
        db.prepare('DELETE FROM login_attempts WHERE window_start < ?1').bind(now - 86400000),
        db.prepare('SELECT fail_count AS failCount, window_start AS windowStart FROM login_attempts WHERE ip_hash = ?1').bind(key),
      ]);
      const attempt = results[2].results[0];
      if (!attempt) throw new Error('Attempt was not recorded.');
      return attempt;
    },
    async clearAttempt(key) { await db.prepare('DELETE FROM login_attempts WHERE ip_hash = ?1').bind(key).run(); },
  };
}

export function memoryStores(): Stores {
  let epoch = 1;
  const attempts = new Map<string, Attempt>();
  return {
    async getEpoch() { return epoch; },
    async bumpEpoch() { epoch += 1; return epoch; },
    async getAttempt(key) { const attempt = attempts.get(key); return attempt ? { ...attempt } : null; },
    async recordFailure(key, now, windowMs) {
      const previous = attempts.get(key);
      const attempt = !previous || previous.windowStart + windowMs <= now
        ? { failCount: 1, windowStart: now }
        : { failCount: previous.failCount + 1, windowStart: previous.windowStart };
      attempts.set(key, attempt);
      for (const [id, value] of attempts) if (value.windowStart < now - 86400000) attempts.delete(id);
      return { ...attempt };
    },
    async clearAttempt(key) { attempts.delete(key); },
  };
}
