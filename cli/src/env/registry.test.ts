import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ENV_REGISTRY,
  getEnv,
  lookupEnv,
  resolveEnv,
} from './registry.js'

describe('env registry', () => {
  it('contains every DIFY_* var from the v1.0 spec', () => {
    const names = ENV_REGISTRY.map(e => e.name)
    expect(names).toContain('DIFY_TOKEN')
    expect(names).toContain('DIFY_HOST')
    expect(names).toContain('DIFY_WORKSPACE_ID')
    expect(names).toContain('DIFY_CONFIG_DIR')
    expect(names).toContain('DIFY_LIMIT')
    expect(names).toContain('DIFY_FORMAT')
    expect(names).toContain('DIFY_NO_PROGRESS')
    expect(names).toContain('DIFY_PLAIN')
  })

  it('is sorted alphabetically (matches Go init() ordering)', () => {
    const names = ENV_REGISTRY.map(e => e.name)
    const sorted = [...names].sort()
    expect(names).toEqual(sorted)
  })

  it('marks DIFY_TOKEN as sensitive', () => {
    expect(lookupEnv('DIFY_TOKEN')?.sensitive).toBe(true)
  })

  it('does not mark non-secret vars as sensitive', () => {
    expect(lookupEnv('DIFY_HOST')?.sensitive).toBeFalsy()
    expect(lookupEnv('DIFY_LIMIT')?.sensitive).toBeFalsy()
  })

  it('lookupEnv returns undefined for unknown name', () => {
    expect(lookupEnv('DIFY_NOPE')).toBeUndefined()
  })

  it('lookupEnv finds the registry entry by name', () => {
    expect(lookupEnv('DIFY_HOST')?.description).toMatch(/host/i)
  })

  describe('process.env reads', () => {
    const originals: Record<string, string | undefined> = {}
    beforeEach(() => {
      originals.DIFY_LIMIT = process.env.DIFY_LIMIT
      originals.DIFY_HOST = process.env.DIFY_HOST
      originals.DIFY_TEST_NONEXISTENT = process.env.DIFY_TEST_NONEXISTENT
      delete process.env.DIFY_LIMIT
      delete process.env.DIFY_HOST
      delete process.env.DIFY_TEST_NONEXISTENT
    })
    afterEach(() => {
      for (const [k, v] of Object.entries(originals)) {
        if (v === undefined)
          delete process.env[k]
        else process.env[k] = v
      }
    })

    it('getEnv returns undefined for unset var', () => {
      expect(getEnv('DIFY_TEST_NONEXISTENT')).toBeUndefined()
    })

    it('getEnv returns the literal string for a set var', () => {
      process.env.DIFY_HOST = 'https://cloud.dify.ai'
      expect(getEnv('DIFY_HOST')).toBe('https://cloud.dify.ai')
    })

    it('resolveEnv returns parsed value for DIFY_LIMIT (uses parseLimit)', () => {
      process.env.DIFY_LIMIT = '42'
      expect(resolveEnv('DIFY_LIMIT')).toBe(42)
    })

    it('resolveEnv returns the raw string for vars with no parser', () => {
      process.env.DIFY_HOST = 'https://example.dify.ai'
      expect(resolveEnv('DIFY_HOST')).toBe('https://example.dify.ai')
    })

    it('resolveEnv returns undefined when var is unset and no default', () => {
      expect(resolveEnv('DIFY_HOST')).toBeUndefined()
    })

    it('resolveEnv propagates parser errors', () => {
      process.env.DIFY_LIMIT = '999'
      expect(() => resolveEnv('DIFY_LIMIT')).toThrow(/out of range/)
    })

    it('resolveEnv accepts unknown var name and returns undefined (no throw)', () => {
      expect(resolveEnv('DIFY_NOPE')).toBeUndefined()
    })
  })
})
