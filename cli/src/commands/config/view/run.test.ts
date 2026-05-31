import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ENV_CONFIG_DIR } from '../../../store/dir.js'
import { getConfigurationStore } from '../../../store/manager.js'
import { runConfigView } from './run.js'

describe('runConfigView', () => {
  let dir: string
  let prevConfigDir: string | undefined

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-view-'))
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

  it('text format: empty config returns empty string', () => {
    const out = runConfigView({ store: getConfigurationStore() })
    expect(out).toBe('')
  })

  it('text format: emits "key = value" lines for set keys only', () => {
    getConfigurationStore().setTyped({
      schema_version: 1,
      defaults: { format: 'json', limit: 50 },
      state: { current_app: 'app-1' },
    })
    const out = runConfigView({ store: getConfigurationStore() })
    expect(out).toBe(
      'defaults.format = json\ndefaults.limit = 50\nstate.current_app = app-1\n',
    )
  })

  it('text format: skips unset keys', () => {
    getConfigurationStore().setTyped({
      schema_version: 1,
      defaults: { format: 'yaml' },
    })
    const out = runConfigView({ store: getConfigurationStore() })
    expect(out).toBe('defaults.format = yaml\n')
    expect(out).not.toContain('defaults.limit')
    expect(out).not.toContain('state.current_app')
  })

  it('json format: empty config returns "{}\\n"', () => {
    const out = runConfigView({ store: getConfigurationStore(), json: true })
    expect(out).toBe('{}\n')
  })

  it('json format: defaults.limit is numeric, others are strings', () => {
    getConfigurationStore().setTyped({
      schema_version: 1,
      defaults: { format: 'table', limit: 100 },
      state: { current_app: 'app-x' },
    })
    const out = runConfigView({ store: getConfigurationStore(), json: true })
    const parsed = JSON.parse(out) as Record<string, unknown>
    expect(parsed['defaults.format']).toBe('table')
    expect(parsed['defaults.limit']).toBe(100)
    expect(parsed['state.current_app']).toBe('app-x')
  })

  it('json format: trailing newline matches Go encoder.Encode', () => {
    const out = runConfigView({ store: getConfigurationStore(), json: true })
    expect(out.endsWith('\n')).toBe(true)
  })
})
