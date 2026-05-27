import { describe, expect, it } from 'vitest'
import { runEnvList } from './run-list.js'

const stub = (overrides: Record<string, string> = {}) => (name: string) => overrides[name]

describe('runEnvList', () => {
  it('text: header is NAME VALUE DESCRIPTION', () => {
    const out = runEnvList({ lookup: stub() })
    expect(out.split('\n')[0]).toMatch(/^NAME\s+VALUE\s+DESCRIPTION$/)
  })

  it('text: <unset> for unset non-sensitive var', () => {
    const out = runEnvList({ lookup: stub() })
    const hostLine = out.split('\n').find(l => l.startsWith('DIFY_HOST'))!
    expect(hostLine).toContain('<unset>')
  })

  it('text: prints actual value for set non-sensitive var', () => {
    const out = runEnvList({ lookup: stub({ DIFY_HOST: 'https://acme' }) })
    const hostLine = out.split('\n').find(l => l.startsWith('DIFY_HOST'))!
    expect(hostLine).toContain('https://acme')
  })

  it('text: <set> for set sensitive var (token never echoed)', () => {
    const out = runEnvList({ lookup: stub({ DIFY_TOKEN: 'dfoa_secret' }) })
    const tokLine = out.split('\n').find(l => l.startsWith('DIFY_TOKEN'))!
    expect(tokLine).toContain('<set>')
    expect(tokLine).not.toContain('dfoa_secret')
  })

  it('text: <unset> for unset sensitive var', () => {
    const out = runEnvList({ lookup: stub() })
    const tokLine = out.split('\n').find(l => l.startsWith('DIFY_TOKEN'))!
    expect(tokLine).toContain('<unset>')
  })

  it('text: rows are sorted alphabetically by name', () => {
    const out = runEnvList({ lookup: stub() })
    const lines = out.trim().split('\n').slice(1).map(l => l.split(/\s+/)[0])
    const sorted = [...lines].sort()
    expect(lines).toEqual(sorted)
  })

  it('json: emits array with name/description/sensitive/value fields', () => {
    const out = runEnvList({ json: true, lookup: stub({ DIFY_HOST: 'https://acme', DIFY_TOKEN: 'dfoa_x' }) })
    const parsed = JSON.parse(out) as Array<{ name: string, sensitive: boolean, value: string }>
    expect(parsed.length).toBeGreaterThan(0)
    const host = parsed.find(r => r.name === 'DIFY_HOST')!
    expect(host.sensitive).toBe(false)
    expect(host.value).toBe('https://acme')
    const tok = parsed.find(r => r.name === 'DIFY_TOKEN')!
    expect(tok.sensitive).toBe(true)
    expect(tok.value).toBe('<set>')
  })

  it('json: trailing newline matches Go encoder.Encode', () => {
    const out = runEnvList({ json: true, lookup: stub() })
    expect(out.endsWith('\n')).toBe(true)
  })
})
