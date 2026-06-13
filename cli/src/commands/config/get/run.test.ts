import { useTempConfigDir } from '@test/fixtures/config-dir'
import { describe, expect, it } from 'vitest'
import { isBaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { getConfigurationStore } from '@/store/manager'
import { runConfigGet } from './run'

describe('runConfigGet', () => {
  useTempConfigDir('difyctl-get-')

  it('returns set value with trailing newline', () => {
    getConfigurationStore().setTyped({
      schema_version: 1,
      defaults: { format: 'yaml' },
    })
    const out = runConfigGet({ store: getConfigurationStore(), key: 'defaults.format' })
    expect(out).toBe('yaml\n')
  })

  it('returns empty line when key is unset (matches Go fmt.Fprintln)', () => {
    const out = runConfigGet({ store: getConfigurationStore(), key: 'defaults.format' })
    expect(out).toBe('\n')
  })

  it('throws BaseError(config_invalid_key) on unknown key', () => {
    let caught: unknown
    try {
      runConfigGet({ store: getConfigurationStore(), key: 'bogus.key' })
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.code).toBe(ErrorCode.ConfigInvalidKey)
  })

  it('returns numeric limit as string', () => {
    getConfigurationStore().setTyped({
      schema_version: 1,
      defaults: { limit: 75 },
    })
    const out = runConfigGet({ store: getConfigurationStore(), key: 'defaults.limit' })
    expect(out).toBe('75\n')
  })
})
