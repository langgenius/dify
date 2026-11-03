import ConnectionAuth from '@/app/components/share/connection-auth'
import { notFound } from '@/next/navigation'

export default async function AppConnectionAuthPage({
  params,
}: {
  params: Promise<{ source: string; appId: string }>
}) {
  const { source, appId } = await params
  if (source !== 'cli' && source !== 'api') notFound()

  return <ConnectionAuth appId={appId} source={source} />
}
