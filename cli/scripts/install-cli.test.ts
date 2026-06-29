import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('./install-cli.sh', import.meta.url))

function pickAsset(target: string, releaseJson: string): string {
  return execFileSync('sh', ['-c', `. "${SCRIPT}"; pick_asset "$1"`, 'sh', target], {
    input: releaseJson,
    encoding: 'utf8',
    env: { ...process.env, DIFYCTL_INSTALL_LIB: '1' },
  }).trim()
}

function assetVersion(name: string, target: string): string {
  return execFileSync('sh', ['-c', `. "${SCRIPT}"; asset_version "$1" "$2"`, 'sh', name, target], {
    encoding: 'utf8',
    env: { ...process.env, DIFYCTL_INSTALL_LIB: '1' },
  }).trim()
}

// Stubs the only network primitive (fetch_json) so resolution logic runs fully
// offline. Routes by URL; release bodies come from env (TAG_<tag-with-._->_>),
// the latest release from LATEST_JSON, the listing from LIST_JSON. A missing
// fixture returns 22 to mimic `curl -f` on a 4xx.
/* eslint-disable no-template-curly-in-string -- shell parameter expansions, not JS template literals */
const FETCH_STUB = [
  'fetch_json() {',
  '  case "$1" in',
  '    *"/releases/latest") [ -n "${LATEST_JSON:-}" ] || return 22; printf "%s" "$LATEST_JSON" ;;',
  '    *"/releases?per_page=100") [ -n "${LIST_JSON:-}" ] || return 22; printf "%s" "$LIST_JSON" ;;',
  '    *"/releases/tags/"*)',
  '      _t=${1##*/releases/tags/};',
  '      _k=$(printf "TAG_%s" "$_t" | tr ".-" "__");',
  '      eval "_v=\\${$_k:-}";',
  '      [ -n "$_v" ] || return 22;',
  '      printf "%s" "$_v" ;;',
  '    *) return 22 ;;',
  '  esac',
  '}',
].join('\n')
/* eslint-enable no-template-curly-in-string */

function runLib(program: string, env: Record<string, string> = {}): { code: number, stdout: string, stderr: string } {
  const full = `. "${SCRIPT}"\n${FETCH_STUB}\n${program}`
  const r = spawnSync('sh', ['-c', full], {
    encoding: 'utf8',
    env: { ...process.env, DIFYCTL_INSTALL_LIB: '1', DIFY_VERSION: '', DIFYCTL_VERSION: '', ...env },
  })
  return { code: r.status ?? 1, stdout: (r.stdout ?? '').trim(), stderr: r.stderr ?? '' }
}

const REL_1142 = JSON.stringify({ tag_name: '1.14.2', assets: [{ name: 'difyctl-v0.2.0-linux-x64' }, { name: 'difyctl-v0.2.0-checksums.txt' }] })
const REL_1150 = JSON.stringify({ tag_name: '1.15.0', assets: [{ name: 'difyctl-v0.3.0-linux-x64' }] })
const LIST_NEWEST_FIRST = JSON.stringify({ releases: [{ tag_name: '1.15.0' }, { tag_name: '1.14.2' }] })

const RELEASE = JSON.stringify({
  tag_name: '1.14.2',
  name: 'Dify 1.14.2',
  assets: [
    { name: 'difyctl-v0.1.0-rc.1-linux-x64' },
    { name: 'difyctl-v0.2.0-linux-x64' },
    { name: 'difyctl-v0.2.0-linux-arm64' },
    { name: 'difyctl-v0.2.0-darwin-arm64' },
    { name: 'difyctl-v0.2.0-windows-x64.exe' },
    { name: 'difyctl-v0.2.0-checksums.txt' },
    { name: 'some-other-asset.zip' },
  ],
})

