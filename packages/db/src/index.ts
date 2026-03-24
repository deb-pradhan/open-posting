// ============================================================================
// Open Posting — Database Client
// ============================================================================

import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export * from './schema/index.js';
export { schema, sql };

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, {
    max: 20,
    idle_timeout: 30,
    connect_timeout: 10,
  });

  const db = drizzle(client, { schema });

  return db;
}

export type DbClient = ReturnType<typeof createDatabase>;
