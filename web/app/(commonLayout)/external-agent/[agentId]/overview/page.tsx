import { getRouteMetadata } from '@/app/route-metadata'
import { ExternalAgentOverviewPage } from '@/features/agent-v2/external-agent/overview/page'

export function generateMetadata() {
  return getRouteMetadata('agentRoster', ($) => $['external.overview.title'])
}

export default async function Page({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params

  return <ExternalAgentOverviewPage agentId={agentId} />
}
