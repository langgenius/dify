import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InstallationScope } from '@/types/feature'
import { pluginInstallLimit } from '../use-install-plugin-limit'

const mockSystemFeatures = {
  plugin_installation_permission: {
    restrict_to_marketplace_only: false,
    plugin_installation_scope: InstallationScope.ALL,
  },
}

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: typeof mockSystemFeatures }) => unknown) =>
    selector({ systemFeatures: mockSystemFeatures }),
}))

const basePlugin = {
  from: 'marketplace' as const,
  verification: { authorized_category: 'langgenius' },
}

describe('pluginInstallLimit', () => {
  it('should allow all plugins when scope is ALL', () => {
    const features = {
      plugin_installation_permission: {
        restrict_to_marketplace_only: false,
        plugin_installation_scope: InstallationScope.ALL,
      },
    }

    expect(pluginInstallLimit(basePlugin as never, features as never).canInstall).toBe(true)
  })

  it('should deny all plugins when scope is NONE', () => {
    const features = {
      plugin_installation_permission: {
        restrict_to_marketplace_only: false,
        plugin_installation_scope: InstallationScope.NONE,
      },
    }

    expect(pluginInstallLimit(basePlugin as never, features as never).canInstall).toBe(false)
  })

  it('should allow langgenius plugins when scope is OFFICIAL_ONLY', () => {
    const features = {
      plugin_installation_permission: {
        restrict_to_marketplace_only: false,
        plugin_installation_scope: InstallationScope.OFFICIAL_ONLY,
      },
    }

    expect(pluginInstallLimit(basePlugin as never, features as never).canInstall).toBe(true)
  })

  it('should deny non-official plugins when scope is OFFICIAL_ONLY', () => {
    const features = {
      plugin_installation_permission: {
        restrict_to_marketplace_only: false,
        plugin_installation_scope: InstallationScope.OFFICIAL_ONLY,
      },
    }
    const plugin = { ...basePlugin, verification: { authorized_category: 'community' } }

    expect(pluginInstallLimit(plugin as never, features as never).canInstall).toBe(false)
  })

  it('should allow partner plugins when scope is OFFICIAL_AND_PARTNER', () => {
    const features = {
      plugin_installation_permission: {
        restrict_to_marketplace_only: false,
        plugin_installation_scope: InstallationScope.OFFICIAL_AND_PARTNER,
      },
    }
    const plugin = { ...basePlugin, verification: { authorized_category: 'partner' } }

    expect(pluginInstallLimit(plugin as never, features as never).canInstall).toBe(true)
  })

  it('should deny github plugins when restrict_to_marketplace_only is true', () => {
    const features = {
      plugin_installation_permission: {
        restrict_to_marketplace_only: true,
        plugin_installation_scope: InstallationScope.ALL,
      },
    }
    const plugin = { ...basePlugin, from: 'github' as const }

    expect(pluginInstallLimit(plugin as never, features as never).canInstall).toBe(false)
  })

  it('should deny package plugins when restrict_to_marketplace_only is true', () => {
    const features = {
      plugin_installation_permission: {
        restrict_to_marketplace_only: true,
        plugin_installation_scope: InstallationScope.ALL,
      },
    }
    const plugin = { ...basePlugin, from: 'package' as const }

    expect(pluginInstallLimit(plugin as never, features as never).canInstall).toBe(false)
  })

  it('should allow marketplace plugins even when restrict_to_marketplace_only is true', () => {
    const features = {
      plugin_installation_permission: {
        restrict_to_marketplace_only: true,
        plugin_installation_scope: InstallationScope.ALL,
      },
    }

    expect(pluginInstallLimit(basePlugin as never, features as never).canInstall).toBe(true)
  })

  it('should default to langgenius when no verification info', () => {
    const features = {
      plugin_installation_permission: {
        restrict_to_marketplace_only: false,
        plugin_installation_scope: InstallationScope.OFFICIAL_ONLY,
      },
    }
    const plugin = { from: 'marketplace' as const }

    expect(pluginInstallLimit(plugin as never, features as never).canInstall).toBe(true)
  })

  it('should fallback to canInstall true for unrecognized scope', () => {
    const features = {
      plugin_installation_permission: {
        restrict_to_marketplace_only: false,
        plugin_installation_scope: 'unknown-scope' as InstallationScope,
      },
    }

    expect(pluginInstallLimit(basePlugin as never, features as never).canInstall).toBe(true)
  })
})

describe('usePluginInstallLimit', () => {
  it('should return canInstall from pluginInstallLimit using global store', async () => {
    const { default: usePluginInstallLimit } = await import('../use-install-plugin-limit')
    const plugin = { from: 'marketplace' as const, verification: { authorized_category: 'langgenius' } }

    const { result } = renderHook(() => usePluginInstallLimit(plugin as never))

    expect(result.current.canInstall).toBe(true)
  })
})
