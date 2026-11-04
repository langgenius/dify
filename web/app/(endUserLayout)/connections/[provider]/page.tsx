import ProviderConnectionsPage from '@/app/components/end-user/connections/provider-connections-page'
import { getRouteMetadata } from '@/app/route-metadata'

type Props = {
  params: Promise<{ provider: string }>
}

export async function generateMetadata({ params }: Props) {
  const { provider: providerId } = await params
  const metadata = await getRouteMetadata('app', ($) => $['endUser.connections'])
  return { ...metadata, title: `${providerId} · ${metadata.title}` }
}

export default async function Page({ params }: Props) {
  const { provider: providerId } = await params
  return <ProviderConnectionsPage key={providerId} providerId={providerId} />
}
