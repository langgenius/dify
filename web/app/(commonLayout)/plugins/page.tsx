import type { LegacyPluginsSearchParams } from '@/app/components/plugins/plugin-routes'
import {
  getFirstPackageIdFromSearchParams,
  getInstallRedirectPathByPluginCategory,
  getInstallRedirectPathFromSearchParams,
  getLegacyPluginRedirectPath,
  shouldResolveInstallCategoryRedirect,
} from '@/app/components/plugins/plugin-routes'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { redirect } from '@/next/navigation'

type PluginListProps = {
  searchParams?: Promise<LegacyPluginsSearchParams>
}

type MarketplaceManifestCategoryResponse = {
  data?: {
    plugin?: {
      category?: string
    }
  }
}

const fetchPluginCategoryFromMarketplace = async (packageId: string) => {
  try {
    const response = await fetch(
      `${MARKETPLACE_API_PREFIX}/plugins/identifier?unique_identifier=${encodeURIComponent(packageId)}`,
      { cache: 'no-store' },
    )

    if (!response.ok) return undefined

    const payload = (await response.json()) as MarketplaceManifestCategoryResponse
    return payload.data?.plugin?.category
  } catch {
    return undefined
  }
}

const PluginList = async ({ searchParams }: PluginListProps) => {
  const resolvedSearchParams = (await searchParams) ?? {}
  const installRedirectPathFromSearchParams =
    getInstallRedirectPathFromSearchParams(resolvedSearchParams)

  if (installRedirectPathFromSearchParams) redirect(installRedirectPathFromSearchParams)

  if (shouldResolveInstallCategoryRedirect(resolvedSearchParams)) {
    const packageId = getFirstPackageIdFromSearchParams(resolvedSearchParams)
    const category = packageId ? await fetchPluginCategoryFromMarketplace(packageId) : undefined
    const installRedirectPath = getInstallRedirectPathByPluginCategory(
      category,
      resolvedSearchParams,
    )

    if (installRedirectPath) redirect(installRedirectPath)
  }

  const redirectPath = getLegacyPluginRedirectPath(resolvedSearchParams)

  redirect(redirectPath)
}

export default PluginList
