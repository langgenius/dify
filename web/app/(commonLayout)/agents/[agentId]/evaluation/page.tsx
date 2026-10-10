import SnippetAndEvaluationPlanGuard from '@/app/components/billing/snippet-and-evaluation-plan-guard'
import { AgentDetailPage } from '@/features/agent-v2/agent-detail/page'

type PageProps = {
  params: Promise<{ agentId: string }>
}

export default async function Page({ params }: PageProps) {
  const { agentId } = await params

  return (
    <SnippetAndEvaluationPlanGuard fallbackHref={`/agents/${agentId}/configure`}>
      <AgentDetailPage agentId={agentId} section="evaluation" />
    </SnippetAndEvaluationPlanGuard>
  )
}
