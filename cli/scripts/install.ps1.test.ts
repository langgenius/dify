import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('./install.ps1', import.meta.url))

function hasPwsh(): boolean {
  const r = spawnSync(
    'pwsh',
    ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'],
    {
      encoding: 'utf8',
    },
  )
  return r.status === 0
}

const PWSH = hasPwsh()

const STUB = [
  'function Invoke-RestMethod {',
  '    param([string]$Uri, $Headers)',
  "    if ($Uri -like '*/releases/latest') {",
  "        if (-not $env:HX_LATEST) { throw 'mock 404' }",
  '        return ($env:HX_LATEST | ConvertFrom-Json)',
  '    }',
  "    elseif ($Uri -like '*/releases?per_page=100') {",
  "        if (-not $env:HX_LIST) { throw 'mock 404' }",
  '        return ($env:HX_LIST | ConvertFrom-Json)',
  '    }',
  "    elseif ($Uri -like '*/releases/tags/*') {",
  "        $t = $Uri -replace '.*/releases/tags/', ''",
  "        $k = 'HX_TAG_' + ($t -replace '[.\\-]', '_')",
  '        $v = [Environment]::GetEnvironmentVariable($k)',
  "        if (-not $v) { throw 'mock 404' }",
  '        return ($v | ConvertFrom-Json)',
  '    }',
  '    throw "unexpected uri $Uri"',
  '}',
].join('\n')

type Run = { code: number; stdout: string; stderr: string }

function runPwsh(body: string, env: Record<string, string> = {}): Run {
  const script = `$ErrorActionPreference='Stop'\n${STUB}\n. '${SCRIPT}'\n${body}`
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DIFYCTL_INSTALL_LIB: '1',
      DIFY_VERSION: '',
      DIFYCTL_VERSION: '',
      LOCALAPPDATA: process.env.LOCALAPPDATA || '/tmp',
      TEMP: process.env.TEMP || '/tmp',
      ...env,
    },
  })
  return { code: r.status ?? 1, stdout: (r.stdout ?? '').trim(), stderr: r.stderr ?? '' }
}

const REL_1142 = JSON.stringify({
  tag_name: '1.14.2',
  assets: [{ name: 'difyctl-v0.2.0-windows-x64.exe' }],
})
const REL_1150 = JSON.stringify({
  tag_name: '1.15.0',
  assets: [{ name: 'difyctl-v0.3.0-windows-x64.exe' }],
})
const LIST_NEWEST_FIRST = JSON.stringify([
  { tag_name: '1.15.0', assets: [{ name: 'difyctl-v0.3.0-windows-x64.exe' }] },
  { tag_name: '1.14.2', assets: [{ name: 'difyctl-v0.2.0-windows-x64.exe' }] },
])

describe.skipIf(!PWSH)('install.ps1 Get-AssetSemver', () => {
  it('extracts the version from a windows .exe asset name', () => {
    const r = runPwsh("(Get-AssetSemver 'difyctl-v0.2.0-windows-x64.exe').Version")
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('0.2.0')
  })

  it('extracts a prerelease version and its rc number', () => {
    const r = runPwsh(
      '$a = Get-AssetSemver \'difyctl-v0.1.0-rc.1-windows-x64.exe\'; "$($a.Version) $($a.Rc)"',
    )
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('0.1.0-rc.1 1')
  })

  it('rejects a non-windows asset (returns null)', () => {
    const r = runPwsh(
      "if ($null -eq (Get-AssetSemver 'difyctl-v0.2.0-linux-x64')) { 'NULL' } else { 'OBJ' }",
    )
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('NULL')
  })

  it('rejects a malformed core version (returns null)', () => {
    const r = runPwsh(
      "if ($null -eq (Get-AssetSemver 'difyctl-vx.y.z-windows-x64.exe')) { 'NULL' } else { 'OBJ' }",
    )
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('NULL')
  })
})

