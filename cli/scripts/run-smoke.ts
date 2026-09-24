#!/usr/bin/env -S bun
// scripts/run-smoke.ts — five checks against a running Dify server (or mock),
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
    name: 'help get.console_app carries .input.properties.workspace_id',
    run: () => {
      const body = JSON.parse(cli(['help', 'get.console_app', '--json']))
      if (body.input?.properties?.workspace_id === undefined)
        throw new Error('no .input.properties.workspace_id')
    },
  },
  {
    name: 'get console_app returns .data',
    run: () => {
      const body = JSON.parse(cli(['get', 'console_app', '--input', '{"limit":1}']))
      if (body.data === undefined) throw new Error('no .data')
    },
  },
  {
    name: '--stream on an object-kind op exits 2 (usage)',
    run: () =>
      expectExit(
        ['describe', 'console_app', '--input', '{"app_id":"x"}', '--stream'],
        ExitCode.Usage,
      ),
  },
  {
    name: 'a missing required input exits 2 (usage)',
    run: () => expectExit(['describe', 'console_app', '--input', '{}'], ExitCode.Usage),
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
