import { describe, expect, it, vi } from 'vitest'
import { pluginInstallLimit } from '@/app/components/plugins/install-plugin/hooks/use-install-plugin-limit'
import { InstallationScope } from '@/types/feature'

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: () => ({
    plugin_installation_permission: {
      restrict_to_marketplace_only: false,
      plugin_installation_scope: InstallationScope.ALL,
    },
  }),
}))

describe('Plugin Marketplace to Install Flow', () => {
  describe('install permission validation pipeline', () => {
    const systemFeaturesAll = {
      plugin_installation_permission: {
        restrict_to_marketplace_only: false,
        plugin_installation_scope: InstallationScope.ALL,
      },
    }

    const systemFeaturesMarketplaceOnly = {
      plugin_installation_permission: {
        restrict_to_marketplace_only: true,
        plugin_installation_scope: InstallationScope.ALL,
      },
    }

    const systemFeaturesOfficialOnly = {
      plugin_installation_permission: {
        restrict_to_marketplace_only: false,
        plugin_installation_scope: InstallationScope.OFFICIAL_ONLY,
      },
    }

    it('should allow marketplace plugin when all sources allowed', () => {
      const plugin = { from: 'marketplace' as const, verification: { authorized_category: 'langgenius' } }
      const result = pluginInstallLimit(plugin as never, systemFeaturesAll as never)
      expect(result.canInstall).toBe(true)
    })

    it('should allow github plugin when all sources allowed', () => {
      const plugin = { from: 'github' as const, verification: { authorized_category: 'langgenius' } }
      const result = pluginInstallLimit(plugin as never, systemFeaturesAll as never)
      expect(result.canInstall).toBe(true)
    })

    it('should block github plugin when marketplace only', () => {
      const plugin = { from: 'github' as const, verification: { authorized_category: 'langgenius' } }
      const result = pluginInstallLimit(plugin as never, systemFeaturesMarketplaceOnly as never)
      expect(result.canInstall).toBe(false)
    })

    it('should allow marketplace plugin when marketplace only', () => {
      const plugin = { from: 'marketplace' as const, verification: { authorized_category: 'partner' } }
      const result = pluginInstallLimit(plugin as never, systemFeaturesMarketplaceOnly as never)
      expect(result.canInstall).toBe(true)
    })

    it('should allow official plugin when official only', () => {
      const plugin = { from: 'marketplace' as const, verification: { authorized_category: 'langgenius' } }
      const result = pluginInstallLimit(plugin as never, systemFeaturesOfficialOnly as never)
      expect(result.canInstall).toBe(true)
    })

    it('should block community plugin when official only', () => {
      const plugin = { from: 'marketplace' as const, verification: { authorized_category: 'community' } }
      const result = pluginInstallLimit(plugin as never, systemFeaturesOfficialOnly as never)
      expect(result.canInstall).toBe(false)
    })
  })

  describe('plugin source classification', () => {
    it('should correctly classify plugin install sources', () => {
      const sources = ['marketplace', 'github', 'package'] as const
      const features = {
        plugin_installation_permission: {
          restrict_to_marketplace_only: true,
          plugin_installation_scope: InstallationScope.ALL,
        },
      }

      const results = sources.map(source => ({
        source,
        canInstall: pluginInstallLimit(
          { from: source, verification: { authorized_category: 'langgenius' } } as never,
          features as never,
        ).canInstall,
      }))

      expect(results.find(r => r.source === 'marketplace')?.canInstall).toBe(true)
      expect(results.find(r => r.source === 'github')?.canInstall).toBe(false)
      expect(results.find(r => r.source === 'package')?.canInstall).toBe(false)
    })
  })
})
