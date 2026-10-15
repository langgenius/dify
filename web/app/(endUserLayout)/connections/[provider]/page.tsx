import { demoConnections, demoProviders } from '@/app/components/end-user/connections/demo-data'
import ProviderConnectionsDemo from '@/app/components/end-user/connections/provider-demo'
import { getRouteMetadata } from '@/app/route-metadata'
import { notFound } from '@/next/navigation'

type Props = {
  params: Promise<{ provider: string }>
}

export async function generateMetadata({ params }: Props) {
  const { provider: providerId } = await params
  const provider = demoProviders.find((item) => item.id === providerId)
  const metadata = await getRouteMetadata('app', ($) => $['endUser.connections'])
  return provider ? { ...metadata, title: `${provider.name} · ${metadata.title}` } : metadata
}

export default async function Page({ params }: Props) {
  const { provider: providerId } = await params
  const provider = demoProviders.find((item) => item.id === providerId)
  if (!provider) notFound()

  return (
    <ProviderConnectionsDemo
      key={provider.id}
      provider={provider}
      initialConnections={demoConnections[provider.id] ?? []}
    />
  )
}
