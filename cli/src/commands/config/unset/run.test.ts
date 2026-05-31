import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../../../config/config-loader.js'
import { isBaseError } from '../../../errors/base.js'
import { ErrorCode } from '../../../errors/codes.js'
import { ENV_CONFIG_DIR } from '../../../store/dir.js'
import { getConfigurationStore } from '../../../store/manager.js'
import { runConfigUnset } from './run.js'

describe('runConfigUnset', () => {
  let dir: string
  let prevConfigDir: string | undefined

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-unset-'))
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
