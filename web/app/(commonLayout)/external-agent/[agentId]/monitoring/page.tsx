import { getRouteMetadata } from '@/app/route-metadata'
import { ExternalAgentMonitoringPage } from '@/features/agent-v2/external-agent/monitoring/page'

export function generateMetadata() {
  return getRouteMetadata('agentRoster', ($) => $['external.overview.monitoring'])
}

export default async function Page({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params

  return <ExternalAgentMonitoringPage key={agentId} agentId={agentId} />
}
