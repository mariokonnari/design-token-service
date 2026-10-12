import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'

/**
 * The ONE place the Prisma client is created. ESLint forbids importing the
 * generated client, the adapter or `pg` anywhere else in src/ except
 * src/repositories (ADR 0012), so every query goes through a repository.
 *
 * Constructing the client does not open a connection; the first query does.
 */
export type Db = PrismaClient

export interface DbOptions {
  /** Maximum connections in the pool (the `pg` default, 10, when omitted). */
  poolMax?: number
}

export function createPrismaClient(
  databaseUrl: string,
  options: DbOptions = {},
): Db {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrl,
      ...(options.poolMax === undefined ? {} : { max: options.poolMax }),
    }),
  })
}
