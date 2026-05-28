import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FILE_NAME } from '../../../config/schema.js'
import { YamlStore } from '../../../store/store.js'
import { runConfigView } from './run.js'

function makeStore(dir: string): YamlStore {
  return new YamlStore(join(dir, FILE_NAME))
}

describe('runConfigView', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-view-'))
  })

  afterEach(async () => {
    // tmpdir cleanup is best-effort
  })

  it('text format: empty config returns empty string', () => {
    const out = runConfigView({ store: makeStore(dir) })
    expect(out).toBe('')
  })

  it('text format: emits "key = value" lines for set keys only', async () => {
    await writeFile(
      join(dir, FILE_NAME),
      'schema_version: 1\ndefaults:\n  format: json\n  limit: 50\nstate:\n  current_app: app-1\n',
      'utf8',
    )
    const out = runConfigView({ store: makeStore(dir) })
    expect(out).toBe(
      'defaults.format = json\ndefaults.limit = 50\nstate.current_app = app-1\n',
    )
  })

  it('text format: skips unset keys', async () => {
    await writeFile(
      join(dir, FILE_NAME),
      'schema_version: 1\ndefaults:\n  format: yaml\n',
      'utf8',
    )
    const out = runConfigView({ store: makeStore(dir) })
    expect(out).toBe('defaults.format = yaml\n')
    expect(out).not.toContain('defaults.limit')
    expect(out).not.toContain('state.current_app')
  })

  it('json format: empty config returns "{}\\n"', () => {
    const out = runConfigView({ store: makeStore(dir), json: true })
    expect(out).toBe('{}\n')
  })

  it('json format: defaults.limit is numeric, others are strings', async () => {
    await writeFile(
      join(dir, FILE_NAME),
      'schema_version: 1\ndefaults:\n  format: table\n  limit: 100\nstate:\n  current_app: app-x\n',
      'utf8',
    )
    const out = runConfigView({ store: makeStore(dir), json: true })
    const parsed = JSON.parse(out) as Record<string, unknown>
    expect(parsed['defaults.format']).toBe('table')
    expect(parsed['defaults.limit']).toBe(100)
    expect(parsed['state.current_app']).toBe('app-x')
  })

  it('json format: trailing newline matches Go encoder.Encode', () => {
    const out = runConfigView({ store: makeStore(dir), json: true })
    expect(out.endsWith('\n')).toBe(true)
  })
})
