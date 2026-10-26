'use client'

import type { Dependency, PluginDeclaration, PluginManifestInMarket } from '../../types'
import { useEffect, useState } from 'react'
import { parseMarketplacePluginId } from '@/app/components/plugins/plugin-routes'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { usePluginInstallation } from '@/hooks/use-query-params'
import {
  fetchBundleInfoFromMarketPlace,
  fetchManifestFromMarketPlace,
  fetchPluginInfoFromMarketPlace,
} from '@/service/plugins'

type MarketplaceInstall = {
  manifest: PluginDeclaration | PluginManifestInMarket
  packageId: string
  uniqueIdentifier: string
}

async function resolveMarketplaceUniqueIdentifier(packageId: string) {
  const pluginId = parseMarketplacePluginId(packageId)
  if (!pluginId) return packageId

  const { data } = await fetchPluginInfoFromMarketPlace(pluginId)
  return data.plugin.latest_package_identifier
}

export type UseInstallFromMarketplaceQueryOptions = {
  canInstallPlugin: boolean
  isPermissionLoading?: boolean
  onPackageCategoryResolved?: (category: string | undefined, packageId: string) => boolean
}

export const useInstallFromMarketplaceQuery = ({
  canInstallPlugin,
  isPermissionLoading = false,
  onPackageCategoryResolved,
}: UseInstallFromMarketplaceQueryOptions) => {
  const [{ packageId, bundleInfo }, setInstallState] = usePluginInstallation()
  const [marketplaceInstall, setMarketplaceInstall] = useState<MarketplaceInstall | null>(null)
  const [dependencies, setDependencies] = useState<Dependency[]>([])
  const [isShowInstallFromMarketplace, setIsShowInstallFromMarketplace] = useState(false)

  useEffect(() => {
    if (!packageId && !bundleInfo) return

    if (isPermissionLoading) return

    if (!canInstallPlugin) {
      setInstallState(null)
      return
    }

    let ignore = false

    const loadMarketplaceInstall = async () => {
      if (packageId) {
        try {
          const uniqueIdentifier = await resolveMarketplaceUniqueIdentifier(packageId)
          const { data } = await fetchManifestFromMarketPlace(encodeURIComponent(uniqueIdentifier))
          if (ignore) return

          const { plugin, version } = data
          const redirected = onPackageCategoryResolved?.(plugin.category, packageId)
          if (redirected) return

          setMarketplaceInstall({
            packageId,
            uniqueIdentifier,
            manifest: {
              ...plugin,
              version: version.version,
              icon: `${MARKETPLACE_API_PREFIX}/plugins/${plugin.org}/${plugin.name}/icon`,
            },
          })
          setIsShowInstallFromMarketplace(true)
        } catch (error) {
          if (!ignore) console.error('Failed to load marketplace plugin manifest:', error)
        }
        return
      }

      if (bundleInfo) {
        try {
          const { data } = await fetchBundleInfoFromMarketPlace(bundleInfo)
          if (ignore) return

          setDependencies(data.version.dependencies)
          setIsShowInstallFromMarketplace(true)
        } catch (error) {
          if (!ignore) console.error('Failed to load bundle info:', error)
        }
      }
    }

    loadMarketplaceInstall()

    return () => {
      ignore = true
    }
  }, [
    bundleInfo,
    canInstallPlugin,
    isPermissionLoading,
    onPackageCategoryResolved,
    packageId,
    setInstallState,
  ])

  const hideInstallFromMarketplace = () => {
    setMarketplaceInstall(null)
    setDependencies([])
    setIsShowInstallFromMarketplace(false)
    setInstallState(null)
  }

  return {
    bundleInfo,
    dependencies,
    hideInstallFromMarketplace,
    isShowInstallFromMarketplace,
    marketplaceInstall: marketplaceInstall?.packageId === packageId ? marketplaceInstall : null,
  }
}
