import ConnectionAuth from '@/app/components/share/connection-auth'

export default async function AppConnectionAuthPage({
  params,
  searchParams,
}: {
  params: Promise<{ appId: string }>
  searchParams: Promise<{ state?: string | string[] }>
}) {
  const [{ appId }, query] = await Promise.all([params, searchParams])
  const linkState =
    query.state === 'expired' || query.state === 'configuration-changed' ? query.state : 'setup'

  return <ConnectionAuth appId={appId} linkState={linkState} />
}
