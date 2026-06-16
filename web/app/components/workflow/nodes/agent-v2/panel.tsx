import type { AgentRosterNodeData } from '../../block-selector/types'
import type { NodePanelProps } from '../../types'
import type { AgentV2NodeType } from './types'
import { produce } from 'immer'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks'
import useNodeCrud from '../_base/hooks/use-node-crud'
import { AgentAdvancedSettings } from './components/agent-advanced-settings'
import { AgentOutputVariables } from './components/agent-output-variables'
import { AgentRosterField } from './components/agent-roster-field'
import { AgentTaskField } from './components/agent-task-field'
import { useAgentRosterDetail, useWorkflowInlineAgentDetail } from './hooks'
import { getAgentV2DeclaredOutputs } from './output-variables'

export function AgentV2Panel({
  id,
  data,
}: NodePanelProps<AgentV2NodeType>) {
  const { t } = useTranslation()
  const { inputs, setInputs } = useNodeCrud<AgentV2NodeType>(id, data)
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const drawerPortalContainerRef = useRef<HTMLDivElement>(null)
  const declaredOutputs = getAgentV2DeclaredOutputs(inputs)
  const rosterAgentId = inputs.agent_binding?.binding_type === 'roster_agent' ? inputs.agent_binding.agent_id : undefined
  const inlineAgentId = inputs.agent_binding?.binding_type === 'inline_agent' ? inputs.agent_binding.agent_id : undefined
  const isInlineAgentPending = inputs.agent_binding?.binding_type === 'inline_agent' && inputs._isTempNode
  const rosterAgentQuery = useAgentRosterDetail(rosterAgentId)
  const inlineAgentQuery = useWorkflowInlineAgentDetail(id, inlineAgentId)
  const inlineAgent = inlineAgentQuery.data?.agent
  const displayedAgent = rosterAgentQuery.data ?? (inlineAgent
    ? {
        id: inlineAgent.id,
        name: inlineAgent.name,
        description: inlineAgent.description,
        role: t('nodes.agent.roster.inlineSetup.type', { ns: 'workflow' }),
      }
    : undefined)

  const handleTaskChange = useCallback((value: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.agent_task = value
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleRosterChange = useCallback((agent: AgentRosterNodeData) => {
    const newInputs = produce(inputs, (draft) => {
      delete (draft as AgentV2NodeType & { agent_roster?: unknown }).agent_roster
      draft.agent_binding = {
        binding_type: 'roster_agent',
        agent_id: agent.id,
      }
    })
    handleNodeDataUpdateWithSyncDraft(
      {
        id,
        data: newInputs,
      },
      {
        sync: true,
        notRefreshWhenSyncError: true,
      },
    )
  }, [handleNodeDataUpdateWithSyncDraft, id, inputs])

  const handleDeclaredOutputsChange = useCallback((outputs: ReturnType<typeof getAgentV2DeclaredOutputs>) => {
    const newInputs = produce(inputs, (draft) => {
      draft.agent_declared_outputs = outputs
    })
    handleNodeDataUpdateWithSyncDraft(
      {
        id,
        data: newInputs,
      },
      {
        sync: true,
        notRefreshWhenSyncError: true,
      },
    )
  }, [handleNodeDataUpdateWithSyncDraft, id, inputs])

  return (
    <div ref={drawerPortalContainerRef} className="pt-2">
      <div className="border-b border-divider-subtle">
        <AgentRosterField
          agent={displayedAgent}
          agentId={rosterAgentId ?? inlineAgentId ?? undefined}
          canOpenPanel={!inlineAgentId}
          isPending={isInlineAgentPending}
          portalContainerRef={drawerPortalContainerRef}
          onChange={handleRosterChange}
        />
      </div>
      <div className="border-b border-divider-subtle">
        <AgentTaskField
          id={id}
          data={inputs}
          onChange={handleTaskChange}
        />
      </div>
      <AgentAdvancedSettings />
      <div>
        <AgentOutputVariables
          outputs={declaredOutputs}
          onChange={handleDeclaredOutputsChange}
        />
      </div>
    </div>
  )
}
