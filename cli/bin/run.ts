#!/usr/bin/env node
// Production entry compiled by `bun build --compile` (see scripts/release-build.sh).
// Imports from src/ so the release pipeline doesn't need `pnpm build` (dist/).
import { commandTree } from '../src/commands/tree.js'
import { run } from '../src/framework/run.js'

// Wrapped instead of top-level await — `bun build --bytecode` doesn't support TLA.
void (async () => {
  await run(commandTree, process.argv.slice(2))
})()
