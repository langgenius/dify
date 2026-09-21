#!/usr/bin/env -S bun
// scripts/run-smoke.ts — seven checks against a running Dify server (or mock),
// through `bun bin/dev.js`. DIFY_SERVER, DIFY_TOKEN, DIFY_CONFIG_DIR, and
// DIFY_CACHE_DIR are read from the environment and passed through unchanged.
import { execFileSync, spawnSync } from 'node:child_process'
import { ExitCode } from '../src/errors/codes.js'

type Check = { name: string; run: () => void }

function cli(args: string[]): string {
  return execFileSync('bun', ['bin/dev.js', ...args], { encoding: 'utf8' })
}

function cliExitCode(args: string[]): number {
  return spawnSync('bun', ['bin/dev.js', ...args], { encoding: 'utf8' }).status ?? 1
}

function expectExit(args: string[], expected: number): void {
  const code = cliExitCode(args)
  if (code !== expected)
    throw new Error(`expected exit ${expected} for "${args.join(' ')}", got ${code}`)
}

const checks: Check[] = [
  {
    name: 'version prints .client.version',
    run: () => {
      const body = JSON.parse(cli(['version']))
      if (typeof body.client?.version !== 'string') throw new Error('no .client.version')
    },
  },
  {
    name: 'ops lists more than 20 operations',
    run: () => {
      const body = JSON.parse(cli(['ops']))
      if (!Array.isArray(body.ops) || !(body.ops.length > 20))
        throw new Error(`.ops has ${body.ops?.length ?? 'no'} entries, expected > 20`)
    },
  },
  {
    name: 'ops describe console_app.list carries .input.properties.workspace_id',
    run: () => {
      const body = JSON.parse(cli(['ops', 'describe', 'console_app.list']))
      if (body.input?.properties?.workspace_id === undefined)
        throw new Error('no .input.properties.workspace_id')
    },
  },
  {
    name: 'call console_app.list returns .data',
    run: () => {
      const body = JSON.parse(cli(['call', 'console_app.list', '--input', '{"limit":1}']))
      if (body.data === undefined) throw new Error('no .data')
    },
  },
  {
    name: 'call on an unknown op id exits 6 (catalog)',
    run: () => expectExit(['call', 'nope.op'], ExitCode.Catalog),
  },
  {
    name: '--stream on an object-kind op exits 2 (usage)',
    run: () =>
      expectExit(
        ['call', 'console_app.describe', '--input', '{"app_id":"x"}', '--stream'],
        ExitCode.Usage,
      ),
  },
  {
    name: 'call missing a required input exits 2 (usage)',
    run: () => expectExit(['call', 'console_app.describe', '--input', '{}'], ExitCode.Usage),
  },
]

let failed = 0
for (const c of checks) {
  try {
    c.run()
    console.log(`[x] ${c.name}`)
  } catch (err) {
    failed++
    console.log(`[ ] ${c.name} — ${(err as Error).message}`)
  }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
process.exit(failed > 0 ? 1 : 0)
