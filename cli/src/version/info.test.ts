import { describe, expect, it } from 'vite-plus/test'
import { longVersion, shortVersion, userAgent } from './info'

describe('version info', () => {
  it('shortVersion returns the build-injected version string', () => {
    expect(shortVersion()).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/)
  })

  it('longVersion includes commit, build date, and channel', () => {
    const out = longVersion()
    expect(out).toMatch(/^difyctl /)
    expect(out).toContain('commit')
    expect(out).toContain('built')
    expect(out).toContain('channel')
  })

  it('userAgent is well-formed', () => {
    expect(userAgent()).toMatch(/^difyctl\/\S+ \(\S+; \S+; \S+\)$/)
  })
})
