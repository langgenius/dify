import ConnectionAuth from '@/app/components/share/connection-auth'

export default async function AppConnectionAuthPage({
  params,
  searchParams,
}: {
  params: Promise<{ appId: string }>
  searchParams: Promise<{ source?: string | string[] }>
}) {
  const [{ appId }, query] = await Promise.all([params, searchParams])

  return (
    <ConnectionAuth appId={appId} source={query.source === 'service-api' ? 'service-api' : 'cli'} />
  )
}
