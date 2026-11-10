import { ExternalAgentDetailSidebar } from '@/features/agent-v2/external-agent/detail-sidebar'

export default async function ExternalAgentOverviewSidebarSlot({
  params,
}: {
  params: Promise<{ agentId: string }>
}) {
  const { agentId } = await params

  return <ExternalAgentDetailSidebar agentId={agentId} />
}
