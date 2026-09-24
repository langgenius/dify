import { AgentDetailPage } from '@/features/agent-v2/agent-detail/page'

export default async function Page({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  return <AgentDetailPage agentId={agentId} section="access-config" />
}
