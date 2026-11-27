import EvaluationPlanGuard from '@/app/components/billing/evaluation-plan-guard'
import { AgentDetailPage } from '@/features/agent-v2/agent-detail/page'

type PageProps = {
  params: Promise<{ agentId: string }>
}

export default async function Page({ params }: PageProps) {
  const { agentId } = await params

  return (
    <EvaluationPlanGuard fallbackHref={`/agents/${agentId}/configure`} resourceType="agents">
      <AgentDetailPage agentId={agentId} section="evaluation" />
    </EvaluationPlanGuard>
  )
}
