'use client'

import type { PluginCategoryEnum, PluginManifestInMarket } from '../types'
import type { UseInstallFromMarketplaceQueryOptions } from './hooks/use-install-from-marketplace-query'
import { useInstallFromMarketplaceQuery as useInstallFromMarketplaceQueryHook } from './hooks/use-install-from-marketplace-query'
import InstallFromMarketplace from './install-from-marketplace'

type InstallFromMarketplaceQueryProps = UseInstallFromMarketplaceQueryOptions & {
  installContextCategory?: PluginCategoryEnum
}

const InstallFromMarketplaceQuery = ({
  installContextCategory,
  ...options
}: InstallFromMarketplaceQueryProps) => {
  const {
    bundleInfo,
    dependencies,
    hideInstallFromMarketplace,
    isShowInstallFromMarketplace,
    marketplaceInstall,
  } = useInstallFromMarketplaceQueryHook(options)

  if (!isShowInstallFromMarketplace)
    return null

  if (!marketplaceInstall && !bundleInfo)
    return null

  return (
    <InstallFromMarketplace
      manifest={marketplaceInstall?.manifest as PluginManifestInMarket}
      uniqueIdentifier={marketplaceInstall?.uniqueIdentifier ?? ''}
      isBundle={!!bundleInfo}
      dependencies={dependencies}
      installContextCategory={installContextCategory}
      onClose={hideInstallFromMarketplace}
      onSuccess={hideInstallFromMarketplace}
    />
  )
}

export default InstallFromMarketplaceQuery
