import { useTempConfigDir } from '@test/fixtures/config-dir'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '@/config/config-loader'
import { isBaseError } from '@/errors/base'
import { ErrorCode, ExitCode } from '@/errors/codes'
import { getConfigurationStore } from '@/store/manager'
import { runConfigSet } from './run'

describe('runConfigSet', () => {
  useTempConfigDir('difyctl-set-')

  it('persists the value and returns "set k = v\\n"', async () => {
    const out = await runConfigSet({ store: getConfigurationStore(), key: 'defaults.format', value: 'json' })
    expect(out).toBe('set defaults.format = json\n')

    const r = await loadConfig(getConfigurationStore())
    expect(r.found).toBe(true)
    if (r.found)
      expect(r.config.defaults.format).toBe('json')
  })

  it('rejects invalid format value with config_invalid_value', async () => {
    let caught: unknown
    try {
      await runConfigSet({ store: getConfigurationStore(), key: 'defaults.format', value: 'csv' })
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.code).toBe(ErrorCode.ConfigInvalidValue)
  })

  it('rejects unknown key with config_invalid_key', async () => {
    let caught: unknown
    try {
      await runConfigSet({ store: getConfigurationStore(), key: 'bogus', value: 'x' })
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.code).toBe(ErrorCode.ConfigInvalidKey)
  })

  it('preserves prior keys when setting a new one', async () => {
    await runConfigSet({ store: getConfigurationStore(), key: 'defaults.format', value: 'yaml' })
    await runConfigSet({ store: getConfigurationStore(), key: 'defaults.limit', value: '40' })

    const r = await loadConfig(getConfigurationStore())
    expect(r.found).toBe(true)
    if (r.found) {
      expect(r.config.defaults.format).toBe('yaml')
      expect(r.config.defaults.limit).toBe(40)
    }
  })

  it('exit code for invalid value is Usage (2)', async () => {
    let caught: unknown
    try {
      await runConfigSet({ store: getConfigurationStore(), key: 'defaults.format', value: 'csv' })
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.exit()).toBe(ExitCode.Usage)
  })

  it('exit code for unknown key is Usage (2)', async () => {
    let caught: unknown
    try {
      await runConfigSet({ store: getConfigurationStore(), key: 'bogus', value: 'x' })
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.exit()).toBe(ExitCode.Usage)
  })

  it('typed wrap chain: invalid defaults.limit surfaces ConfigInvalidValue (not UsageInvalidFlag)', async () => {
    let caught: unknown
    try {
      await runConfigSet({ store: getConfigurationStore(), key: 'defaults.limit', value: 'abc' })
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught)) {
      expect(caught.code).toBe(ErrorCode.ConfigInvalidValue)
      expect(caught.exit()).toBe(ExitCode.Usage)
    }
  })
})
