import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('./install-cli.sh', import.meta.url))

// Drive the pure resolver: `. install-cli.sh; select_version <channel>` with
// the matching-refs JSON piped to stdin. DIFYCTL_INSTALL_LIB=1 stops main running.
function selectVersion(channel: string, refsJson: string): string {
  return execFileSync('sh', ['-c', `. "${SCRIPT}"; select_version "$1"`, 'sh', channel], {
    input: refsJson,
    encoding: 'utf8',
    env: { ...process.env, DIFYCTL_INSTALL_LIB: '1' },
  }).trim()
}

// A git/matching-refs/tags/difyctl-v response in arbitrary (non-sorted) order,
// with a stray non-difyctl ref to prove the filter is strict.
const REFS = JSON.stringify([
  { ref: 'refs/tags/difyctl-v0.1.0-rc.1' },
  { ref: 'refs/tags/difyctl-v0.2.0' },
  { ref: 'refs/tags/difyctl-v0.1.0' },
  { ref: 'refs/tags/some-other-tag' },
  { ref: 'refs/tags/difyctl-v0.2.0-rc.2' },
  { ref: 'refs/tags/difyctl-v0.10.0' },
  { ref: 'refs/tags/difyctl-v0.2.0-rc.10' },
])

describe('install-cli select_version', () => {
  it('stable picks the highest non-prerelease difyctl version', () => {
    expect(selectVersion('stable', REFS)).toBe('0.10.0')
  })

  it('rc picks the highest rc (semver-aware: rc.10 > rc.2)', () => {
    expect(selectVersion('rc', REFS)).toBe('0.2.0-rc.10')
  })

  it('ignores non-difyctl refs entirely', () => {
    const noisy = JSON.stringify([{ ref: 'refs/tags/v1.15.0' }, { ref: 'refs/tags/difyctl-v0.3.0' }])
    expect(selectVersion('stable', noisy)).toBe('0.3.0')
  })

  it('yields empty when there are no difyctl tags', () => {
    expect(selectVersion('stable', '[]')).toBe('')
  })

  it('rejects an invalid channel', () => {
    expect(() => selectVersion('nightly', REFS)).toThrow()
  })
})
