import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
/* oxlint-disable no-template-curly-in-string -- shell parameter expansions, not JS template literals */
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
/* oxlint-enable no-template-curly-in-string */

function runLib(
  program: string,
  env: Record<string, string> = {},
): { code: number; stdout: string; stderr: string } {
  const full = `. "${SCRIPT}"\n${FETCH_STUB}\n${program}`
  const r = spawnSync('sh', ['-c', full], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DIFYCTL_INSTALL_LIB: '1',
      DIFY_VERSION: '',
      DIFYCTL_VERSION: '',
      ...env,
    },
  })
  return { code: r.status ?? 1, stdout: (r.stdout ?? '').trim(), stderr: r.stderr ?? '' }
}

// Like runLib but with a caller-supplied fetch_json stub, so we can drive the
// real rate_limit_hint / maybe_ratelimit_exit / fetch_hit_ratelimit (which the
// script defines) by writing a classified reason to FETCH_ERR_FILE.
function runLibStub(
  stub: string,
  program: string,
  env: Record<string, string> = {},
): { code: number; stderr: string } {
  const full = `. "${SCRIPT}"\n${stub}\n${program}`
  const r = spawnSync('sh', ['-c', full], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DIFYCTL_INSTALL_LIB: '1',
      DIFY_VERSION: '',
      DIFYCTL_VERSION: '',
      ...env,
    },
  })
  return { code: r.status ?? 1, stderr: r.stderr ?? '' }
}

// A fetch_json that always fails with the given classification, mimicking the
// real one writing to FETCH_ERR_FILE from inside a command-substitution subshell.
function failStub(reason: string): string {
  return `fetch_json() { printf '%s' '${reason}' > "$FETCH_ERR_FILE"; return 1; }`
}

