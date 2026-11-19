import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import fs from 'node:fs';
import { env } from '../config/env.js';

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface DbClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  driver: 'postgres' | 'pglite';
}

class PostgresAdapter implements DbClient {
  public readonly driver = 'postgres' as const;
  private pool: pg.Pool;

  constructor(connectionString: string, ssl: boolean) {
    this.pool = new pg.Pool({
      connectionString,
      ssl: ssl ? { rejectUnauthorized: false } : undefined,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const res = await this.pool.query(sql, params);
    return {
      rows: res.rows as T[],
      rowCount: res.rowCount ?? res.rows.length,
    };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txWrapper: DbClient = {
        driver: 'postgres',
        query: async <R = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
          const res = await client.query(sql, params);
          return { rows: res.rows as R[], rowCount: res.rowCount ?? res.rows.length };
        },
        exec: async (sql: string) => {
          await client.query(sql);
        },
        transaction: async <R>(nested: (t: DbClient) => Promise<R>) => nested(txWrapper),
        close: async () => {},
      };
      const result = await fn(txWrapper);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class PGliteAdapter implements DbClient {
  public readonly driver = 'pglite' as const;
  private pg: PGlite;

  constructor(dataDir?: string) {
    if (dataDir && dataDir !== 'memory') {
      const resolved = path.resolve(dataDir);
      fs.mkdirSync(resolved, { recursive: true });
      this.pg = new PGlite(resolved);
    } else {
      this.pg = new PGlite();
    }
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    await this.pg.waitReady;
    const res = await this.pg.query<T>(sql, params);
    return {
      rows: res.rows,
      rowCount: res.affectedRows ?? res.rows.length,
    };
  }

  async exec(sql: string): Promise<void> {
    await this.pg.waitReady;
    await this.pg.exec(sql);
  }

  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    await this.pg.waitReady;
    return this.pg.transaction(async (tx) => {
      const txWrapper: DbClient = {
        driver: 'pglite',
        query: async <R = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
          const res = await tx.query<R>(sql, params);
          return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
        },
        exec: async (sql: string) => {
          await tx.exec(sql);
        },
        transaction: async <R>(nested: (t: DbClient) => Promise<R>) => nested(txWrapper),
        close: async () => {},
      };
      return fn(txWrapper);
    });
  }

  async close(): Promise<void> {
    await this.pg.close();
  }
}

let dbInstance: DbClient | null = null;

export function createDbClient(databaseUrl = env.databaseUrl, ssl = env.databaseSsl): DbClient {
  if (databaseUrl.startsWith('pglite://')) {
    const target = databaseUrl.replace('pglite://', '');
    return new PGliteAdapter(target === 'memory' ? 'memory' : target);
  }
  return new PostgresAdapter(databaseUrl, ssl);
}

export function getDb(): DbClient {
  if (!dbInstance) {
    dbInstance = createDbClient();
  }
  return dbInstance;
}

export function setDbForTesting(client: DbClient): void {
  dbInstance = client;
}

export async function closeDb(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = null;
  }
}
