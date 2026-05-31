import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isBaseError } from '../../../errors/base.js'
import { ErrorCode } from '../../../errors/codes.js'
import { ENV_CONFIG_DIR } from '../../../store/dir.js'
import { getConfigurationStore } from '../../../store/manager.js'
import { runConfigGet } from './run.js'

describe('runConfigGet', () => {
  let dir: string
  let prevConfigDir: string | undefined

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-get-'))
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
