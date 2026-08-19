import { loadCreatorProfile } from '@/app/components/plugins/marketplace/creator-profile/data.server'
import DifyCreatorProfile from '@/app/components/plugins/marketplace/creator-profile/dify-profile'
import MarketplaceInstallPermissionProvider from '@/app/components/plugins/marketplace/marketplace-install-permission-provider'
import { getLocaleOnServer } from '@/i18n-config/server'
import { notFound } from '@/next/navigation'

type CreatorPageSearchParams = {
  publisher_type?: string
}

type CreatorProfilePageProps = {
  params: Promise<{ uniqueHandle: string }>
  searchParams: Promise<CreatorPageSearchParams>
}

// Keep the route module synchronous. An async page under the client console
// shell makes Flight double-resolve this segment (`reason.enqueueModel`).
export default function CreatorProfilePage(props: CreatorProfilePageProps) {
  return (
    <div
      id="marketplace-container"
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-background-default"
    >
      <CreatorProfileContent {...props} />
    </div>
  )
}

async function CreatorProfileContent({
  params,
  searchParams,
}: CreatorProfilePageProps) {
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
    <MarketplaceInstallPermissionProvider>
      <DifyCreatorProfile loadedProfile={loadedProfile} locale={locale} />
    </MarketplaceInstallPermissionProvider>
  )
}
