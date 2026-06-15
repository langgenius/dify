import { useTempConfigDir } from '@test/fixtures/config-dir'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '@/config/config-loader'
import { isBaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { getConfigurationStore } from '@/store/manager'
import { runConfigUnset } from './run'

describe('runConfigUnset', () => {
  useTempConfigDir('difyctl-unset-')

  it('clears the requested key, leaves others intact', () => {
    getConfigurationStore().setTyped({
      schema_version: 1,
      defaults: { format: 'json', limit: 25 },
    })
    const out = runConfigUnset({ store: getConfigurationStore(), key: 'defaults.format' })
    expect(out).toBe('unset defaults.format\n')

    const r = loadConfig(getConfigurationStore())
    expect(r.found).toBe(true)
    if (r.found) {
      expect(r.config.defaults.format).not.toBe('json')
      expect(r.config.defaults.limit).toBe(25)
    }
  })

  it('is a no-op (writes empty config) when key was already unset', () => {
    const out = runConfigUnset({ store: getConfigurationStore(), key: 'defaults.format' })
    expect(out).toBe('unset defaults.format\n')
    const r = loadConfig(getConfigurationStore())
    expect(r.found).toBe(true)
    if (r.found)
      expect(r.config.schema_version).toBe(1)
  })

  it('rejects unknown key', () => {
    let caught: unknown
    try {
      runConfigUnset({ store: getConfigurationStore(), key: 'bogus' })
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.code).toBe(ErrorCode.ConfigInvalidKey)
  })
})
