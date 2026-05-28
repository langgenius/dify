import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { FILE_NAME } from '../../../config/schema.js'
import { isBaseError } from '../../../errors/base.js'
import { ErrorCode, ExitCode } from '../../../errors/codes.js'
import { runConfigSet } from './run.js'

describe('runConfigSet', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-set-'))
  })

  it('writes config.yml and returns "set k = v\\n"', async () => {
    const out = await runConfigSet({ dir, key: 'defaults.format', value: 'json' })
    expect(out).toBe('set defaults.format = json\n')
    const raw = await readFile(join(dir, FILE_NAME), 'utf8')
    expect(raw).toContain('format: json')
  })

  it('rejects invalid format value with config_invalid_value', async () => {
    let caught: unknown
    try {
      await runConfigSet({ dir, key: 'defaults.format', value: 'csv' })
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.code).toBe(ErrorCode.ConfigInvalidValue)
  })

  it('rejects unknown key with config_invalid_key', async () => {
    let caught: unknown
    try {
      await runConfigSet({ dir, key: 'bogus', value: 'x' })
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.code).toBe(ErrorCode.ConfigInvalidKey)
  })

  it('preserves prior keys when setting a new one', async () => {
    await runConfigSet({ dir, key: 'defaults.format', value: 'yaml' })
    await runConfigSet({ dir, key: 'defaults.limit', value: '40' })
    const raw = await readFile(join(dir, FILE_NAME), 'utf8')
    expect(raw).toContain('format: yaml')
    expect(raw).toContain('limit: 40')
  })

  it('exit code for invalid value is Usage (2)', async () => {
    let caught: unknown
    try {
      await runConfigSet({ dir, key: 'defaults.format', value: 'csv' })
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.exit()).toBe(ExitCode.Usage)
  })

  it('exit code for unknown key is Usage (2)', async () => {
    let caught: unknown
    try {
      await runConfigSet({ dir, key: 'bogus', value: 'x' })
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.exit()).toBe(ExitCode.Usage)
  })

  it('typed wrap chain: invalid defaults.limit surfaces ConfigInvalidValue (not UsageInvalidFlag)', async () => {
    let caught: unknown
    try {
      await runConfigSet({ dir, key: 'defaults.limit', value: 'abc' })
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught)) {
      expect(caught.code).toBe(ErrorCode.ConfigInvalidValue)
      expect(caught.exit()).toBe(ExitCode.Usage)
    }
  })
})
