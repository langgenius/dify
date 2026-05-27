import { describe, expect, it } from 'vitest'
import {
  ALLOWED_FORMATS,
  ConfigFileSchema,
  CURRENT_SCHEMA_VERSION,
  emptyConfig,
  FILE_NAME,
} from './schema.js'

describe('config schema', () => {
  it('CURRENT_SCHEMA_VERSION is 1', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1)
  })

  it('FILE_NAME is config.yml', () => {
    expect(FILE_NAME).toBe('config.yml')
  })

  it('ALLOWED_FORMATS matches Go set (json/yaml/table/wide/name/text)', () => {
    expect([...ALLOWED_FORMATS].sort()).toEqual(
      ['json', 'name', 'table', 'text', 'wide', 'yaml'],
    )
  })

  it('emptyConfig fills defaults + state with empty objects', () => {
    const cfg = emptyConfig()
    expect(cfg.schema_version).toBe(0)
    expect(cfg.defaults).toEqual({})
    expect(cfg.state).toEqual({})
  })

  it('rejects defaults.limit out of bounds', () => {
    expect(ConfigFileSchema.safeParse({ defaults: { limit: 0 } }).success).toBe(false)
    expect(ConfigFileSchema.safeParse({ defaults: { limit: 201 } }).success).toBe(false)
    expect(ConfigFileSchema.safeParse({ defaults: { limit: 50 } }).success).toBe(true)
  })

  it('rejects defaults.format outside the enum', () => {
    expect(ConfigFileSchema.safeParse({ defaults: { format: 'csv' } }).success).toBe(false)
    expect(ConfigFileSchema.safeParse({ defaults: { format: 'json' } }).success).toBe(true)
  })

  it('accepts the full v1 shape', () => {
    const r = ConfigFileSchema.safeParse({
      schema_version: 1,
      defaults: { format: 'yaml', limit: 100 },
      state: { current_app: 'app-123' },
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.defaults.format).toBe('yaml')
      expect(r.data.defaults.limit).toBe(100)
      expect(r.data.state.current_app).toBe('app-123')
    }
  })

  it('parses an empty object into emptyConfig() shape', () => {
    const r = ConfigFileSchema.safeParse({})
    expect(r.success).toBe(true)
    if (r.success)
      expect(r.data).toEqual(emptyConfig())
  })
})
