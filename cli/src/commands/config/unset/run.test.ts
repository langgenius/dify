import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { FILE_NAME } from '../../../config/schema.js'
import { isBaseError } from '../../../errors/base.js'
import { ErrorCode } from '../../../errors/codes.js'
import { runConfigUnset } from './run.js'

describe('runConfigUnset', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-unset-'))
  })

  it('clears the requested key, leaves others intact', async () => {
    await writeFile(
      join(dir, FILE_NAME),
      'schema_version: 1\ndefaults:\n  format: json\n  limit: 25\n',
      'utf8',
    )
    const out = await runConfigUnset({ dir, key: 'defaults.format' })
    expect(out).toBe('unset defaults.format\n')
    const raw = await readFile(join(dir, FILE_NAME), 'utf8')
    expect(raw).not.toContain('format:')
    expect(raw).toContain('limit: 25')
  })

  it('is a no-op (writes empty config) when key was already unset', async () => {
    const out = await runConfigUnset({ dir, key: 'defaults.format' })
    expect(out).toBe('unset defaults.format\n')
    const raw = await readFile(join(dir, FILE_NAME), 'utf8')
    expect(raw).toContain('schema_version: 1')
  })

  it('rejects unknown key', async () => {
    let caught: unknown
    try {
      await runConfigUnset({ dir, key: 'bogus' })
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.code).toBe(ErrorCode.ConfigInvalidKey)
  })
})
