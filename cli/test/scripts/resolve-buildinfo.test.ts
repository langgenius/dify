import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vite-plus/test'
import { BUILD_CHANNELS, resolveBuildInfo } from '../../scripts/lib/resolve-buildinfo.js'
import { ENV_CACHE_DIR, ENV_CONFIG_DIR } from '../../src/store/dir.js'

const CLI_ROOT = new URL('../../', import.meta.url)
const RELEASE_NAMING = fileURLToPath(new URL('scripts/release-naming.mjs', CLI_ROOT))
const VERSION_INFO_SRC = fileURLToPath(new URL('src/version/info.ts', CLI_ROOT))
const DEV_ENTRY = fileURLToPath(new URL('bin/dev.js', CLI_ROOT))

const FIXED_DATE = new Date('2026-05-09T12:00:00.000Z')
const fixedNow = () => FIXED_DATE
const noGit = () => null
// Stub the package.json reader so tests exercise the "no sources" path
// without coupling to the live cli/package.json#difyctl.compat values.
const noPkg = () => ({})

describe('resolveBuildInfo', () => {
  it('uses env values when fully populated', () => {
    const info = resolveBuildInfo({
      env: {
        DIFYCTL_VERSION: '1.2.3',
        DIFYCTL_COMMIT: 'abcdef0123456789',
        DIFYCTL_BUILD_DATE: '2026-01-01T00:00:00.000Z',
        DIFYCTL_CHANNEL: 'stable',
      },
      git: () => 'should-not-be-called',
      now: fixedNow,
      pkg: noPkg,
    })
    expect(info).toStrictEqual({
      version: '1.2.3',
      commit: 'abcdef0123456789',
      buildDate: '2026-01-01T00:00:00.000Z',
      channel: 'stable',
      minDify: '0.0.0',
      maxDify: '0.0.0',
    })
  })

  it('falls back to git probes when env unset', () => {
    const calls: string[] = []
    const git = (cmd: string) => {
      calls.push(cmd)
      if (cmd.startsWith('git describe')) return 'v1.0.0-5-gabc1234-dirty'
      if (cmd.startsWith('git rev-parse')) return '1234567890abcdef'
      return null
    }
    const info = resolveBuildInfo({ env: {}, git, now: fixedNow, pkg: noPkg })
    expect(info).toStrictEqual({
      version: 'v1.0.0-5-gabc1234-dirty',
      commit: '1234567890abcdef',
      buildDate: '2026-05-09T12:00:00.000Z',
      channel: 'dev',
      minDify: '0.0.0',
      maxDify: '0.0.0',
    })
    expect(calls).toStrictEqual(['git describe --tags --dirty --always', 'git rev-parse HEAD'])
  })

  it('uses string defaults when env unset, git unavailable, and package.json empty', () => {
    const info = resolveBuildInfo({ env: {}, git: noGit, now: fixedNow, pkg: noPkg })
    expect(info).toStrictEqual({
      version: '0.0.0-dev',
      commit: 'none',
      buildDate: '2026-05-09T12:00:00.000Z',
      channel: 'dev',
      minDify: '0.0.0',
      maxDify: '0.0.0',
    })
  })

  it('throws on invalid channel', () => {
    expect(() =>
      resolveBuildInfo({ env: { DIFYCTL_CHANNEL: 'beta' }, git: noGit, now: fixedNow, pkg: noPkg }),
    ).toThrow(/invalid DIFYCTL_CHANNEL: beta/)
  })

  it('throws on removed nightly channel', () => {
    expect(() =>
      resolveBuildInfo({
        env: { DIFYCTL_CHANNEL: 'nightly' },
        git: noGit,
        now: fixedNow,
        pkg: noPkg,
      }),
    ).toThrow(/invalid DIFYCTL_CHANNEL: nightly/)
  })

  it('accepts alpha channel', () => {
    const info = resolveBuildInfo({
      env: { DIFYCTL_CHANNEL: 'alpha' },
      git: noGit,
      now: fixedNow,
      pkg: noPkg,
    })
    expect(info.channel).toBe('alpha')
  })

  it('accepts rc channel', () => {
    const info = resolveBuildInfo({
      env: {
        DIFYCTL_VERSION: '0.1.0-rc.1',
        DIFYCTL_CHANNEL: 'rc',
        DIFYCTL_COMMIT: 'abc',
        DIFYCTL_BUILD_DATE: '2026-01-01T00:00:00.000Z',
      },
      git: noGit,
      now: fixedNow,
      pkg: noPkg,
    })
    expect(info.channel).toBe('rc')
  })

  it('mixes env and git fallbacks per field', () => {
    const git = (cmd: string) => (cmd.startsWith('git describe') ? 'v9.9.9' : null)
    const info = resolveBuildInfo({
      env: { DIFYCTL_COMMIT: 'pinned-sha' },
      git,
      now: fixedNow,
      pkg: noPkg,
    })
    expect(info.version).toBe('v9.9.9')
    expect(info.commit).toBe('pinned-sha')
    expect(info.channel).toBe('dev')
  })

  it('reads minDify and maxDify from env', () => {
    const info = resolveBuildInfo({
      env: {
        DIFYCTL_VERSION: '0.1.0-rc.1',
        DIFYCTL_CHANNEL: 'rc',
        DIFYCTL_COMMIT: 'abc',
        DIFYCTL_BUILD_DATE: '2026-01-01T00:00:00.000Z',
        DIFYCTL_MIN_DIFY: '1.6.0',
        DIFYCTL_MAX_DIFY: '1.7.0',
      },
      git: noGit,
      now: fixedNow,
      pkg: noPkg,
    })
    expect(info.minDify).toBe('1.6.0')
    expect(info.maxDify).toBe('1.7.0')
  })

  it('defaults minDify and maxDify to 0.0.0 when env and package.json are unset', () => {
    const info = resolveBuildInfo({ env: {}, git: noGit, now: fixedNow, pkg: noPkg })
    expect(info.minDify).toBe('0.0.0')
    expect(info.maxDify).toBe('0.0.0')
  })

  it('falls back to package.json#difyctl.compat when env unset', () => {
    const pkg = () => ({
      difyctl: { compat: { minDify: '1.6.0', maxDify: '1.7.0' }, channel: 'rc' },
    })
    const info = resolveBuildInfo({ env: {}, git: noGit, now: fixedNow, pkg })
    expect(info.minDify).toBe('1.6.0')
    expect(info.maxDify).toBe('1.7.0')
    expect(info.channel).toBe('rc')
  })

  it('env wins over package.json for compat range and channel', () => {
    const pkg = () => ({
      difyctl: { compat: { minDify: '1.6.0', maxDify: '1.7.0' }, channel: 'rc' },
    })
    const info = resolveBuildInfo({
      env: {
        DIFYCTL_MIN_DIFY: '2.0.0',
        DIFYCTL_MAX_DIFY: '2.1.0',
        DIFYCTL_CHANNEL: 'stable',
      },
      git: noGit,
      now: fixedNow,
      pkg,
    })
    expect(info.minDify).toBe('2.0.0')
    expect(info.maxDify).toBe('2.1.0')
    expect(info.channel).toBe('stable')
  })
})

