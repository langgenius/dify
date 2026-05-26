import { describe, expect, it } from 'vitest'
import { runHelpAccount } from './account.js'

describe('runHelpAccount', () => {
  it('mentions auth login device flow', () => {
    expect(runHelpAccount()).toContain('difyctl auth login')
  })

  it('mentions get/describe/run app commands', () => {
    const out = runHelpAccount()
    expect(out).toContain('difyctl get app')
    expect(out).toContain('difyctl describe app')
    expect(out).toContain('difyctl run app')
  })

  it('mentions --workspace and env list pointers', () => {
    const out = runHelpAccount()
    expect(out).toContain('--workspace')
    expect(out).toContain('difyctl env list')
  })
})
