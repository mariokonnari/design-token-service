// Destroys the LOCAL development database volume and recreates it empty.
// It only ever touches the docker compose volume (dts_pgdata), never a database
// named in DATABASE_URL. It asks for confirmation; without a terminal it refuses
// unless `--yes` is passed.
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'

function run(command, args) {
  const line = `${command} ${args.join(' ')}`
  console.log(`> ${line}`)
  // pnpm is a .cmd shim on Windows and needs a shell. The arguments are fixed
  // strings from this file, and a single command string avoids Node's DEP0190
  // warning about args + shell.
  const result =
    process.platform === 'win32' && command === 'pnpm'
      ? spawnSync(line, { stdio: 'inherit', shell: true })
      : spawnSync(command, args, { stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(
      `db:reset FAILED: "${command} ${args.join(' ')}" exited ${result.status}`,
    )
    process.exit(result.status ?? 1)
  }
}

if (!process.argv.includes('--yes')) {
  if (!process.stdin.isTTY) {
    console.error(
      'db:reset deletes all local database data. Run it in a terminal (it asks first) or pass --yes.',
    )
    process.exit(1)
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(
    'This deletes ALL data in the local Postgres volume (dts_pgdata). Type "reset" to continue: ',
  )
  rl.close()
  if (answer.trim() !== 'reset') {
    console.error('Aborted. Nothing was deleted.')
    process.exit(1)
  }
}

run('docker', ['compose', 'down', '-v'])
run('docker', ['compose', 'up', '-d', '--wait'])
// Apply the committed migrations to the fresh, empty database.
run('pnpm', ['db:migrate'])
console.log('db:reset done: a fresh database with all migrations applied.')
