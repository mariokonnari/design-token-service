import { Writable } from 'node:stream'
import type { RequestHandler } from 'express'
import { createApp, type AppConfig } from '../../src/app'
import { createLogger } from '../../src/http/logger'
import type { RouteGuards } from '../../src/routes/mount'
import { buildRouteTable, type RouteDef } from '../../src/routes/table'

/** Captures what pino writes, so tests can assert on the REAL log output. */
export function logCapture() {
  const chunks: string[] = []
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString())
      callback()
    },
  })
  return {
    stream,
    text: () => chunks.join(''),
    records: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  }
}

export const ALLOWED_ORIGIN = 'https://app.example.test'

export const testConfig: AppConfig = {
  allowedOrigins: [ALLOWED_ORIGIN],
  trustProxy: 0,
}

export function testRoute(
  method: RouteDef['method'],
  path: string,
  handler: RequestHandler,
  extra: Partial<
    Pick<RouteDef, 'access' | 'before' | 'after' | 'refinedBy'>
  > = {},
): RouteDef {
  return { method, path, access: 'public', handler, ...extra }
}

/** An app with the real probe routes plus any extra routes the test needs. */
export function appWith(
  extraRoutes: RouteDef[] = [],
  overrides: Partial<{
    config: Partial<AppConfig>
    checkReady: () => Promise<boolean>
    readyTimeoutMs: number
    guards: RouteGuards
  }> = {},
) {
  const capture = logCapture()
  const logger = createLogger({ level: 'info', destination: capture.stream })
  const routes = [
    ...buildRouteTable({
      checkReady: overrides.checkReady ?? (() => Promise.resolve(true)),
      ...(overrides.readyTimeoutMs === undefined
        ? {}
        : { readyTimeoutMs: overrides.readyTimeoutMs }),
    }),
    ...extraRoutes,
  ]
  const app = createApp({
    config: { ...testConfig, ...overrides.config },
    logger,
    routes,
    ...(overrides.guards === undefined ? {} : { guards: overrides.guards }),
  })
  return { app, capture, routes }
}
