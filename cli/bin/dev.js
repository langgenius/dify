#!/usr/bin/env -S bun

import { resolveBuildInfo } from '../scripts/lib/resolve-buildinfo.ts'

const info = resolveBuildInfo()
globalThis.__DIFYCTL_VERSION__ = info.version
globalThis.__DIFYCTL_COMMIT__ = info.commit
globalThis.__DIFYCTL_BUILD_DATE__ = info.buildDate
globalThis.__DIFYCTL_CHANNEL__ = info.channel
globalThis.__DIFYCTL_MIN_DIFY__ = info.minDify
globalThis.__DIFYCTL_MAX_DIFY__ = info.maxDify

const { commandTree } = await import('../src/commands/tree.ts')
const { run } = await import('../src/framework/run.ts')

await run(commandTree, process.argv.slice(2))
