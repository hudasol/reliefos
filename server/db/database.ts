import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';

// One narrow database interface over two engines:
//  - node-postgres against a real PostgreSQL server (Render Postgres in production)
//  - PGlite (PostgreSQL compiled to WASM) for local development and tests without a server.
// Both run the same SQL and the same migrations, so behaviour does not fork between environments.

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

/** A transaction handle. `exec` runs multi-statement SQL (used by migrations). */
export interface TxQueryable extends Queryable {
  exec(sql: string): Promise<void>;
}

export interface Database extends Queryable {
  readonly kind: 'postgres' | 'pglite';
  tx<T>(fn: (q: TxQueryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

class PostgresDatabase implements Database {
  readonly kind = 'postgres' as const;
  constructor(private readonly pool: pg.Pool) {}

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const res = await this.pool.query(sql, params as unknown[]);
    return res.rows as T[];
  }

  async tx<T>(fn: (q: TxQueryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const q: TxQueryable = {
        query: async <R>(sql: string, params: readonly unknown[] = []) =>
          (await client.query(sql, params as unknown[])).rows as R[],
        exec: async (sql: string) => {
          await client.query(sql);
        },
      };
      const result = await fn(q);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class PgliteDatabase implements Database {
  readonly kind = 'pglite' as const;
  constructor(private readonly db: PGlite) {}

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const res = await this.db.query<T>(sql, params as unknown[]);
    return res.rows;
  }

  async tx<T>(fn: (q: TxQueryable) => Promise<T>): Promise<T> {
    return this.db.transaction(async (t) =>
      fn({
        query: async <R>(sql: string, params: readonly unknown[] = []) =>
          (await t.query<R>(sql, params as unknown[])).rows,
        exec: async (sql: string) => {
          await t.exec(sql);
        },
      }),
    );
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async ping(): Promise<boolean> {
    try {
      await this.db.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

export interface DatabaseOptions {
  databaseUrl: string | null;
  /** Directory for a persistent PGlite store; `null` keeps PGlite in memory (tests). */
  pgliteDataDir: string | null;
}

export async function openDatabase(opts: DatabaseOptions): Promise<Database> {
  if (opts.databaseUrl) {
    // Render's internal hostnames (e.g. dpg-abc123-a) have no dots and do not need TLS; external
    // hostnames do. An explicit sslmode in the URL always wins.
    const url = new URL(opts.databaseUrl);
    const sslmode = url.searchParams.get('sslmode');
    const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    const needsTls = sslmode ? sslmode !== 'disable' : !isLocal && url.hostname.includes('.');
    const pool = new pg.Pool({
      connectionString: opts.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: needsTls ? { rejectUnauthorized: false } : undefined,
    });
    return new PostgresDatabase(pool);
  }
  if (opts.pgliteDataDir) mkdirSync(opts.pgliteDataDir, { recursive: true });
  const lite = opts.pgliteDataDir ? new PGlite(opts.pgliteDataDir) : new PGlite();
  await lite.waitReady;
  return new PgliteDatabase(lite);
}