describe.skipIf(!PWSH)('install.ps1 Select-Asset', () => {
  it('picks the highest semver among several windows builds', () => {
    const rel = JSON.stringify({
      assets: [
        { name: 'difyctl-v0.2.0-windows-x64.exe' },
        { name: 'difyctl-v0.10.0-windows-x64.exe' },
        { name: 'difyctl-v0.9.0-windows-x64.exe' },
      ],
    })
    const r = runPwsh(`(Select-Asset ('${rel}' | ConvertFrom-Json)).Version`)
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('0.10.0')
  })

  it('prefers the stable release over an rc of the same core', () => {
    const rel = JSON.stringify({
      assets: [
        { name: 'difyctl-v0.2.0-rc.1-windows-x64.exe' },
        { name: 'difyctl-v0.2.0-windows-x64.exe' },
      ],
    })
    const r = runPwsh(`(Select-Asset ('${rel}' | ConvertFrom-Json)).Version`)
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('0.2.0')
  })

  it('ignores checksums and non-windows assets', () => {
    const rel = JSON.stringify({
      assets: [
        { name: 'difyctl-v0.2.0-linux-x64' },
        { name: 'difyctl-v0.2.0-checksums.txt' },
        { name: 'difyctl-v0.2.0-windows-x64.exe' },
        { name: 'some-other-asset.zip' },
      ],
    })
    const r = runPwsh(`(Select-Asset ('${rel}' | ConvertFrom-Json)).Name`)
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('difyctl-v0.2.0-windows-x64.exe')
  })

  it('yields null when no windows asset is present', () => {
    const rel = JSON.stringify({ assets: [{ name: 'difyctl-v0.2.0-linux-x64' }] })
    const r = runPwsh(
      `if ($null -eq (Select-Asset ('${rel}' | ConvertFrom-Json))) { 'NULL' } else { 'OBJ' }`,
    )
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('NULL')
  })
})

describe.skipIf(!PWSH)('install.ps1 Resolve-Release', () => {
  it('DIFY_VERSION pins the release directly', () => {
    const r = runPwsh('(Resolve-Release).tag_name', {
      DIFY_VERSION: '1.14.2',
      HX_TAG_1_14_2: REL_1142,
    })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('1.14.2')
  })

  it('DIFY_VERSION that does not exist throws a clear message', () => {
    const r = runPwsh('(Resolve-Release).tag_name', { DIFY_VERSION: '9.9.9' })
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('Dify release 9.9.9 not found')
  })

  it('blank resolves to the latest release', () => {
    const r = runPwsh('(Resolve-Release).tag_name', { HX_LATEST: REL_1150 })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('1.15.0')
  })

  it('blank throws when the latest query fails (no silent fallback)', () => {
    const r = runPwsh('(Resolve-Release).tag_name')
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('failed to query latest Dify release')
  })

  it('DIFYCTL_VERSION resolves to the release hosting that build', () => {
    const r = runPwsh('(Resolve-Release).tag_name', {
      DIFYCTL_VERSION: '0.2.0',
      HX_LIST: LIST_NEWEST_FIRST,
    })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('1.14.2')
  })

  it('DIFYCTL_VERSION not hosted anywhere throws', () => {
    const r = runPwsh('(Resolve-Release).tag_name', {
      DIFYCTL_VERSION: '9.9.9',
      HX_LIST: LIST_NEWEST_FIRST,
    })
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('difyctl 9.9.9 not found on any Dify release')
  })
})

describe.skipIf(!PWSH)('install.ps1 Find-ReleaseForDifyctl', () => {
  it('returns the newest release whose assets host the wanted build', () => {
    const r = runPwsh("(Find-ReleaseForDifyctl '0.2.0').tag_name", { HX_LIST: LIST_NEWEST_FIRST })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('1.14.2')
  })

  it('returns nothing when no release hosts the wanted build', () => {
    const r = runPwsh(
      "$x = Find-ReleaseForDifyctl '9.9.9'; if ($null -eq $x) { 'NULL' } else { $x.tag_name }",
      { HX_LIST: LIST_NEWEST_FIRST },
    )
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('NULL')
  })
})

