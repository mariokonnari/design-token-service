import { cssVarName } from '@dts/tokens-core'
import { createApp } from './app'
import { EnvError, parseEnv } from './config/env'
import { createReadinessCheck } from './db/ready'

let env: ReturnType<typeof parseEnv>
try {
  env = parseEnv()
} catch (error) {
  console.error(error instanceof EnvError ? error.message : error)
  process.exit(1)
}

// No connection is opened here: the readiness pool is created on the first /ready.
const readiness = createReadinessCheck(env.DATABASE_URL)
const app = createApp({ checkReady: readiness.check })

const server = app.listen(env.PORT, () => {
  console.log(
    `api listening on :${env.PORT} [${env.NODE_ENV}] (tokens-core: ${cssVarName('color.blue.500')})`,
  )
})

function shutdown() {
  server.close(() => {
    void readiness.close().finally(() => process.exit(0))
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
