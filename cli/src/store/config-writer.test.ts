import { useTempConfigDir } from '@test/fixtures/config-dir'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '@/config/config-loader'
import { emptyConfig } from '@/config/schema'
import { saveConfig } from './config-writer'
import { getConfigurationStore } from './manager'

describe('saveConfig', () => {
  useTempConfigDir('difyctl-w-')

  it('stamps schema_version=1 even if caller passed 0', () => {
    saveConfig(getConfigurationStore(), { ...emptyConfig() })
    const r = loadConfig(getConfigurationStore())
    expect(r.found).toBe(true)
    if (r.found)
      expect(r.config.schema_version).toBe(1)
  })

  it('overrides a stale schema_version on save', () => {
    saveConfig(getConfigurationStore(), {
      ...emptyConfig(),
      schema_version: 999 as never,
    })
    const r = loadConfig(getConfigurationStore())
    expect(r.found).toBe(true)
    if (r.found)
      expect(r.config.schema_version).toBe(1)
  })

  it('round-trips defaults + state', () => {
    saveConfig(getConfigurationStore(), {
      schema_version: 1,
      defaults: { format: 'wide', limit: 75 },
      state: { current_app: 'app-xyz' },
    })
    const r = loadConfig(getConfigurationStore())
    expect(r.found).toBe(true)
    if (r.found) {
      expect(r.config.defaults.format).toBe('wide')
      expect(r.config.defaults.limit).toBe(75)
      expect(r.config.state.current_app).toBe('app-xyz')
    }
  })

  it('overwrites the previous config on resave', () => {
    saveConfig(getConfigurationStore(), {
      schema_version: 1,
      defaults: { format: 'json' },
      state: {},
    })
    saveConfig(getConfigurationStore(), {
      schema_version: 1,
      defaults: { format: 'table' },
      state: { current_app: 'app-2' },
    })
    const r = loadConfig(getConfigurationStore())
    expect(r.found).toBe(true)
    if (r.found) {
      expect(r.config.defaults.format).toBe('table')
      expect(r.config.state.current_app).toBe('app-2')
    }
  })
})
