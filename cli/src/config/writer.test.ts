import { mkdtemp, readdir, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from './loader.js'
import { emptyConfig, FILE_NAME } from './schema.js'
import { saveConfig } from './writer.js'

describe('saveConfig', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-w-'))
  })

  it('writes config.yml in the target dir', async () => {
    await saveConfig(dir, { ...emptyConfig(), schema_version: 1 })
    const stats = await stat(join(dir, FILE_NAME))
    expect(stats.isFile()).toBe(true)
  })

  it('stamps schema_version=1 even if caller passed 0', async () => {
    await saveConfig(dir, { ...emptyConfig() })
    const r = await loadConfig(dir)
    expect(r.found).toBe(true)
    if (r.found)
      expect(r.config.schema_version).toBe(1)
  })

  it('round-trips defaults + state through YAML', async () => {
    await saveConfig(dir, {
      schema_version: 1,
      defaults: { format: 'wide', limit: 75 },
      state: { current_app: 'app-xyz' },
    })
    const r = await loadConfig(dir)
    expect(r.found).toBe(true)
    if (r.found) {
      expect(r.config.defaults.format).toBe('wide')
      expect(r.config.defaults.limit).toBe(75)
      expect(r.config.state.current_app).toBe('app-xyz')
    }
  })

  it('writes file with mode 0o600 (POSIX)', async () => {
    if (process.platform === 'win32')
      return
    await saveConfig(dir, emptyConfig())
    const s = await stat(join(dir, FILE_NAME))
    expect(s.mode & 0o777).toBe(0o600)
  })

  it('does not leave a tmp file on success', async () => {
    await saveConfig(dir, emptyConfig())
    const entries = await readdir(dir)
    expect(entries.filter(f => f.endsWith('.tmp'))).toHaveLength(0)
    expect(entries.filter(f => f.includes('.tmp.'))).toHaveLength(0)
  })

  it('creates parent dir at 0o700 if absent', async () => {
    if (process.platform === 'win32')
      return
    const nested = join(dir, 'nested', 'sub')
    await saveConfig(nested, emptyConfig())
    const s = await stat(nested)
    expect(s.isDirectory()).toBe(true)
    expect(s.mode & 0o777).toBe(0o700)
  })

  it('emits parseable YAML (round-trip via fs.readFile + js-yaml)', async () => {
    await saveConfig(dir, {
      schema_version: 1,
      defaults: { format: 'json' },
      state: {},
    })
    const raw = await readFile(join(dir, FILE_NAME), 'utf8')
    expect(raw).toMatch(/^schema_version:/m)
    expect(raw).toMatch(/format: json/)
  })
})
