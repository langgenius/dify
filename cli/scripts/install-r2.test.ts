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

function lib(program: string, env: Record<string, string> = {}): { code: number, stdout: string, stderr: string } {
  const full = `. "${SCRIPT}"\n${program}`
  const r = spawnSync('sh', ['-c', full], {
    encoding: 'utf8',
    env: { ...process.env, DIFYCTL_INSTALL_LIB: '1', ...env },
  })
  return { code: r.status ?? 1, stdout: (r.stdout ?? '').trim(), stderr: r.stderr ?? '' }
}

describe('install-r2 manifest parsing', () => {
  it('detect_target maps to one of the 5 ids', () => {
    const { stdout } = lib('detect_target')
    expect(['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'windows-x64']).toContain(stdout)
  })

  it('manifest_str reads a top-level string field', () => {
    const { stdout } = lib(`printf '%s' '${MANIFEST}' > "$tmp_m"; manifest_str "$tmp_m" channel`, {})
    expect(stdout).toBe('edge')
  })

  it('manifest_target_field extracts per-target values from a single line', () => {
    const prog = `printf '%s' '${MANIFEST}' > "$tmp_m"\n`
      + 'manifest_target_field "$tmp_m" darwin-arm64 asset\n'
      + 'manifest_target_field "$tmp_m" darwin-arm64 sha256'
    const { stdout } = lib(prog)
    expect(stdout).toBe('difyctl-v0.1.0-edge.2fd7b82-darwin-arm64\ncafef00d')
  })

  it('requires DIFYCTL_R2_BASE when run as the installer (not lib)', () => {
    const r = spawnSync('sh', [SCRIPT], { encoding: 'utf8', env: { ...process.env, DIFYCTL_R2_BASE: '' } })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/DIFYCTL_R2_BASE/)
  })
})
