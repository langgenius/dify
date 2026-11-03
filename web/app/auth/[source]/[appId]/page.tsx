import ConnectionAuth from '@/app/components/share/connection-auth'
import { notFound } from '@/next/navigation'

export default async function AppConnectionAuthPage({
  params,
  searchParams,
}: {
  params: Promise<{ source: string; appId: string }>
  searchParams: Promise<{ state?: string | string[] }>
}) {
  const [{ source, appId }, query] = await Promise.all([params, searchParams])
  if (source !== 'cli' && source !== 'api') notFound()
  const linkState =
    query.state === 'expired' || query.state === 'configuration-changed' ? query.state : 'setup'

  return <ConnectionAuth appId={appId} source={source} linkState={linkState} />
}
