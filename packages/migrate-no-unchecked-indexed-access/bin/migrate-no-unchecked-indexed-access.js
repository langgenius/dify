#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const entryFile = path.join(packageRoot, 'dist', 'cli.mjs')

if (!fs.existsSync(entryFile))
  throw new Error(`Built CLI entry not found at ${entryFile}. Run "pnpm --filter migrate-no-unchecked-indexed-access build" first.`)

const result = spawnSync(
  process.execPath,
  [entryFile, ...process.argv.slice(2)],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  },
)

if (result.error)
  throw result.error

process.exit(result.status ?? 1)