// `export type Channel = 'a' | 'b'`, single line or with `|`-led continuations.
const CHANNEL_UNION_RE = /export type Channel\s*=\s*([^\n]*(?:\n[ \t]*\|[^\n]*)*)/
const QUOTED_MEMBER_RE = /'([^']+)'/g

function channelUnionMembers(): string[] {
  const declaration = CHANNEL_UNION_RE.exec(readFileSync(VERSION_INFO_SRC, 'utf8'))?.[1]
  if (declaration === undefined)
    throw new Error(`no "export type Channel" declaration found in ${VERSION_INFO_SRC}`)
  const members = [...declaration.matchAll(QUOTED_MEMBER_RE)].map(([, name]) => name ?? '')
  if (members.length === 0)
    throw new Error(`parsed no members out of the Channel union in ${VERSION_INFO_SRC}`)
  return members
}

// Spawned rather than imported: release-naming.mjs carries a shebang that breaks
// the Windows test runner.
function releaseNamingChannels(): string[] {
  return execFileSync('node', [RELEASE_NAMING, 'channels'], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

const sorted = (names: readonly string[]) => [...names].sort()

// Three hand-maintained channel lists in three runtimes that cannot share an
// import — a bare string array here, a compile-time union in src/version/info.ts,
// and objects carrying release data in release-naming.mjs.
//
// The asymmetry is deliberate, not an oversight to paper over: `dev` is a local
// build channel that is never released, so it belongs in the two build-side
// lists and must stay out of release-naming.mjs's CHANNELS.
describe('channel list parity', () => {
  const LOCAL_ONLY_CHANNEL = 'dev'

  it('BUILD_CHANNELS matches the Channel union in src/version/info.ts exactly', () => {
    expect(sorted(channelUnionMembers())).toStrictEqual(sorted(BUILD_CHANNELS))
  })

  it('released channels are the build channels minus the local-only one', () => {
    expect(sorted(releaseNamingChannels())).toStrictEqual(
      sorted(BUILD_CHANNELS.filter((name) => name !== LOCAL_ONLY_CHANNEL)),
    )
  })

  it('keeps dev buildable but unreleasable', () => {
    expect(BUILD_CHANNELS).toContain(LOCAL_ONLY_CHANNEL)
    expect(releaseNamingChannels()).not.toContain(LOCAL_ONLY_CHANNEL)
  })
})

type ClientVersionReport = { client: { channel: string } }

// Spawning bun is safe in this suite: `pnpm test`'s pretest step already runs
// `bun scripts/generate-command-tree.ts`, so the suite cannot run without it.
// `version --client` skips the server probe, so this needs no network, and the
// temp config/cache dirs keep it off the developer's real difyctl state.
describe('bin/dev.js pins the local build channel', () => {
  const ENV_CHANNEL = 'DIFYCTL_CHANNEL'
  const stateDir = mkdtempSync(join(tmpdir(), 'difyctl-dev-channel-'))
  afterAll(() => rmSync(stateDir, { recursive: true, force: true }))

  function reportedChannel(channelOverride?: string): string {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      [ENV_CONFIG_DIR]: stateDir,
      [ENV_CACHE_DIR]: stateDir,
    }
    if (channelOverride === undefined) delete env[ENV_CHANNEL]
    else env[ENV_CHANNEL] = channelOverride
    const stdout = execFileSync('bun', [DEV_ENTRY, 'version', '--client', '--output', 'json'], {
      cwd: fileURLToPath(CLI_ROOT),
      encoding: 'utf8',
      env,
    })
    return (JSON.parse(stdout) as ClientVersionReport).client.channel
  }

  // The `?? 'dev'` fallback in resolveBuildInfo was dead code before this pin —
  // the manifest channel always won. With the manifest now reading `stable`, an
  // unpinned local build would self-report `stable` and drop its prerelease
  // banner, claiming a release it is not.
  it('reports dev when the env does not set a channel', { timeout: 30_000 }, () => {
    expect(reportedChannel()).toBe('dev')
  })

  it('still lets the env override the pin', { timeout: 30_000 }, () => {
    expect(reportedChannel('stable')).toBe('stable')
  })
})
