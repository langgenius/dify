#!/usr/bin/env -S bun
import { execSync } from 'node:child_process'

type Check = { name: string, run: () => void }

const baseUrlIdx = process.argv.indexOf('--base-url')
const baseUrl = baseUrlIdx > -1 ? process.argv[baseUrlIdx + 1] : 'http://localhost:5001'
if (!baseUrl) {
  console.error('usage: run-smoke.ts --base-url <url>')
  process.exit(2)
}

const env = { ...process.env, DIFY_BASE_URL: baseUrl }

function cli(args: string): string {
  return execSync(`bun bin/dev.js ${args}`, { env, encoding: 'utf8' })
}

const checks: Check[] = [
  { name: 'config show', run: () => { cli('config show') } },
  { name: 'get workspace', run: () => {
    if (!cli('get workspace').includes('id'))
      throw new Error('no workspace listed')
  } },
  { name: 'get apps', run: () => { cli('get apps') } },
  { name: 'difyctl version prints compat', run: () => {
    if (!cli('version').includes('compat:'))
      throw new Error('no compat line')
  } },
]

let failed = 0
for (const c of checks) {
  try {
    c.run()
    console.log(`[x] ${c.name}`)
  }
  catch (err) {
    failed++
    console.log(`[ ] ${c.name} — ${(err as Error).message}`)
  }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
process.exit(failed > 0 ? 1 : 0)
