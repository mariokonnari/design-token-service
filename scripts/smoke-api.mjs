// Smoke test for the BUILT API: run after `pnpm build`.
// Starts `node apps/api/dist/index.js` on a free port, polls GET /health until
// it returns 200, asserts the body, and always stops the process.
// Cross-platform: no shell, no signals beyond child.kill().
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const entry = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../apps/api/dist/index.js',
)
const timeoutMs = 15_000
const pollIntervalMs = 200

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

// Ask the OS for a free port. There is a small window between closing this
// server and the API binding the port; acceptable for a smoke test.
function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolvePort(address.port)
        else reject(new Error('Could not determine a free port'))
      })
    })
  })
}

async function main() {
  if (!existsSync(entry)) {
    throw new Error(`${entry} not found. Run \`pnpm build\` first.`)
  }

  const port = await getFreePort()
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'inherit', 'inherit'],
  })

  let exitCode = null
  child.once('exit', (code) => {
    exitCode = code ?? 1
  })
  child.once('error', (error) => {
    console.error(`Failed to start API: ${error.message}`)
    exitCode = 1
  })

  try {
    const url = `http://127.0.0.1:${port}/health`
    const deadline = Date.now() + timeoutMs
    let lastError = 'no response yet'

    while (Date.now() < deadline) {
      if (exitCode !== null) {
        throw new Error(`API exited early with code ${exitCode}`)
      }
      try {
        const response = await fetch(url)
        if (response.status === 200) {
          const body = await response.json()
          if (JSON.stringify(body) !== JSON.stringify({ status: 'ok' })) {
            throw new Error(`Unexpected /health body: ${JSON.stringify(body)}`)
          }
          console.log(
            `smoke:api OK - GET ${url} -> 200 ${JSON.stringify(body)}`,
          )
          return
        }
        lastError = `HTTP ${response.status}`
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Unexpected')) {
          throw error
        }
        lastError = error instanceof Error ? error.message : String(error)
      }
      await sleep(pollIntervalMs)
    }
    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for ${url} (${lastError})`,
    )
  } finally {
    child.kill()
  }
}

main().catch((error) => {
  console.error(
    `smoke:api FAILED - ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 1
})
