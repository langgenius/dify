import { getDemoEndState } from '../end-state'

const enabled = { status: 'success', collaborationEnabled: true, upgradeAvailable: false } as const
const upgradable = {
  status: 'success',
  collaborationEnabled: false,
  upgradeAvailable: true,
} as const

describe('getDemoEndState', () => {
  it('holds the primary action while entitlements load', () => {
    expect(getDemoEndState({ features: { status: 'pending' }, canManageBilling: true })).toEqual({
      kind: 'loading',
    })
  })

  it('offers Studio to members of a workspace with collaboration', () => {
    expect(getDemoEndState({ features: enabled, canManageBilling: false })).toEqual({
      kind: 'enabled',
    })
  })

  it('offers upgrade only to billing managers', () => {
    expect(getDemoEndState({ features: upgradable, canManageBilling: true })).toEqual({
      kind: 'upgrade',
    })
    expect(getDemoEndState({ features: upgradable, canManageBilling: false })).toEqual({
      kind: 'upgradeContactAdmin',
    })
  })

  it('falls back to the workspace when collaboration is unavailable', () => {
    expect(getDemoEndState({ features: { status: 'error' }, canManageBilling: true })).toEqual({
      kind: 'unavailable',
    })
    expect(
      getDemoEndState({
        features: { status: 'success', collaborationEnabled: false, upgradeAvailable: false },
        canManageBilling: true,
      }),
    ).toEqual({ kind: 'unavailable' })
  })
})
