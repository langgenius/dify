import ProviderConnectionsPage from '@/app/components/end-user/connections/provider-connections-page'
import { decodeConnectionProviderRouteParam } from '@/app/components/end-user/connections/provider-route'
import { getRouteMetadata } from '@/app/route-metadata'

type Props = {
  params: Promise<{ provider: string }>
}

export async function generateMetadata({ params }: Props) {
  const { provider } = await params
  const providerId = decodeConnectionProviderRouteParam(provider)
  const metadata = await getRouteMetadata('app', ($) => $['endUser.connections'])
  return { ...metadata, title: `${providerId} · ${metadata.title}` }
}

export default async function Page({ params }: Props) {
  const { provider } = await params
  const providerId = decodeConnectionProviderRouteParam(provider)
  return <ProviderConnectionsPage key={providerId} providerId={providerId} />
}
