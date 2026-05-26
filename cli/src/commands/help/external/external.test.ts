import { describe, expect, it } from 'vitest'
import { runHelpExternal } from './external.js'

describe('runHelpExternal', () => {
  it('mentions external bearer prefix and login flag', () => {
    const out = runHelpExternal()
    expect(out).toContain('dfoe_')
    expect(out).toContain('--external')
    expect(out).toContain('DIFY_TOKEN')
  })

  it('explains workspace empty-list expectation', () => {
    expect(runHelpExternal()).toContain('get workspace')
  })
})
