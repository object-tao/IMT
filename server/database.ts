import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';

export type Sql = { query: (sql: string, params?: unknown[]) => Promise<Record<string, any>[]> };
export class Database {
  private sqlite?: DatabaseSync;
  private pool?: pg.Pool;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(options: { url?: string; file?: string } = {}) {
    if (options.url) this.pool = new pg.Pool({ connectionString: options.url, max: 10 });
    else {
      const file = options.file ?? './data/imt.sqlite';
      if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
      this.sqlite = new DatabaseSync(file);
      this.sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    }
  }
  get driver() { return this.pool ? 'postgresql' : 'sqlite'; }
  async initialize() {
    await this.transaction(async tx => {
      await tx.query('CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
      await tx.query('CREATE TABLE IF NOT EXISTS resources (kind TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0), payload TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(kind,id))');
      await tx.query('CREATE TABLE IF NOT EXISTS plan_versions (id TEXT PRIMARY KEY, group_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0), payload TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(group_id,version))');
      await tx.query('CREATE TABLE IF NOT EXISTS demands (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL)');
      await tx.query('CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, action TEXT NOT NULL, subject TEXT NOT NULL, created_at TEXT NOT NULL)');
      await tx.query('INSERT INTO migrations(version,applied_at) VALUES(1,?) ON CONFLICT(version) DO NOTHING', [new Date().toISOString()]);
    });
  }
  async query(sql: string, params: unknown[] = []) {
    if (!this.pool) await this.queue;
    return this.rawQuery(sql, params);
  }
  private async rawQuery(sql: string, params: unknown[] = []) {
    if (this.pool) return (await this.pool.query(this.pgSql(sql), params)).rows;
    const statement = this.sqlite!.prepare(sql);
    if (/^(SELECT|WITH|PRAGMA)/i.test(sql)) return statement.all(...params as any[]) as Record<string, any>[];
    statement.run(...params as any[]); return [];
  }
  private pgSql(sql: string) { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); }
  async transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(83472591)');
        const result = await fn({ query: async (sql, params = []) => (await client.query(this.pgSql(sql), params)).rows });
        await client.query('COMMIT'); return result;
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    }
    const task = this.queue.then(async () => {
      this.sqlite!.exec('BEGIN IMMEDIATE');
      try { const result = await fn({ query: this.rawQuery.bind(this) }); this.sqlite!.exec('COMMIT'); return result; }
      catch (e) { this.sqlite!.exec('ROLLBACK'); throw e; }
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async sqliteBackup(path: string) { if (!this.sqlite) throw new Error('PostgreSQL 请使用 pg_dump 备份'); await this.queue; mkdirSync(dirname(path), { recursive: true }); await backup(this.sqlite, path); }
  async close() { await this.queue; if (this.pool) await this.pool.end(); this.sqlite?.close(); }
}
