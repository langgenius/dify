#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const builtEntry = path.join(packageRoot, 'dist', 'cli.mjs')
const sourceEntry = path.join(packageRoot, 'src', 'cli.ts')
const entryArgs = fs.existsSync(builtEntry)
  ? [builtEntry]
  : [sourceEntry]

const result = spawnSync(
  process.execPath,
  [...entryArgs, ...process.argv.slice(2)],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  },
)

if (result.error)
  throw result.error

process.exit(result.status ?? 1)
