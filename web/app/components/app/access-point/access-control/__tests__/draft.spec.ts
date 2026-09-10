import {
  policyIncludesIp,
  splitPolicySummary,
} from '@/app/components/header/account-setting/ip-policies-page/validate-ip-entry'
import { AppModeEnum } from '@/types/app'
import {
  canSaveAccessControl,
  createDefaultAccessControlDraft,
  getAccessControlScopeAvailability,
  getAccessControlScopeSupport,
} from '../draft'

const allScopesAvailable = {
  webApp: true,
  serviceApi: true,
  mcp: true,
  trigger: true,
}

const selectedDraft = {
  ...createDefaultAccessControlDraft(),
  selectedPolicyId: 'policy-1',
}

describe('canSaveAccessControl', () => {
  it('disables save when no policy is selected', () => {
    expect(
      canSaveAccessControl({
        draft: createDefaultAccessControlDraft(),
        availability: { ...allScopesAvailable, trigger: false },
      }),
    ).toBe(false)
  })

  it('disables save when every protectable access point is off', () => {
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
        availability: { ...allScopesAvailable, trigger: false },
      }),
    ).toBe(false)
  })

  it('enables save when a policy is selected and at least one access point is on', () => {
    expect(
      canSaveAccessControl({
        draft: selectedDraft,
        availability: { ...allScopesAvailable, trigger: false },
      }),
    ).toBe(true)
  })

  it('counts an enabled trigger only when that access point is available', () => {
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
        availability: allScopesAvailable,
      }),
    ).toBe(true)
  })

  it('does not count an unavailable MCP server toward save', () => {
    expect(
      canSaveAccessControl({
        draft: {
          selectedPolicyId: 'policy-1',
          enabled: true,
          scopes: {
            webApp: false,
            serviceApi: false,
            mcp: true,
            trigger: false,
          },
        },
        availability: { ...allScopesAvailable, mcp: false, trigger: false },
      }),
    ).toBe(false)
  })

  it('disables save when the draft matches the saved baseline', () => {
    expect(
      canSaveAccessControl({
        draft: selectedDraft,
        availability: { ...allScopesAvailable, trigger: false },
        baseline: selectedDraft,
      }),
    ).toBe(false)
  })

  it('allows saving a pause when a policy is already selected', () => {
    expect(
      canSaveAccessControl({
        draft: { ...selectedDraft, enabled: false },
        availability: { ...allScopesAvailable, trigger: false },
        baseline: selectedDraft,
      }),
    ).toBe(true)
  })
})

describe('getAccessControlScopeSupport', () => {
  it('lets workflow apps apply to every access point', () => {
    expect(getAccessControlScopeSupport(AppModeEnum.WORKFLOW)).toEqual({
      webApp: true,
      serviceApi: true,
      mcp: true,
      trigger: true,
    })
  })

  it('lets agent apps apply only to Web App and Backend Service API', () => {
    expect(getAccessControlScopeSupport(AppModeEnum.AGENT)).toEqual({
      webApp: true,
      serviceApi: true,
      mcp: false,
      trigger: false,
    })
  })

  it.each([
    AppModeEnum.ADVANCED_CHAT,
    AppModeEnum.CHAT,
    AppModeEnum.COMPLETION,
    AppModeEnum.AGENT_CHAT,
  ])('does not let %s apps apply to Trigger', (mode) => {
    expect(getAccessControlScopeSupport(mode)).toEqual({
      webApp: true,
      serviceApi: true,
      mcp: true,
      trigger: false,
    })
  })
})

describe('getAccessControlScopeAvailability', () => {
  it('keeps workflow Trigger off until a published trigger node exists', () => {
    expect(
      getAccessControlScopeAvailability({
        mode: AppModeEnum.WORKFLOW,
        hasTriggerNode: false,
        isUnpublished: false,
      }).trigger,
    ).toBe(false)
    expect(
      getAccessControlScopeAvailability({
        mode: AppModeEnum.WORKFLOW,
        hasTriggerNode: true,
        isUnpublished: true,
      }).trigger,
    ).toBe(false)
    expect(
      getAccessControlScopeAvailability({
        mode: AppModeEnum.WORKFLOW,
        hasTriggerNode: true,
        isUnpublished: false,
      }).trigger,
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
