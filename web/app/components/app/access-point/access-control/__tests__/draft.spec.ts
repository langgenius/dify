import { ACCESS_POINT_ORDER } from '@/app/components/app/deploy/utils/access-point'
import {
  policyIncludesIp,
  splitPolicySummary,
} from '@/app/components/header/account-setting/ip-policies-page/validate-ip-entry'
import {
  canSaveAccessControl,
  createDefaultAccessControlDraft,
  isAccessControlDraftEqual,
} from '../draft'

const selectedDraft = {
  ...createDefaultAccessControlDraft(ACCESS_POINT_ORDER),
  selectedPolicyId: 'policy-1',
}

describe('canSaveAccessControl', () => {
  it('disables save when no policy is selected', () => {
    expect(
      canSaveAccessControl({
        availableAccessPoints: ACCESS_POINT_ORDER,
        draft: createDefaultAccessControlDraft(ACCESS_POINT_ORDER),
      }),
    ).toBe(false)
  })

  it('disables save when every access point is off', () => {
    expect(
      canSaveAccessControl({
        availableAccessPoints: ACCESS_POINT_ORDER,
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
    expect(
      canSaveAccessControl({ availableAccessPoints: ACCESS_POINT_ORDER, draft: selectedDraft }),
    ).toBe(true)
  })

  it('counts trigger as a selectable access point', () => {
    expect(
      canSaveAccessControl({
        availableAccessPoints: ACCESS_POINT_ORDER,
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
          scopes: { webApp: false, serviceApi: false, mcp: false, trigger: true },
        },
        availableAccessPoints: [],
      }),
    ).toBe(false)
  })

  it('disables save when the draft matches the saved baseline', () => {
    expect(
      canSaveAccessControl({
        availableAccessPoints: ACCESS_POINT_ORDER,
        draft: selectedDraft,
        baseline: selectedDraft,
      }),
    ).toBe(false)
  })

  it('allows saving a pause when a policy is already selected', () => {
    expect(
      canSaveAccessControl({
        availableAccessPoints: ACCESS_POINT_ORDER,
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

describe('available access points', () => {
  it.each([
    { available: ['webApp', 'serviceApi', 'mcp', 'trigger'] as const, selected: 4 },
    { available: ['webApp', 'serviceApi', 'mcp'] as const, selected: 3 },
    { available: ['webApp', 'serviceApi'] as const, selected: 2 },
  ])('defaults to $selected supported scopes', ({ available, selected }) => {
    const draft = createDefaultAccessControlDraft(available)
    expect(Object.values(draft.scopes).filter(Boolean)).toHaveLength(selected)
    available.forEach((scope) => expect(draft.scopes[scope]).toBe(true))
  })

  it('ignores unsupported scope differences when checking for edits', () => {
    const baseline = createDefaultAccessControlDraft(['webApp', 'serviceApi'])
    expect(
      isAccessControlDraftEqual(
        baseline,
        {
          ...baseline,
          scopes: { ...baseline.scopes, mcp: true, trigger: true },
        },
        ['webApp', 'serviceApi'],
      ),
    ).toBe(true)
  })

  it('does not count an unsupported trigger selection toward a valid binding', () => {
    const draft = {
      ...selectedDraft,
      scopes: { webApp: false, serviceApi: false, mcp: false, trigger: true },
    }
    expect(
      canSaveAccessControl({ draft, availableAccessPoints: ['webApp', 'serviceApi', 'mcp'] }),
    ).toBe(false)
  })
})
