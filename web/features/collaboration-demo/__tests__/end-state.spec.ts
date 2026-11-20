import { getDemoEndState, getTryNowHref } from '../end-state'

const enabled = { status: 'success', collaborationEnabled: true, upgradeAvailable: false } as const
const upgradable = {
  status: 'success',
  collaborationEnabled: false,
  upgradeAvailable: true,
} as const

describe('getDemoEndState', () => {
  it('holds the primary action while entitlements load', () => {
    expect(
      getDemoEndState({
        features: { status: 'pending' },
        role: 'owner',
        hasCollaborativeApps: undefined,
      }),
    ).toBe('loading')
    expect(
      getDemoEndState({ features: enabled, role: 'owner', hasCollaborativeApps: undefined }),
    ).toBe('loading')
  })

  it('sends collaborators with apps to try it', () => {
    expect(getDemoEndState({ features: enabled, role: 'normal', hasCollaborativeApps: true })).toBe(
      'tryNow',
    )
  })

  it('lets creators create an app when none are available', () => {
    expect(
      getDemoEndState({ features: enabled, role: 'editor', hasCollaborativeApps: false }),
    ).toBe('createApp')
    expect(
      getDemoEndState({ features: enabled, role: 'normal', hasCollaborativeApps: false }),
    ).toBe('noApps')
  })

  it('explains that dataset operators cannot edit apps', () => {
    expect(
      getDemoEndState({ features: enabled, role: 'dataset_operator', hasCollaborativeApps: true }),
    ).toBe('noAccess')
  })

  it('offers upgrade only to billing managers', () => {
    expect(
      getDemoEndState({ features: upgradable, role: 'admin', hasCollaborativeApps: undefined }),
    ).toBe('upgrade')
    expect(
      getDemoEndState({ features: upgradable, role: 'editor', hasCollaborativeApps: undefined }),
    ).toBe('upgradeContactAdmin')
  })

  it('falls back to the workspace when entitlements are unavailable', () => {
    expect(
      getDemoEndState({
        features: { status: 'error' },
        role: 'owner',
        hasCollaborativeApps: undefined,
      }),
    ).toBe('unavailable')
    expect(
      getDemoEndState({
        features: { status: 'success', collaborationEnabled: false, upgradeAvailable: false },
        role: 'owner',
        hasCollaborativeApps: undefined,
      }),
    ).toBe('unavailable')
  })
})

describe('getTryNowHref', () => {
  it('filters Studio to the only collaborative app type the workspace has', () => {
    expect(getTryNowHref({ workflows: 2, chatflows: 0 })).toBe('/apps?category=workflow')
    expect(getTryNowHref({ workflows: 0, chatflows: 3 })).toBe('/apps?category=advanced-chat')
  })

  it('shows every app when both workflow and chatflow apps exist', () => {
    expect(getTryNowHref({ workflows: 1, chatflows: 1 })).toBe('/apps')
  })
})
