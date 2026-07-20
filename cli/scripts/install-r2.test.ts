import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('./install-r2.sh', import.meta.url))

const MANIFEST = [
  '{',
  '  "schema": 1,',
  '  "name": "difyctl",',
  '  "channel": "edge",',
  '  "version": "0.1.0-edge.2fd7b82",',
  '  "commit": "abc1234",',
  '  "buildDate": "2026-06-14T12:00:00Z",',
  '  "compat": {"minDify":"1.14.0","maxDify":"1.15.0"},',
  '  "baseUrl": "https://pub.example.r2.dev/difyctl/edge/0.1.0-edge.2fd7b82",',
  '  "targets": {',
  '    "linux-x64": { "asset": "difyctl-v0.1.0-edge.2fd7b82-linux-x64", "sha256": "deadbeef" },',
  '    "darwin-arm64": { "asset": "difyctl-v0.1.0-edge.2fd7b82-darwin-arm64", "sha256": "cafef00d" }',
  '  }',
  '}',
].join('\n')

const INDEX = [
  '{',
  '  "schema": 1,',
  '  "channel": "edge",',
  '  "updated": "2026-06-15T00:00:00Z",',
  '  "builds": [',
  '    {',
  '      "version": "0.1.0-edge.ce4af868",',
  '      "commit": "ce4af868d653f405070fabb3be3303430cc030ad",',
  '      "buildDate": "2026-06-15T00:00:00Z",',
  '      "dir": "0.1.0-edge.ce4af868"',
  '    },',
  '    {',
  '      "version": "0.1.0-edge.aaaa111",',
  '      "commit": "aaaa111bbbbcccc000011112222333344445555",',
  '      "buildDate": "2026-06-14T00:00:00Z",',
  '      "dir": "0.1.0-edge.aaaa111"',
  '    }',
  '  ]',
  '}',
].join('\n')

const CHECKSUMS = [
  'deadbeef  difyctl-v0.1.0-edge.ce4af868-linux-x64',
  'cafef00d  difyctl-v0.1.0-edge.ce4af868-darwin-arm64',
  'beadc0de  difyctl-v0.1.0-edge.ce4af868-windows-x64.exe',
].join('\n')

function lib(
  program: string,
  env: Record<string, string> = {},
): { code: number; stdout: string; stderr: string } {
  const full = `. "${SCRIPT}"\n${program}`
  const r = spawnSync('sh', ['-c', full], {
    encoding: 'utf8',
    env: { ...process.env, DIFYCTL_INSTALL_LIB: '1', ...env },
  })
  return { code: r.status ?? 1, stdout: (r.stdout ?? '').trim(), stderr: r.stderr ?? '' }
}

describe('install-r2 manifest parsing', () => {
  // install-r2.sh is POSIX-only; under git-bash on Windows `uname -s` is MINGW*,
  // so detect_target intentionally dies (Windows installs go through install-r2.ps1).
  it.skipIf(process.platform === 'win32')('detect_target maps to one of the 5 ids', () => {
    const { stdout } = lib('detect_target')
    expect(['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'windows-x64']).toContain(
      stdout,
    )
  })

  it('manifest_str reads a top-level string field', () => {
    const { stdout } = lib(
      `printf '%s' '${MANIFEST}' > "$tmp_m"; manifest_str "$tmp_m" channel`,
      {},
    )
    expect(stdout).toBe('edge')
  })

  it('manifest_target_field extracts per-target values from a single line', () => {
    const prog =
      `printf '%s' '${MANIFEST}' > "$tmp_m"\n` +
      'manifest_target_field "$tmp_m" darwin-arm64 asset\n' +
      'manifest_target_field "$tmp_m" darwin-arm64 sha256'
    const { stdout } = lib(prog)
    expect(stdout).toBe('difyctl-v0.1.0-edge.2fd7b82-darwin-arm64\ncafef00d')
  })

  it('requires DIFYCTL_R2_BASE when run as the installer (not lib)', () => {
    const r = spawnSync('sh', [SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, DIFYCTL_R2_BASE: '' },
    })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/DIFYCTL_R2_BASE/)
  })

  it('sha256_check aborts on a checksum mismatch', () => {
    const r = lib('f="$(mktemp)"; printf \'hello\' > "$f"; sha256_check "$f" deadbeef')
    expect(r.code).not.toBe(0)
    expect(r.stderr).toMatch(/checksum mismatch/)
  })

  it('sha256_check passes on the correct hash', () => {
    // sha256('hello') = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    const r = lib(
      'f="$(mktemp)"; printf \'hello\' > "$f"; sha256_check "$f" 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824 && echo OK',
    )
    expect(r.stdout).toBe('OK')
  })
})

describe('install-r2 version/commit pin', () => {
  it('index_resolve matches a build by exact version', () => {
    const r = lib(
      `printf '%s' '${INDEX}' > "$tmp_m"; index_resolve "$tmp_m" version 0.1.0-edge.aaaa111`,
    )
    expect(r.stdout).toBe('0.1.0-edge.aaaa111\t0.1.0-edge.aaaa111')
  })

  it('index_resolve matches a build by commit prefix', () => {
    const r = lib(`printf '%s' '${INDEX}' > "$tmp_m"; index_resolve "$tmp_m" commit ce4af868`)
    expect(r.stdout).toBe('0.1.0-edge.ce4af868\t0.1.0-edge.ce4af868')
  })

  it('index_resolve matches the full 40-char commit too', () => {
    const r = lib(
      `printf '%s' '${INDEX}' > "$tmp_m"; index_resolve "$tmp_m" commit aaaa111bbbbcccc000011112222333344445555`,
    )
    expect(r.stdout).toBe('0.1.0-edge.aaaa111\t0.1.0-edge.aaaa111')
  })

  it('index_resolve prints nothing when no build matches', () => {
    const r = lib(`printf '%s' '${INDEX}' > "$tmp_m"; index_resolve "$tmp_m" commit ffffff`)
    expect(r.stdout).toBe('')
  })

  it('checksums_target extracts sha and asset for a posix target', () => {
    const r = lib(`printf '%s' '${CHECKSUMS}' > "$tmp_m"; checksums_target "$tmp_m" darwin-arm64`)
    expect(r.stdout).toBe('cafef00d\tdifyctl-v0.1.0-edge.ce4af868-darwin-arm64')
  })

  it('checksums_target does not bleed x64 into arm64', () => {
    const r = lib(`printf '%s' '${CHECKSUMS}' > "$tmp_m"; checksums_target "$tmp_m" linux-x64`)
    expect(r.stdout).toBe('deadbeef\tdifyctl-v0.1.0-edge.ce4af868-linux-x64')
  })
})
