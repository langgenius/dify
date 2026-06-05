import { execFileSync } from 'node:child_process'
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
