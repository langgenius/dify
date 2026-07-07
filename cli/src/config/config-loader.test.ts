import type { YamlStore } from '@/store/store'
import { useTempConfigDir } from '@test/fixtures/config-dir'
import { describe, expect, it } from 'vitest'
import { isBaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { getConfigurationStore } from '@/store/manager'
import { loadConfig } from './config-loader'

describe('loadConfig', () => {
  useTempConfigDir('difyctl-cfg-')

  it('returns found:false when config is missing', async () => {
    const r = await loadConfig(getConfigurationStore())
    expect(r.found).toBe(false)
  })

  it('parses a minimal valid config', async () => {
    await getConfigurationStore().setTyped({ schema_version: 1 })
    const r = await loadConfig(getConfigurationStore())
    expect(r.found).toBe(true)
    if (r.found)
      expect(r.config.schema_version).toBe(1)
  })

  it('parses defaults + state', async () => {
    await getConfigurationStore().setTyped({
      schema_version: 1,
      defaults: { format: 'json', limit: 100 },
      state: { current_app: 'app-1' },
    })
    const r = await loadConfig(getConfigurationStore())
    expect(r.found).toBe(true)
    if (r.found) {
      expect(r.config.defaults.format).toBe('json')
      expect(r.config.defaults.limit).toBe(100)
      expect(r.config.state.current_app).toBe('app-1')
    }
  })

  it('throws BaseError(config_schema_unsupported) when the store fails to parse the file', async () => {
    // Simulate a corrupt on-disk file via a fake store; loadConfig must wrap
    // the underlying error as ConfigSchemaUnsupported.
    const throwingStore = {
      getTyped: () => { throw new Error('YAML parse failure') },
    } as unknown as YamlStore
    let caught: unknown
    try {
      await loadConfig(throwingStore)
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught)) {
      expect(caught.code).toBe(ErrorCode.ConfigSchemaUnsupported)
      expect(caught.hint).toMatch(/not valid YAML/)
    }
  })

  it('throws BaseError(config_schema_unsupported) when zod validation fails', async () => {
    await getConfigurationStore().setTyped({ defaults: { limit: 9999 } })
    let caught: unknown
    try {
      await loadConfig(getConfigurationStore())
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.code).toBe(ErrorCode.ConfigSchemaUnsupported)
  })

  it('throws BaseError(config_schema_unsupported) when schema_version > 1 (forward-refuse)', async () => {
    await getConfigurationStore().setTyped({ schema_version: 2 })
    let caught: unknown
    try {
      await loadConfig(getConfigurationStore())
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught)) {
      expect(caught.code).toBe(ErrorCode.ConfigSchemaUnsupported)
      expect(caught.message).toMatch(/schema_version=2/)
      expect(caught.hint).toMatch(/upgrade difyctl/)
    }
  })
})