// Build a fake ErrorRecord whose Exception.Response is a real HttpResponseMessage
// carrying the given status + headers, matching what Get-RateLimitInfo inspects.
function fakeErr(status: number, headers: Record<string, string>): string {
  const adds = Object.entries(headers)
    .map(([k, v]) => `$resp.Headers.TryAddWithoutValidation('${k}','${v}') | Out-Null`)
    .join('\n')
  return [
    `$resp = [System.Net.Http.HttpResponseMessage]::new([System.Net.HttpStatusCode]${status})`,
    adds,
    '$err = [pscustomobject]@{ Exception = [pscustomobject]@{ Response = $resp } }',
  ].join('\n')
}

const futureReset = String(Math.floor(Date.now() / 1000) + 1800)

describe.skipIf(!PWSH)('install.ps1 rate limit', () => {
  it('classifies a 403 with x-ratelimit-remaining:0 as rate-limited, returning the reset', () => {
    const r =
      runPwsh(`${fakeErr(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': futureReset })}
      $i = Get-RateLimitInfo $err; if ($null -eq $i) { 'NULL' } else { $i.Reset }`)
    expect(r.code).toBe(0)
    expect(r.stdout).toBe(futureReset)
  })

  it('does not classify a 403 with remaining tokens as rate-limited', () => {
    const r = runPwsh(`${fakeErr(403, { 'x-ratelimit-remaining': '59' })}
      $i = Get-RateLimitInfo $err; if ($null -eq $i) { 'NULL' } else { 'LIMITED' }`)
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('NULL')
  })

  it('always treats a 429 as rate-limited', () => {
    const r = runPwsh(`${fakeErr(429, {})}
      $i = Get-RateLimitInfo $err; if ($null -eq $i) { 'NULL' } else { 'LIMITED' }`)
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('LIMITED')
  })

  it('returns null for an error without a response (e.g. a plain string throw)', () => {
    const r = runPwsh(
      "$err = [pscustomobject]@{ Exception = [pscustomobject]@{} }; if ($null -eq (Get-RateLimitInfo $err)) { 'NULL' } else { 'OBJ' }",
    )
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('NULL')
  })

  it('Write-RateLimitHint prints cause, ETA, and remediation to stderr', () => {
    const r = runPwsh(`Write-RateLimitHint '${futureReset}'`)
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('rate limit exceeded')
    expect(r.stderr).toContain('resets in ~')
    expect(r.stderr).toContain('GITHUB_TOKEN')
  })

  it('Write-RateLimitHint omits the ETA line when the reset epoch is missing', () => {
    const r = runPwsh("Write-RateLimitHint ''")
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('rate limit exceeded')
    expect(r.stderr).not.toContain('resets in ~')
  })

  it('sends an Authorization header when GITHUB_TOKEN is set', () => {
    const r = runPwsh('$headers.Authorization', { GITHUB_TOKEN: 'ghp_secret123' })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('Bearer ghp_secret123')
  })

  it('Resolve-Release surfaces the rate-limit hint and exits, not "not found"', () => {
    const stub = `function Invoke-RestMethod { throw [Microsoft.PowerShell.Commands.HttpResponseException]::new('rate limited', $script:rlResp) }`
    const setup = `$script:rlResp = [System.Net.Http.HttpResponseMessage]::new([System.Net.HttpStatusCode]403)
      $script:rlResp.Headers.TryAddWithoutValidation('x-ratelimit-remaining','0') | Out-Null
      $script:rlResp.Headers.TryAddWithoutValidation('x-ratelimit-reset','${futureReset}') | Out-Null`
    const r = runPwsh(`${setup}\n${stub}\nResolve-Release`, { DIFY_VERSION: '1.15.0' })
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('rate limit exceeded')
    expect(r.stderr).not.toContain('not found')
  })
})
