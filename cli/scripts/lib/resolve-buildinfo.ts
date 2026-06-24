import type { ExecSyncOptions } from 'node:child_process'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUILD_CHANNELS = ['dev', 'alpha', 'rc', 'edge', 'stable'] as const
export type BuildChannel = (typeof BUILD_CHANNELS)[number]

export type BuildInfo = {
  version: string
  commit: string
  buildDate: string
  channel: BuildChannel
  minDify: string
  maxDify: string
}

export type Env = Record<string, string | undefined>

export type GitProbe = (cmd: string) => string | null

const GIT_PROBE_OPTS: ExecSyncOptions = {
  stdio: ['ignore', 'pipe', 'ignore'],
}

export const defaultGitProbe: GitProbe = (cmd) => {
  try {
    return execSync(cmd, GIT_PROBE_OPTS).toString().trim() || null
  }
  catch {
    return null
  }
}

type PackageManifest = {
  difyctl?: {
    channel?: string
    compat?: { minDify?: string, maxDify?: string }
  }
}

export type PackageReader = () => PackageManifest

// Default reader resolves cli/package.json relative to this file so the same
// helper works whether invoked from vite.config.ts, bin/dev.js, or release.sh.
const defaultPackageReader: PackageReader = () => {
  try {
    const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json')
    return JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageManifest
  }
  catch {
    return {}
  }
}

export type ResolveOptions = {
  env?: Env
  git?: GitProbe
  now?: () => Date
  pkg?: PackageReader
}

export function resolveBuildInfo(opts: ResolveOptions = {}): BuildInfo {
  const env = opts.env ?? process.env
  const git = opts.git ?? defaultGitProbe
  const now = opts.now ?? (() => new Date())
  const pkg = (opts.pkg ?? defaultPackageReader)()

  const channel = env.DIFYCTL_CHANNEL ?? pkg.difyctl?.channel ?? 'dev'
  if (!(BUILD_CHANNELS as readonly string[]).includes(channel)) {
    throw new Error(
      `invalid DIFYCTL_CHANNEL: ${channel} (expected ${BUILD_CHANNELS.join(' | ')})`,
    )
  }

  const version
    = env.DIFYCTL_VERSION
      ?? git('git describe --tags --dirty --always')
      ?? '0.0.0-dev'

  const commit
    = env.DIFYCTL_COMMIT
      ?? git('git rev-parse HEAD')
      ?? 'none'

  const buildDate = env.DIFYCTL_BUILD_DATE ?? now().toISOString()
  const minDify = env.DIFYCTL_MIN_DIFY ?? pkg.difyctl?.compat?.minDify ?? '0.0.0'
  const maxDify = env.DIFYCTL_MAX_DIFY ?? pkg.difyctl?.compat?.maxDify ?? '0.0.0'

  return { version, commit, buildDate, channel: channel as BuildChannel, minDify, maxDify }
}
