#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const entryFile = path.join(packageRoot, 'src', 'cli.ts')
const tsxImport = await import.meta.resolve('tsx')

const result = spawnSync(
  process.execPath,
  ['--import', tsxImport, entryFile, ...process.argv.slice(2)],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  },
)

if (result.error)
  throw result.error

process.exit(result.status ?? 1)
