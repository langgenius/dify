import { canEditApps, getDemoEndState, pickLatestApp } from '../end-state'

const enabled = { status: 'success', collaborationEnabled: true, upgradeAvailable: false } as const
const upgradable = {
  status: 'success',
  collaborationEnabled: false,
  upgradeAvailable: true,
} as const
const app = { id: 'app-1', name: 'Refund assistant', updated_at: 20 }
const loadedApps = { status: 'success', latest: app } as const
const pendingApps = { status: 'pending' } as const

describe('getDemoEndState', () => {
  it('holds the primary action while entitlements load', () => {
    expect(
      getDemoEndState({ features: { status: 'pending' }, role: 'owner', apps: pendingApps }),
    ).toEqual({ kind: 'loading' })
  })

  it('holds Try it now while the latest app loads', () => {
    expect(getDemoEndState({ features: enabled, role: 'owner', apps: pendingApps })).toEqual({
      kind: 'appsLoading',
    })
  })

  it.each(['owner', 'admin', 'editor'])('opens the latest app for %s', (role) => {
    expect(getDemoEndState({ features: enabled, role, apps: loadedApps })).toEqual({
      kind: 'tryNow',
      app,
    })
  })

  it('sends editors to Studio when the apps query fails', () => {
    expect(
      getDemoEndState({ features: enabled, role: 'editor', apps: { status: 'error' } }),
    ).toEqual({ kind: 'appsError' })
  })

  it('offers to create a workflow when the workspace has none', () => {
    expect(
      getDemoEndState({ features: enabled, role: 'owner', apps: { status: 'success' } }),
    ).toEqual({ kind: 'createApp' })
  })

  it('explains read-only roles before looking at apps', () => {
    expect(getDemoEndState({ features: enabled, role: 'normal', apps: pendingApps })).toEqual({
      kind: 'readOnly',
      role: 'normal',
    })
    expect(
      getDemoEndState({ features: enabled, role: 'dataset_operator', apps: loadedApps }),
    ).toEqual({ kind: 'readOnly', role: 'datasetOperator' })
  })

  it('offers upgrade only to billing managers', () => {
    expect(getDemoEndState({ features: upgradable, role: 'admin', apps: pendingApps })).toEqual({
      kind: 'upgrade',
    })
    expect(getDemoEndState({ features: upgradable, role: 'editor', apps: pendingApps })).toEqual({
      kind: 'upgradeContactAdmin',
    })
  })

  it('falls back to the workspace when collaboration is unavailable', () => {
    expect(
      getDemoEndState({ features: { status: 'error' }, role: 'owner', apps: pendingApps }),
    ).toEqual({ kind: 'unavailable' })
    expect(
      getDemoEndState({
        features: { status: 'success', collaborationEnabled: false, upgradeAvailable: false },
        role: 'owner',
        apps: pendingApps,
      }),
    ).toEqual({ kind: 'unavailable' })
  })
})

describe('pickLatestApp', () => {
  it('picks the most recently modified workflow or chatflow', () => {
    const chatflow = { id: 'chatflow', name: 'Chatflow', updated_at: 30 }
    expect(pickLatestApp(app, chatflow)).toBe(chatflow)
    expect(pickLatestApp(app, undefined)).toBe(app)
    expect(pickLatestApp(undefined, undefined)).toBeUndefined()
  })
})

describe('canEditApps', () => {
  it('allows only roles that edit every app in the workspace', () => {
    expect(['owner', 'admin', 'editor', 'normal', 'dataset_operator'].map(canEditApps)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ])
  })
})
