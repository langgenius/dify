import { describe, expect, it } from 'vitest'
import Version from './index.js'

describe('Version command', () => {
  it('prints structured block on stable channel without warning', async () => {
    const info = await import('../../version/info.js')
    const orig = info.versionInfo.channel
    Object.assign(info.versionInfo, { channel: 'stable' })
    try {
      const output = await new Version().run([])
      expect(output?.kind).toBe('raw')
      if (output?.kind !== 'raw')
        throw new Error('expected raw output')
      const text = output.data
      expect(text).toMatch(/^difyctl /)
      expect(text).toContain('channel: stable')
      expect(text).toContain('compat:')
      expect(text).not.toContain('WARNING:')
    }
    finally {
      Object.assign(info.versionInfo, { channel: orig })
    }
  })

  it('prints warning on rc channel', async () => {
    const info = await import('../../version/info.js')
    const orig = info.versionInfo.channel
    Object.assign(info.versionInfo, { channel: 'rc' })
    try {
      const output = await new Version().run([])
      expect(output?.kind).toBe('raw')
      if (output?.kind !== 'raw')
        throw new Error('expected raw output')
      const text = output.data
      expect(text).toContain('channel: rc')
      expect(text).toContain('WARNING: This build is a release candidate')
      expect(text).toContain('install the stable channel')
    }
    finally {
      Object.assign(info.versionInfo, { channel: orig })
    }
  })

  it('emits JSON when --json flag passed', async () => {
    const output = await new Version().run(['--json'])
    expect(output?.kind).toBe('raw')
    if (output?.kind !== 'raw')
      throw new Error('expected raw output')
    const payload = JSON.parse(output.data)
    expect(payload).toHaveProperty('version')
    expect(payload).toHaveProperty('channel')
    expect(payload).toHaveProperty('compat')
    expect(payload.compat).toHaveProperty('minDify')
    expect(payload.compat).toHaveProperty('maxDify')
  })
})
