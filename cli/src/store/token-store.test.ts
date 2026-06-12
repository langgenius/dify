import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileTokenStore } from './token-store'

describe('FileTokenStore', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'difyctl-tok-'))
    file = join(dir, 'tokens.yml')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('returns empty string for a missing credential', () => {
    const s = new FileTokenStore(file)
    expect(s.read('https://cloud.dify.ai', 'a@x.com')).toBe('')
  })

  it('round-trips a bearer with dots and @ kept literal', () => {
    const s = new FileTokenStore(file)
    s.write('https://cloud.dify.ai', 'a.b@x.com', 'dfoa_secret')
    expect(s.read('https://cloud.dify.ai', 'a.b@x.com')).toBe('dfoa_secret')
  })

  it('keeps multiple accounts under one host and isolates hosts', () => {
    const s = new FileTokenStore(file)
    s.write('https://cloud.dify.ai', 'a@x.com', 'A')
    s.write('https://cloud.dify.ai', 'b@x.com', 'B')
    s.write('https://self.example.com', 'a@x.com', 'C')
    expect(s.read('https://cloud.dify.ai', 'a@x.com')).toBe('A')
    expect(s.read('https://cloud.dify.ai', 'b@x.com')).toBe('B')
    expect(s.read('https://self.example.com', 'a@x.com')).toBe('C')
  })

  it('persists the versioned nested shape on disk', () => {
    const s = new FileTokenStore(file)
    s.write('https://cloud.dify.ai', 'a@x.com', 'A')
    const raw = readFileSync(file, 'utf8')
    expect(raw).toContain('version: 1')
    expect(raw).toContain('https://cloud.dify.ai')
    expect(raw).toContain('a@x.com')
  })

  it('reads empty when the document version is an unknown future version', () => {
    writeFileSync(file, 'version: 999\ntokens:\n  "h":\n    "e": "x"\n')
    const s = new FileTokenStore(file)
    expect(s.read('h', 'e')).toBe('')
  })

  it('reads tokens from legacy format (no version field) for transparent migration', () => {
    writeFileSync(file, 'tokens:\n  "h":\n    "e": "dfoa_legacy"\n')
    const s = new FileTokenStore(file)
    expect(s.read('h', 'e')).toBe('dfoa_legacy')
  })

  it('preserves existing tokens and stamps version when writing to a legacy file', () => {
    writeFileSync(file, 'tokens:\n  "h":\n    "existing@x": "dfoa_existing"\n')
    const s = new FileTokenStore(file)
    s.write('h', 'new@x', 'dfoa_new')
    expect(s.read('h', 'existing@x')).toBe('dfoa_existing')
    expect(s.read('h', 'new@x')).toBe('dfoa_new')
    expect(readFileSync(file, 'utf8')).toContain('version: 1')
  })

  it('remove deletes the credential and prunes the empty host map', () => {
    const s = new FileTokenStore(file)
    s.write('https://cloud.dify.ai', 'a@x.com', 'A')
    s.remove('https://cloud.dify.ai', 'a@x.com')
    expect(s.read('https://cloud.dify.ai', 'a@x.com')).toBe('')
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain('cloud.dify.ai')
  })

  it('remove is a no-op for an absent credential', () => {
    const s = new FileTokenStore(file)
    expect(() => s.remove('h', 'e')).not.toThrow()
  })
})
