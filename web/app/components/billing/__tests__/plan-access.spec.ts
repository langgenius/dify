import { canAccessSnippetsAndEvaluation } from '../plan-access'

describe('snippet and evaluation plan access', () => {
  it('blocks the community edition', () => {
    expect(canAccessSnippetsAndEvaluation({ deploymentEdition: 'COMMUNITY' })).toBe(false)
  })

  it('allows the enterprise edition', () => {
    expect(canAccessSnippetsAndEvaluation({ deploymentEdition: 'ENTERPRISE' })).toBe(true)
  })

  it.each(['professional', 'team'] as const)('allows the %s cloud plan', (planType) => {
    expect(canAccessSnippetsAndEvaluation({ deploymentEdition: 'CLOUD', planType })).toBe(true)
  })

  it('blocks sandbox and missing cloud plans', () => {
    expect(
      canAccessSnippetsAndEvaluation({ deploymentEdition: 'CLOUD', planType: 'sandbox' }),
    ).toBe(false)
    expect(canAccessSnippetsAndEvaluation({ deploymentEdition: 'CLOUD' })).toBe(false)
  })
})
