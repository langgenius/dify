import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../../../config/config-loader.js'
import { isBaseError } from '../../../errors/base.js'
import { ErrorCode, ExitCode } from '../../../errors/codes.js'
import { ENV_CONFIG_DIR } from '../../../store/dir.js'
import { getConfigurationStore } from '../../../store/manager.js'
import { runConfigSet } from './run.js'

describe('runConfigSet', () => {
  let dir: string
  let prevConfigDir: string | undefined

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-set-'))
    prevConfigDir = process.env[ENV_CONFIG_DIR]
    process.env[ENV_CONFIG_DIR] = dir
  })

  afterEach(async () => {
    if (prevConfigDir === undefined)
      delete process.env[ENV_CONFIG_DIR]
    else
      process.env[ENV_CONFIG_DIR] = prevConfigDir
    await rm(dir, { recursive: true, force: true })
  })

  it('persists the value and returns "set k = v\\n"', () => {
    const out = runConfigSet({ store: getConfigurationStore(), key: 'defaults.format', value: 'json' })
    expect(out).toBe('set defaults.format = json\n')

    const r = loadConfig(getConfigurationStore())
    expect(r.found).toBe(true)
    if (r.found)
      expect(r.config.defaults.format).toBe('json')
  })

  it('rejects invalid format value with config_invalid_value', () => {
    let caught: unknown
    try {
      runConfigSet({ store: getConfigurationStore(), key: 'defaults.format', value: 'csv' })
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.code).toBe(ErrorCode.ConfigInvalidValue)
  })

  it('rejects unknown key with config_invalid_key', () => {
    let caught: unknown
    try {
      runConfigSet({ store: getConfigurationStore(), key: 'bogus', value: 'x' })
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.code).toBe(ErrorCode.ConfigInvalidKey)
  })

  it('preserves prior keys when setting a new one', () => {
    runConfigSet({ store: getConfigurationStore(), key: 'defaults.format', value: 'yaml' })
    runConfigSet({ store: getConfigurationStore(), key: 'defaults.limit', value: '40' })

    const r = loadConfig(getConfigurationStore())
    expect(r.found).toBe(true)
    if (r.found) {
      expect(r.config.defaults.format).toBe('yaml')
      expect(r.config.defaults.limit).toBe(40)
    }
  })

  it('exit code for invalid value is Usage (2)', () => {
    let caught: unknown
    try {
      runConfigSet({ store: getConfigurationStore(), key: 'defaults.format', value: 'csv' })
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.exit()).toBe(ExitCode.Usage)
  })

  it('exit code for unknown key is Usage (2)', () => {
    let caught: unknown
    try {
      runConfigSet({ store: getConfigurationStore(), key: 'bogus', value: 'x' })
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.exit()).toBe(ExitCode.Usage)
  })

  it('typed wrap chain: invalid defaults.limit surfaces ConfigInvalidValue (not UsageInvalidFlag)', () => {
    let caught: unknown
    try {
      runConfigSet({ store: getConfigurationStore(), key: 'defaults.limit', value: 'abc' })
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught)) {
      expect(caught.code).toBe(ErrorCode.ConfigInvalidValue)
      expect(caught.exit()).toBe(ExitCode.Usage)
    }
  })
})
