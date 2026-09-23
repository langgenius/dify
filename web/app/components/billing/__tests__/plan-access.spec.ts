import { canAccessSnippetsAndEvaluation } from '../plan-access'

describe('snippet and evaluation plan access', () => {
  it('allows self-hosted editions', () => {
    expect(canAccessSnippetsAndEvaluation({ deploymentEdition: 'COMMUNITY' })).toBe(true)
  })

  it.each(['professional', 'team'] as const)('allows the %s cloud plan', (planType) => {
    expect(canAccessSnippetsAndEvaluation({ deploymentEdition: 'CLOUD', planType })).toBe(true)
  })

  it('blocks sandbox and missing cloud plans', () => {
    expect(canAccessSnippetsAndEvaluation({ deploymentEdition: 'CLOUD', planType: 'sandbox' })).toBe(false)
    expect(canAccessSnippetsAndEvaluation({ deploymentEdition: 'CLOUD' })).toBe(false)
  })
})
