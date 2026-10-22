import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'

const SCRIPT = fileURLToPath(new URL('./install-r2.ps1', import.meta.url))
const hasPwsh = spawnSync('pwsh', ['-v'], { encoding: 'utf8' }).status === 0
const d = hasPwsh ? describe : describe.skip

const MANIFEST = JSON.stringify({
  schema: 1,
  name: 'difyctl',
  channel: 'edge',
  version: '0.1.0-edge.2fd7b82',
  baseUrl: 'https://pub.example.r2.dev/difyctl/edge/0.1.0-edge.2fd7b82',
  targets: {
    'windows-x64': { asset: 'difyctl-v0.1.0-edge.2fd7b82-windows-x64.exe', sha256: 'deadbeef' },
  },
})

function pwsh(
  program: string,
  env: Record<string, string> = {},
): { code: number; stdout: string; stderr: string } {
  const full = `. '${SCRIPT}'\n${program}`
  const r = spawnSync('pwsh', ['-NoProfile', '-Command', full], {
    encoding: 'utf8',
    env: { ...process.env, DIFYCTL_INSTALL_LIB: '1', ...env },
  })
  return {
    code: r.status ?? 1,
    stdout: (r.stdout ?? '').replace(/\r\n/g, '\n').trim(),
    stderr: r.stderr ?? '',
  }
}

d('install-r2.ps1', () => {
  it('parses a target asset + sha from the manifest', () => {
    const prog =
      `$m = ConvertFrom-Json @'\n${MANIFEST}\n'@\n` +
      `Write-Output (Get-TargetField $m 'windows-x64' 'asset')\n` +
      `Write-Output (Get-TargetField $m 'windows-x64' 'sha256')`
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

d('install-r2.ps1 install location, PATH hint and download', () => {
  const where = (env: Record<string, string>) =>
    pwsh('Write-Output (Resolve-BinDir)', {
      DIFYCTL_PREFIX: '',
      DIFYCTL_INSTALL_DIR: '',
      LOCALAPPDATA: '/lad',
      ...env,
    }).stdout

  it('defaults to %LOCALAPPDATA%\\difyctl\\bin', () => {
    expect(where({})).toBe(join('/lad', 'difyctl', 'bin'))
  })

  it('accepts DIFYCTL_PREFIX like the GitHub installer', () => {
    expect(where({ DIFYCTL_PREFIX: '/opt/dify' })).toBe(join('/opt/dify', 'bin'))
  })

  it('keeps DIFYCTL_INSTALL_DIR as the bin folder itself, over DIFYCTL_PREFIX', () => {
    expect(where({ DIFYCTL_PREFIX: '/opt/dify', DIFYCTL_INSTALL_DIR: '/custom/bin' })).toBe(
      '/custom/bin',
    )
  })

  it('the PATH command adds to the user PATH, not the whole session PATH', () => {
    const hint = pwsh(`Write-Output (Get-PathHint 'C:\\dify\\bin')`).stdout
    expect(hint).toContain(
      `"C:\\dify\\bin;" + [Environment]::GetEnvironmentVariable('PATH', 'User')`,
    )
    expect(hint).not.toContain('$env:PATH')
  })

  it('stops before downloading when the checksum is missing', () => {
    const r = pwsh(
      "function Invoke-WebRequest { throw 'must not download' }\n" +
        "try { Install-DifyctlBinary 'https://x/difyctl.exe' '' '1.0.0' 'edge' '/tmp/none' } " +
        'catch { Write-Output $_.Exception.Message }',
    )
    expect(r.stdout).toMatch(/^no checksum published for https:\/\/x\/difyctl\.exe/)
  })

  it('downloads to a unique temp file, not one named after the asset', () => {
    const r = pwsh(
      'function Invoke-WebRequest { param($Uri, $OutFile) Write-Output "OUT=$OutFile"; Set-Content -Path $OutFile -Value x }\n' +
        "try { Install-DifyctlBinary 'https://x/difyctl.exe' 'deadbeef' '1.0.0' 'edge' '/tmp/none' } " +
        'catch { Write-Output $_.Exception.Message }',
    )
    expect(r.stdout).toMatch(/OUT=.*difyctl-[0-9a-f]{32}\.exe\n/)
    expect(r.stdout).toMatch(/checksum mismatch/)
  })
})

// A v2 binary answers `install skills --help`; a v1 one exits 1 with "unknown command".
// The fakes are shell scripts, so this runs where pwsh runs outside Windows.
describe.skipIf(!hasPwsh || process.platform === 'win32')('install-r2.ps1 Write-SkillHint', () => {
  const hint = (bin: string) => pwsh(`Write-SkillHint '${bin}'`)

  it('prints the hint for a binary that has install skills, and stays quiet otherwise', () => {
    const dir = mkdtempSync(join(tmpdir(), 'difyctl-hint-'))
    try {
      const v2 = join(dir, 'v2')
      const v1 = join(dir, 'v1')
      writeFileSync(v2, '#!/bin/sh\n[ "$*" = "install skills --help" ]\n', { mode: 0o755 })
      writeFileSync(v1, '#!/bin/sh\necho "unknown command: $*" >&2\nexit 1\n', { mode: 0o755 })
      expect(hint(v2)).toMatchObject({
        code: 0,
        stdout: expect.stringContaining('difyctl install skills <skills root>'),
      })
      expect(hint(v1)).toMatchObject({ code: 0, stdout: '' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not enter command discovery for a missing binary path', () => {
    const result = pwsh(`
      $script:missingLookups = 0
      $ExecutionContext.InvokeCommand.PreCommandLookupAction = {
        param($commandName, $eventArgs)
        if ($commandName -eq '/nonexistent/difyctl') { $script:missingLookups++ }
      }
      Write-SkillHint '/nonexistent/difyctl'
      Write-Output "lookups=$script:missingLookups"
    `)
    expect(result).toMatchObject({ code: 0, stdout: 'lookups=0' })
  })

  it('prints nothing when the binary cannot run', () => {
    expect(hint('/nonexistent/difyctl')).toMatchObject({ code: 0, stdout: '' })
  })
})
