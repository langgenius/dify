import {
  policyIncludesIp,
  splitPolicySummary,
} from '@/app/components/header/account-setting/ip-policies-page/validate-ip-entry'
import { canSaveAccessControl, createDefaultAccessControlDraft } from '../draft'

const selectedDraft = {
  ...createDefaultAccessControlDraft(),
  selectedPolicyId: 'policy-1',
}

describe('canSaveAccessControl', () => {
  it('disables save when no policy is selected', () => {
    expect(canSaveAccessControl({ draft: createDefaultAccessControlDraft() })).toBe(false)
  })

  it('disables save when every access point is off', () => {
    expect(
      canSaveAccessControl({
        draft: {
          selectedPolicyId: 'policy-1',
          enabled: true,
          scopes: {
            webApp: false,
            serviceApi: false,
            mcp: false,
            trigger: false,
          },
        },
      }),
    ).toBe(false)
  })

  it('enables save when a policy is selected and at least one access point is on', () => {
    expect(canSaveAccessControl({ draft: selectedDraft })).toBe(true)
  })

  it('counts trigger as a selectable access point', () => {
    expect(
      canSaveAccessControl({
        draft: {
          selectedPolicyId: 'policy-1',
          enabled: true,
          scopes: {
            webApp: false,
            serviceApi: false,
            mcp: false,
            trigger: true,
          },
        },
      }),
    ).toBe(true)
  })

  it('does not enable save when none of the selected access points can be persisted', () => {
    expect(
      canSaveAccessControl({
        draft: {
          selectedPolicyId: 'policy-1',
          enabled: true,
          scopes: {
            webApp: false,
            serviceApi: false,
            mcp: false,
            trigger: true,
          },
        },
        persistableAccessPoints: [],
      }),
    ).toBe(false)
  })

  it('disables save when the draft matches the saved baseline', () => {
    expect(
      canSaveAccessControl({
        draft: selectedDraft,
        baseline: selectedDraft,
      }),
    ).toBe(false)
  })

  it('allows saving a pause when a policy is already selected', () => {
    expect(
      canSaveAccessControl({
        draft: { ...selectedDraft, enabled: false },
        baseline: selectedDraft,
      }),
    ).toBe(true)
  })
})

describe('splitPolicySummary', () => {
  it('keeps one or two addresses listed', () => {
    expect(splitPolicySummary(['203.0.113.42'])).toEqual({
      listed: ['203.0.113.42'],
      moreCount: 0,
    })
    expect(splitPolicySummary(['203.0.113.42', '198.51.100.0/24'])).toEqual({
      listed: ['203.0.113.42', '198.51.100.0/24'],
      moreCount: 0,
    })
  })

  it('summarizes additional addresses after the first two', () => {
    expect(
      splitPolicySummary(['203.0.113.42', '198.51.100.0/24', '192.0.2.1', '192.0.2.2']),
    ).toEqual({
      listed: ['203.0.113.42', '198.51.100.0/24'],
      moreCount: 2,
    })
  })
})

describe('policyIncludesIp', () => {
  it('matches an exact address and a covering CIDR', () => {
    expect(policyIncludesIp(['203.0.113.42', '198.51.100.0/24'], '203.0.113.42')).toBe(true)
    expect(policyIncludesIp(['198.51.100.0/24'], '198.51.100.20')).toBe(true)
  })

  it('does not match an address outside the policy', () => {
    expect(policyIncludesIp(['198.51.100.0/24'], '203.0.113.42')).toBe(false)
  })
})
