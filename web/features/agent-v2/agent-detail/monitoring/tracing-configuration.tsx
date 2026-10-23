import { TracingConfiguration } from '@/app/components/app/tracing/configuration'
import { useAgentPermissions } from '../../permissions'

export function AgentTracingConfiguration({ agentId }: { agentId: string }) {
  const { canMonitor, canEdit } = useAgentPermissions(agentId)
  if (!canMonitor) return null
  return (
    <TracingConfiguration key={agentId} resource={{ kind: 'agent', agentId }} readOnly={!canEdit} />
  )
}
