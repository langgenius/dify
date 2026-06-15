import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('./install-r2.ps1', import.meta.url))
const hasPwsh = spawnSync('pwsh', ['-v'], { encoding: 'utf8' }).status === 0
const d = hasPwsh ? describe : describe.skip

const MANIFEST = JSON.stringify({
  schema: 1,
  name: 'difyctl',
  channel: 'edge',
  version: '0.1.0-edge.2fd7b82',
  baseUrl: 'https://pub.example.r2.dev/difyctl/edge/0.1.0-edge.2fd7b82',
  targets: { 'windows-x64': { asset: 'difyctl-v0.1.0-edge.2fd7b82-windows-x64.exe', sha256: 'deadbeef' } },
})

function pwsh(program: string): { code: number, stdout: string, stderr: string } {
  const full = `. '${SCRIPT}'\n${program}`
  const r = spawnSync('pwsh', ['-NoProfile', '-Command', full], {
    encoding: 'utf8',
    env: { ...process.env, DIFYCTL_INSTALL_LIB: '1' },
  })
  return { code: r.status ?? 1, stdout: (r.stdout ?? '').replace(/\r\n/g, '\n').trim(), stderr: r.stderr ?? '' }
}

d('install-r2.ps1', () => {
  it('parses a target asset + sha from the manifest', () => {
    const prog = `$m = ConvertFrom-Json @'\n${MANIFEST}\n'@\n`
      + `Write-Output (Get-TargetField $m 'windows-x64' 'asset')\n`
      + `Write-Output (Get-TargetField $m 'windows-x64' 'sha256')`
    const { stdout } = pwsh(prog)
    expect(stdout).toBe('difyctl-v0.1.0-edge.2fd7b82-windows-x64.exe\ndeadbeef')
  })

  it('errors when DIFYCTL_R2_BASE is unset', () => {
    const r = spawnSync('pwsh', ['-NoProfile', '-File', SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, DIFYCTL_R2_BASE: '' },
    })
    if (hasPwsh) {
      expect(r.status).not.toBe(0)
      expect(r.stderr + r.stdout).toMatch(/DIFYCTL_R2_BASE/)
    }
  })
})
