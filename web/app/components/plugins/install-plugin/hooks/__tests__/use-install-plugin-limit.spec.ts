import type { PluginInstallationScope } from '@dify/contracts/api/console/system-features/types.gen'
import { zPluginInstallationScope } from '@dify/contracts/api/console/system-features/zod.gen'
import { describe, expect, it } from 'vite-plus/test'
import { renderHookWithConsoleQuery as renderHook } from '@/test/console/query-data'
import { pluginInstallLimit } from '../use-install-plugin-limit'

type PluginInstallCandidate = Parameters<typeof pluginInstallLimit>[0]
type SystemFeatures = Parameters<typeof pluginInstallLimit>[1]

const basePlugin = {
  from: 'marketplace' as const,
  verification: { authorized_category: 'langgenius' },
} satisfies PluginInstallCandidate

function makeSystemFeatures(
  scope: PluginInstallationScope,
  restrictToMarketplaceOnly = false,
): SystemFeatures {
  return {
    plugin_installation_permission: {
      restrict_to_marketplace_only: restrictToMarketplaceOnly,
      plugin_installation_scope: scope,
    },
  }
}

describe('pluginInstallLimit', () => {
  it('should allow all plugins when scope is ALL', () => {
    const features = makeSystemFeatures(zPluginInstallationScope.enum.all)

    expect(pluginInstallLimit(basePlugin, features).canInstall).toBe(true)
  })

  it('should deny all plugins when scope is NONE', () => {
    const features = makeSystemFeatures(zPluginInstallationScope.enum.none)

    expect(pluginInstallLimit(basePlugin, features).canInstall).toBe(false)
  })

  it('should allow langgenius plugins when scope is OFFICIAL_ONLY', () => {
    const features = makeSystemFeatures(zPluginInstallationScope.enum.official_only)

    expect(pluginInstallLimit(basePlugin, features).canInstall).toBe(true)
  })

  it('should deny non-official plugins when scope is OFFICIAL_ONLY', () => {
    const features = makeSystemFeatures(zPluginInstallationScope.enum.official_only)
    const plugin = {
      ...basePlugin,
      verification: { authorized_category: 'community' as const },
    } satisfies PluginInstallCandidate

    expect(pluginInstallLimit(plugin, features).canInstall).toBe(false)
  })

  it('should allow partner plugins when scope is OFFICIAL_AND_PARTNER', () => {
    const features = makeSystemFeatures(
      zPluginInstallationScope.enum.official_and_specific_partners,
    )
    const plugin = {
      ...basePlugin,
      verification: { authorized_category: 'partner' as const },
    } satisfies PluginInstallCandidate

    expect(pluginInstallLimit(plugin, features).canInstall).toBe(true)
  })

  it('should deny github plugins when restrict_to_marketplace_only is true', () => {
    const features = makeSystemFeatures(zPluginInstallationScope.enum.all, true)
    const plugin = { ...basePlugin, from: 'github' as const } satisfies PluginInstallCandidate

    expect(pluginInstallLimit(plugin, features).canInstall).toBe(false)
  })

  it('should deny package plugins when restrict_to_marketplace_only is true', () => {
    const features = makeSystemFeatures(zPluginInstallationScope.enum.all, true)
    const plugin = { ...basePlugin, from: 'package' as const } satisfies PluginInstallCandidate

    expect(pluginInstallLimit(plugin, features).canInstall).toBe(false)
  })

  it('should allow marketplace plugins even when restrict_to_marketplace_only is true', () => {
    const features = makeSystemFeatures(zPluginInstallationScope.enum.all, true)

    expect(pluginInstallLimit(basePlugin, features).canInstall).toBe(true)
  })

  it('should default to langgenius when no verification info', () => {
    const features = makeSystemFeatures(zPluginInstallationScope.enum.official_only)
    const plugin = { from: 'marketplace' as const } satisfies PluginInstallCandidate

    expect(pluginInstallLimit(plugin, features).canInstall).toBe(true)
  })

  it('should deny installation for an unrecognized runtime scope', () => {
    const features = {
      plugin_installation_permission: {
        restrict_to_marketplace_only: false,
        plugin_installation_scope: 'unknown-scope',
      },
    } as unknown as SystemFeatures

    expect(pluginInstallLimit(basePlugin, features).canInstall).toBe(false)
  })
})

describe('usePluginInstallLimit', () => {
  it('should return canInstall from pluginInstallLimit using global store', async () => {
    const { default: usePluginInstallLimit } = await import('../use-install-plugin-limit')
    const plugin = {
      from: 'marketplace' as const,
      verification: { authorized_category: 'langgenius' },
    } satisfies PluginInstallCandidate

    const { result } = renderHook(() => usePluginInstallLimit(plugin))

    expect(result.current.canInstall).toBe(true)
  })
})
