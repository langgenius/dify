import Evaluation from '@/app/components/evaluation'

type AgentEvaluationPageProps = {
  agentId: string
}

export function AgentEvaluationPage({ agentId }: AgentEvaluationPageProps) {
  return <Evaluation resourceType="agents" resourceId={agentId} />
}
