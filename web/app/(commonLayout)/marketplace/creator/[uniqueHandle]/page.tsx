import { loadCreatorProfile } from '@/app/components/plugins/marketplace/creator-profile/data.server'
import DifyCreatorProfile from '@/app/components/plugins/marketplace/creator-profile/dify-profile'
import MarketplaceInstallPermissionProvider from '@/app/components/plugins/marketplace/marketplace-install-permission-provider'
import { getLocaleOnServer } from '@/i18n-config/server'
import { notFound } from '@/next/navigation'

type CreatorPageSearchParams = {
  publisher_type?: string
}

export default async function CreatorProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ uniqueHandle: string }>
  searchParams: Promise<CreatorPageSearchParams>
}) {
  const [{ uniqueHandle }, query, locale] = await Promise.all([
    params,
    searchParams,
    getLocaleOnServer(),
  ])
  const loadedProfile = await loadCreatorProfile({
    uniqueHandle,
    publisherType: query.publisher_type,
    locale,
  })

  if (!loadedProfile) notFound()

  return (
    <div
      id="marketplace-container"
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-background-default"
    >
      <MarketplaceInstallPermissionProvider>
        <DifyCreatorProfile loadedProfile={loadedProfile} locale={locale} />
      </MarketplaceInstallPermissionProvider>
    </div>
  )
}
