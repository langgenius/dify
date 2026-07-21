import { AgentDetailPage } from '@/features/agent-v2/agent-detail/page'

type PageProps = {
  params: Promise<{ agentId: string }>
}

export default async function Page({ params }: PageProps) {
  const { agentId } = await params

  return <AgentDetailPage agentId={agentId} section="configure" />
}
