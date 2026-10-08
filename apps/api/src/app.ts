import express from 'express'

export interface AppDeps {
  /** Resolves true when the database answers. It must not throw. */
  checkReady: () => Promise<boolean>
  /** How long /ready waits for checkReady before answering 503. Default 3000. */
  readyTimeoutMs?: number
}

const DEFAULT_READY_TIMEOUT_MS = 3000

function withTimeout(promise: Promise<boolean>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false)
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(false)
      },
    )
  })
}

export function createApp({
  checkReady,
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
}: AppDeps) {
  const app = express()
  app.disable('x-powered-by')

  // Liveness: the process is up. It must never depend on the database.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // Readiness: the database answers. 503 (no details) when it does not.
  app.get('/ready', async (_req, res) => {
    const ready = await withTimeout(checkReady(), readyTimeoutMs)
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'unavailable',
    })
  })

  return app
}
