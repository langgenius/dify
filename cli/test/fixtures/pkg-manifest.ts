import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Mirrors PKG_PATH_ENV in scripts/release-naming.mjs, which cannot be imported
// here: its shebang breaks the Windows test runner. Divergence is self-
// reporting, not silent — the script would fall back to the real
// cli/package.json and every fixture-window assertion would fail.
const PKG_PATH_ENV = 'DIFYCTL_PKG_PATH'

// release-naming.mjs and release-r2-edge.mjs read their data from
// cli/package.json. Tests spawn them against this fixture instead, so
// assertions can name exact versions without tracking the live release.

// Deliberately far from any real Dify version, and min != max so "inside the
// window" is a case distinct from either bound.
export const FIXTURE_COMPAT = { minDify: '2.0.0', maxDify: '2.5.0' }

export const FIXTURE_TARGET_IDS = [
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'windows-x64',
] as const

const FIXTURE_RELEASE = {
  tagPrefix: 'difyctl-v',
  binName: 'difyctl',
  checksumsSuffix: '-checksums.txt',
  targets: FIXTURE_TARGET_IDS.map((id) => ({
    id,
    bunTarget: `bun-${id}`,
    exe: id.startsWith('windows'),
  })),
}

export type PkgManifestOverrides = {
  version?: string
  channel?: string
  compat?: { minDify: string; maxDify: string }
}

// Returns the env additions that point a spawned script at the fixture.
export function pkgManifestEnv(overrides: PkgManifestOverrides = {}): Record<string, string> {
  const manifest = {
    version: overrides.version ?? '0.2.0-alpha',
    difyctl: {
      channel: overrides.channel ?? 'alpha',
      compat: overrides.compat ?? FIXTURE_COMPAT,
      release: FIXTURE_RELEASE,
    },
  }
  const path = join(mkdtempSync(join(tmpdir(), 'difyctl-pkg-')), 'package.json')
  writeFileSync(path, JSON.stringify(manifest))
  return { [PKG_PATH_ENV]: path }
}