describe('install-cli pick_asset', () => {
  it('picks the highest difyctl version for a linux target', () => {
    expect(pickAsset('linux-x64', RELEASE)).toBe('difyctl-v0.2.0-linux-x64')
  })

  it('matches the windows .exe asset', () => {
    expect(pickAsset('windows-x64', RELEASE)).toBe('difyctl-v0.2.0-windows-x64.exe')
  })

  it('matches an arm64 target exactly (no x64 bleed-through)', () => {
    expect(pickAsset('darwin-arm64', RELEASE)).toBe('difyctl-v0.2.0-darwin-arm64')
  })

  it('excludes the checksums asset', () => {
    expect(pickAsset('linux-x64', RELEASE)).not.toContain('checksums')
  })

  it('yields empty when no asset matches the target', () => {
    expect(pickAsset('darwin-x64', RELEASE)).toBe('')
  })

  it('picks the highest semver when several difyctl versions are present', () => {
    const many = JSON.stringify({
      assets: [
        { name: 'difyctl-v0.2.0-linux-x64' },
        { name: 'difyctl-v0.10.0-linux-x64' },
        { name: 'difyctl-v0.9.0-linux-x64' },
      ],
    })
    expect(pickAsset('linux-x64', many)).toBe('difyctl-v0.10.0-linux-x64')
  })
})

describe('install-cli asset_version', () => {
  it('extracts the version from a posix asset name', () => {
    expect(assetVersion('difyctl-v0.2.0-linux-x64', 'linux-x64')).toBe('0.2.0')
  })

  it('extracts the version from a windows .exe asset name', () => {
    expect(assetVersion('difyctl-v0.2.0-windows-x64.exe', 'windows-x64')).toBe('0.2.0')
  })

  it('extracts a prerelease version', () => {
    expect(assetVersion('difyctl-v0.1.0-rc.1-linux-x64', 'linux-x64')).toBe('0.1.0-rc.1')
  })
})

describe('install-cli resolve_release', () => {
  it('DIFY_VERSION pins the release directly', () => {
    const r = runLib('resolve_release linux-x64; printf "%s" "$DIFY_TAG"', { DIFY_VERSION: '1.14.2', TAG_1_14_2: REL_1142 })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('1.14.2')
  })

  it('DIFY_VERSION that does not exist dies with a clear message', () => {
    const r = runLib('resolve_release linux-x64', { DIFY_VERSION: '9.9.9' })
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('Dify release 9.9.9 not found')
  })

  it('blank resolves to the latest stable release', () => {
    const r = runLib('resolve_release linux-x64; printf "%s" "$DIFY_TAG"', { LATEST_JSON: REL_1150 })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('1.15.0')
  })

  it('blank dies when the latest query fails (no silent fallback)', () => {
    const r = runLib('resolve_release linux-x64')
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('failed to query latest Dify release')
  })

  it('DIFYCTL_VERSION resolves to the release hosting that build', () => {
    const r = runLib('resolve_release linux-x64; printf "%s" "$DIFY_TAG"', {
      DIFYCTL_VERSION: '0.2.0',
      LIST_JSON: LIST_NEWEST_FIRST,
      TAG_1_15_0: REL_1150,
      TAG_1_14_2: REL_1142,
    })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('1.14.2')
  })

  it('DIFYCTL_VERSION not hosted anywhere dies', () => {
    const r = runLib('resolve_release linux-x64', {
      DIFYCTL_VERSION: '9.9.9',
      LIST_JSON: LIST_NEWEST_FIRST,
      TAG_1_15_0: REL_1150,
      TAG_1_14_2: REL_1142,
    })
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('difyctl 9.9.9 not found on any Dify release')
  })
})

describe('install-cli find_release_for_difyctl', () => {
  it('returns the newest release whose assets host the wanted build', () => {
    const r = runLib('find_release_for_difyctl 0.2.0 linux-x64', {
      LIST_JSON: LIST_NEWEST_FIRST,
      TAG_1_15_0: REL_1150,
      TAG_1_14_2: REL_1142,
    })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('1.14.2')
  })

  it('dies (not false-negative) when the releases listing fails', () => {
    const r = runLib('find_release_for_difyctl 0.2.0 linux-x64')
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('failed to query')
  })

  it('warns and skips a release whose fetch fails, then finds it later', () => {
    const r = runLib('find_release_for_difyctl 0.2.0 linux-x64', {
      LIST_JSON: LIST_NEWEST_FIRST,
      TAG_1_14_2: REL_1142,
    })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('1.14.2')
    expect(r.stderr).toContain('fetch failed for 1.15.0')
  })
})
