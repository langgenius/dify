#!/usr/bin/env -S node --import tsx

globalThis.__DIFYCTL_VERSION__ = process.env.DIFYCTL_VERSION ?? '0.0.0-dev'
globalThis.__DIFYCTL_COMMIT__ = process.env.DIFYCTL_COMMIT ?? 'HEAD'
globalThis.__DIFYCTL_BUILD_DATE__ = process.env.DIFYCTL_BUILD_DATE ?? new Date().toISOString()
globalThis.__DIFYCTL_CHANNEL__ = process.env.DIFYCTL_CHANNEL ?? 'dev'
globalThis.__DIFYCTL_MIN_DIFY__ = process.env.DIFYCTL_MIN_DIFY ?? '0.0.0'
globalThis.__DIFYCTL_MAX_DIFY__ = process.env.DIFYCTL_MAX_DIFY ?? '0.0.0'

const { commandTree } = await import('../src/commands/tree.ts')
const { run } = await import('../src/framework/run.ts')

await run(commandTree, process.argv.slice(2))
