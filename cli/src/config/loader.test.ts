import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isBaseError } from '../errors/base.js'
import { ErrorCode } from '../errors/codes.js'
import { loadConfig } from './loader.js'
import { FILE_NAME } from './schema.js'

describe('loadConfig', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-cfg-'))
  })

  afterEach(async () => {
    await mkdir(dir, { recursive: true }).catch(() => {})
  })

  it('returns found:false when config.yml is missing', async () => {
    const r = await loadConfig(dir)
    expect(r.found).toBe(false)
  })

  it('parses a minimal valid config.yml', async () => {
    await writeFile(join(dir, FILE_NAME), 'schema_version: 1\n', 'utf8')
    const r = await loadConfig(dir)
    expect(r.found).toBe(true)
    if (r.found)
      expect(r.config.schema_version).toBe(1)
  })

  it('parses defaults + state', async () => {
    await writeFile(
      join(dir, FILE_NAME),
      'schema_version: 1\ndefaults:\n  format: json\n  limit: 100\nstate:\n  current_app: app-1\n',
      'utf8',
    )
    const r = await loadConfig(dir)
    expect(r.found).toBe(true)
    if (r.found) {
      expect(r.config.defaults.format).toBe('json')
      expect(r.config.defaults.limit).toBe(100)
      expect(r.config.state.current_app).toBe('app-1')
    }
  })

  it('throws BaseError(config_schema_unsupported) when YAML is malformed', async () => {
    await writeFile(join(dir, FILE_NAME), '::not yaml::: {{[', 'utf8')
    let caught: unknown
    try {
      await loadConfig(dir)
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.code).toBe(ErrorCode.ConfigSchemaUnsupported)
  })

  it('throws BaseError(config_schema_unsupported) when zod validation fails', async () => {
    await writeFile(join(dir, FILE_NAME), 'defaults:\n  limit: 9999\n', 'utf8')
    let caught: unknown
    try {
      await loadConfig(dir)
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.code).toBe(ErrorCode.ConfigSchemaUnsupported)
  })

  it('throws BaseError(config_schema_unsupported) when schema_version > 1 (forward-refuse)', async () => {
    await writeFile(join(dir, FILE_NAME), 'schema_version: 2\n', 'utf8')
    let caught: unknown
    try {
      await loadConfig(dir)
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
