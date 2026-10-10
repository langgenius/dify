#!/usr/bin/env -S bun

import { resolveBuildInfo } from '../scripts/lib/resolve-buildinfo.ts'

const info = resolveBuildInfo({
  env: { ...process.env, DIFYCTL_CHANNEL: process.env.DIFYCTL_CHANNEL ?? 'dev' },
})
globalThis.__DIFYCTL_VERSION__ = info.version
globalThis.__DIFYCTL_COMMIT__ = info.commit
globalThis.__DIFYCTL_BUILD_DATE__ = info.buildDate
globalThis.__DIFYCTL_CHANNEL__ = info.channel

const { main } = await import('../src/main.ts')
process.exitCode = await main(process.argv.slice(2))
