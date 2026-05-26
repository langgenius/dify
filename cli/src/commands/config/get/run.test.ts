import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { FILE_NAME } from '../../../config/schema.js'
import { isBaseError } from '../../../errors/base.js'
import { ErrorCode } from '../../../errors/codes.js'
import { runConfigGet } from './run.js'

describe('runConfigGet', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-get-'))
  })

  it('returns set value with trailing newline', async () => {
    await writeFile(
      join(dir, FILE_NAME),
      'schema_version: 1\ndefaults:\n  format: yaml\n',
      'utf8',
    )
    const out = await runConfigGet({ dir, key: 'defaults.format' })
    expect(out).toBe('yaml\n')
  })

  it('returns empty line when key is unset (matches Go fmt.Fprintln)', async () => {
    const out = await runConfigGet({ dir, key: 'defaults.format' })
    expect(out).toBe('\n')
  })

  it('throws BaseError(config_invalid_key) on unknown key', async () => {
    let caught: unknown
    try {
      await runConfigGet({ dir, key: 'bogus.key' })
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.code).toBe(ErrorCode.ConfigInvalidKey)
  })

  it('returns numeric limit as string', async () => {
    await writeFile(
      join(dir, FILE_NAME),
      'schema_version: 1\ndefaults:\n  limit: 75\n',
      'utf8',
    )
    const out = await runConfigGet({ dir, key: 'defaults.limit' })
    expect(out).toBe('75\n')
  })
})
