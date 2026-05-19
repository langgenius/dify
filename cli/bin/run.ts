#!/usr/bin/env node
// Production entry compiled by `bun build --compile` (see scripts/release-build.sh).
// Imports from src/ so the release pipeline doesn't need `pnpm build` (dist/).
//
// bin/run.js is kept for the local `pnpm build` + node execute path; this file
// is only consumed by Bun.
import { commandTree } from '../src/commands/tree.js'
import { run } from '../src/framework/run.js'

await run(commandTree, process.argv.slice(2))