const REL_1142 = JSON.stringify({
  tag_name: '1.14.2',
  assets: [{ name: 'difyctl-v0.2.0-linux-x64' }, { name: 'difyctl-v0.2.0-checksums.txt' }],
})
const REL_1150 = JSON.stringify({
  tag_name: '1.15.0',
  assets: [{ name: 'difyctl-v0.3.0-linux-x64' }],
})
const LIST_NEWEST_FIRST = JSON.stringify({
  releases: [{ tag_name: '1.15.0' }, { tag_name: '1.14.2' }],
})

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
    const r = runLib('resolve_release linux-x64; printf "%s" "$DIFY_TAG"', {
      DIFY_VERSION: '1.14.2',
      TAG_1_14_2: REL_1142,
    })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('1.14.2')
  })

  it('DIFY_VERSION that does not exist dies with a clear message', () => {
    const r = runLib('resolve_release linux-x64', { DIFY_VERSION: '9.9.9' })
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('Dify release 9.9.9 not found')
  })

  it('blank resolves to the latest stable release', () => {
    const r = runLib('resolve_release linux-x64; printf "%s" "$DIFY_TAG"', {
      LATEST_JSON: REL_1150,
    })
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

describe('install-cli rate limit', () => {
  const futureReset = String(Math.floor(Date.now() / 1000) + 1800)

  it('latest: reports the rate limit with reset ETA and remediation, not a generic error', () => {
    const r = runLibStub(failStub(`ratelimit:${futureReset}`), 'resolve_release linux-x64')
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('rate limit exceeded')
    expect(r.stderr).toContain('resets in ~')
    expect(r.stderr).toContain('GITHUB_TOKEN')
    expect(r.stderr).not.toContain('failed to query latest')
  })

  it('DIFY_VERSION: rate limit wins over the misleading "not found" message', () => {
    const r = runLibStub(failStub(`ratelimit:${futureReset}`), 'resolve_release linux-x64', {
      DIFY_VERSION: '1.15.0',
    })
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('rate limit exceeded')
    expect(r.stderr).not.toContain('not found')
  })

  it('DIFYCTL_VERSION: rate limit surfaces from the nested subshell, not "not found"', () => {
    const r = runLibStub(failStub(`ratelimit:${futureReset}`), 'resolve_release linux-x64', {
      DIFYCTL_VERSION: '0.2.0',
    })
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('rate limit exceeded')
    expect(r.stderr).not.toContain('not found')
  })

  it('omits the ETA line when the reset epoch is missing', () => {
    const r = runLibStub(failStub('ratelimit:'), 'resolve_release linux-x64')
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('rate limit exceeded')
    expect(r.stderr).not.toContain('resets in ~')
  })

  it('a non-rate-limit HTTP error falls back to the generic message (no false hint)', () => {
    const r = runLibStub(failStub('http:500'), 'resolve_release linux-x64')
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('failed to query latest')
    expect(r.stderr).not.toContain('rate limit exceeded')
  })
})

// A stand-in for curl that honours the flags fetch_json passes (-D/-o/-w/-H) and
// fabricates a response per FAKE_MODE, so the tests exercise the REAL fetch_json
// (its curl invocation, header parsing, classification and token handling) rather
// than a stub. Header names it emits are lowercase, as HTTP/2 delivers them.
const FAKE_CURL = `#!/bin/sh
hdr=""; body=""
while [ $# -gt 0 ]; do
  case "$1" in
    -D) hdr="$2"; shift 2 ;;
    -o) body="$2"; shift 2 ;;
    -H) printf '%s\\n' "$2" >> "\${FAKE_HDR_LOG:-/dev/null}"; shift 2 ;;
    -w) shift 2 ;;
    *) shift ;;
  esac
done
case "\${FAKE_MODE:-ok}" in
  ok)
    [ -n "$hdr" ] && printf 'HTTP/2 200\\r\\n\\r\\n' > "$hdr"
    [ -n "$body" ] && printf '%s' "\${FAKE_BODY:-}" > "$body"
    printf '200' ;;
  ratelimit)
    [ -n "$hdr" ] && printf 'HTTP/2 403\\r\\nx-ratelimit-remaining: 0\\r\\nx-ratelimit-reset: %s\\r\\n\\r\\n' "\${FAKE_RESET:-9999999999}" > "$hdr"
    printf '403' ;;
  perm403)
    [ -n "$hdr" ] && printf 'HTTP/2 403\\r\\nx-ratelimit-remaining: 59\\r\\n\\r\\n' > "$hdr"
    printf '403' ;;
  notfound)
    [ -n "$hdr" ] && printf 'HTTP/2 404\\r\\n\\r\\n' > "$hdr"
    printf '404' ;;
  net) exit 6 ;;
esac
`

// Drive the real fetch_json with FAKE_CURL first on PATH. Returns "OK|<body>" or
// "FAIL|<FETCH_ERR_FILE contents>", plus any -H lines the fake curl received.
function runRealFetch(
  mode: string,
  env: Record<string, string> = {},
): { result: string; headers: string } {
  const dir = mkdtempSync(join(tmpdir(), 'difyctl-fakecurl-'))
  const hdrLog = join(dir, 'hdrlog')
  writeFileSync(join(dir, 'curl'), FAKE_CURL)
  chmodSync(join(dir, 'curl'), 0o755)
  const program =
    'if body=$(fetch_json "https://api.github.com/repos/x/releases/latest"); then printf \'OK|%s\' "$body"; else printf \'FAIL|%s\' "$(cat "$FETCH_ERR_FILE" 2>/dev/null)"; fi'
  const r = spawnSync('sh', ['-c', `. "${SCRIPT}"\n${program}`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      DIFYCTL_INSTALL_LIB: '1',
      DIFY_VERSION: '',
      DIFYCTL_VERSION: '',
      FAKE_MODE: mode,
      FAKE_HDR_LOG: hdrLog,
      ...env,
    },
  })
  let headers = ''
  try {
    headers = readFileSync(hdrLog, 'utf8')
  } catch {
    /* no headers logged */
  }
  rmSync(dir, { recursive: true, force: true })
  return { result: (r.stdout ?? '').trim(), headers }
}

describe('install-cli fetch_json (real, fake curl on PATH)', () => {
  it('returns the response body on 200', () => {
    expect(runRealFetch('ok', { FAKE_BODY: '{"tag_name":"1.15.0"}' }).result).toBe(
      'OK|{"tag_name":"1.15.0"}',
    )
  })

  it('classifies a 403 with x-ratelimit-remaining:0 as a rate limit and captures the reset', () => {
    expect(runRealFetch('ratelimit', { FAKE_RESET: '1893456000' }).result).toBe(
      'FAIL|ratelimit:1893456000',
    )
  })

  it('classifies a 403 with tokens left as a plain http error, not a rate limit', () => {
    expect(runRealFetch('perm403').result).toBe('FAIL|http:403')
  })

  it('classifies a 404 as an http error', () => {
    expect(runRealFetch('notfound').result).toBe('FAIL|http:404')
  })

  it('classifies a curl transport failure as a network error', () => {
    expect(runRealFetch('net').result).toBe('FAIL|network')
  })

  it('sends an Authorization bearer header when GITHUB_TOKEN is set', () => {
    expect(runRealFetch('ok', { FAKE_BODY: '{}', GITHUB_TOKEN: 'ghp_secret' }).headers).toContain(
      'Authorization: Bearer ghp_secret',
    )
  })

  it('falls back to GH_TOKEN when GITHUB_TOKEN is unset', () => {
    expect(
      runRealFetch('ok', { FAKE_BODY: '{}', GITHUB_TOKEN: '', GH_TOKEN: 'gho_fallback' }).headers,
    ).toContain('Authorization: Bearer gho_fallback')
  })

  it('sends no Authorization header when neither token is set', () => {
    expect(
      runRealFetch('ok', { FAKE_BODY: '{}', GITHUB_TOKEN: '', GH_TOKEN: '' }).headers,
    ).not.toContain('Authorization')
  })
})
