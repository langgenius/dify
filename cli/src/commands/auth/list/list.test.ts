import { describe, expect, it } from 'vitest'
import { Registry } from '@/auth/hosts'
import { stringifyOutput, table } from '@/framework/output'
import { runAuthList } from './list'

function twoHostReg(): Registry {
  return Registry.from({
    token_storage: 'keychain',
    current_host: 'cloud.dify.ai',
    hosts: {
      'cloud.dify.ai': {
        current_account: 'alice@corp.com',
        accounts: {
          'alice@corp.com': {
            account: { id: 'acct-1', email: 'alice@corp.com', name: 'Alice' },
          },
          'bob@corp.com': {
            account: { id: 'acct-2', email: 'bob@corp.com', name: 'Bob' },
          },
        },
      },
      'other.dify.ai': {
        current_account: 'admin@other.com',
        accounts: {
          'admin@other.com': {
            account: { id: 'acct-3', email: 'admin@other.com', name: 'Admin' },
          },
        },
      },
    },
  })
}

describe('runAuthList', () => {
  it('returns all host+account pairs', () => {
    const result = runAuthList(twoHostReg())
    expect(result.rows).toHaveLength(3)
  })

  it('marks only the active context', () => {
    const result = runAuthList(twoHostReg())
    const active = result.rows.filter((r) => r.active)
    expect(active).toHaveLength(1)
    expect(active[0]!.host).toBe('cloud.dify.ai')
    expect(active[0]!.account).toBe('alice@corp.com')
  })

  it('table: renders HOST ACCOUNT ACTIVE header', () => {
    const out = stringifyOutput(table({ format: '', data: runAuthList(twoHostReg()) }))
    expect(out).toMatch(/HOST\s+ACCOUNT\s+ACTIVE/)
    expect(out).toContain('cloud.dify.ai')
    expect(out).toContain('alice@corp.com')
    expect(out).toContain('other.dify.ai')
  })

  it('table: marks active row with *', () => {
    const out = stringifyOutput(table({ format: '', data: runAuthList(twoHostReg()) }))
    const lines = out.trim().split('\n')
    const activeLine = lines.find((l) => l.includes('alice@corp.com'))!
    expect(activeLine).toContain('*')
    const inactiveLine = lines.find((l) => l.includes('bob@corp.com'))!
    expect(inactiveLine).not.toContain('*')
  })

  it('json: emits { contexts: [...] }', () => {
    const out = stringifyOutput(table({ format: 'json', data: runAuthList(twoHostReg()) }))
    const parsed = JSON.parse(out) as {
      contexts: Array<{ host: string; account: string; active: boolean }>
    }
    expect(parsed.contexts).toHaveLength(3)
    const activeCtx = parsed.contexts.find((c) => c.active)!
    expect(activeCtx.host).toBe('cloud.dify.ai')
    expect(activeCtx.account).toBe('alice@corp.com')
  })

  it('name: emits account emails one per line', () => {
    const out = stringifyOutput(table({ format: 'name', data: runAuthList(twoHostReg()) }))
    const lines = out.trim().split('\n').sort()
    expect(lines).toContain('alice@corp.com')
    expect(lines).toContain('admin@other.com')
    expect(lines).toContain('bob@corp.com')
  })

  it('table: shows email (Name) when display name present', () => {
    const out = stringifyOutput(table({ format: '', data: runAuthList(twoHostReg()) }))
    expect(out).toContain('alice@corp.com (Alice)')
  })

  it('table: shows email only when display name absent', () => {
    const reg = Registry.from({
      token_storage: 'file',
      current_host: 'cloud.dify.ai',
      hosts: {
        'cloud.dify.ai': {
          current_account: 'anon@corp.com',
          accounts: {
            'anon@corp.com': { account: { id: 'x', email: 'anon@corp.com', name: '' } },
          },
        },
      },
    })
    const out = stringifyOutput(table({ format: '', data: runAuthList(reg) }))
    expect(out).toContain('anon@corp.com')
    expect(out).not.toContain('anon@corp.com (')
  })

  it('empty registry: returns zero rows', () => {
    const result = runAuthList(Registry.empty())
    expect(result.rows).toHaveLength(0)
  })
})
