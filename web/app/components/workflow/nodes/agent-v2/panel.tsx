import type { AgentRosterNodeData } from '../../block-selector/types'
import type { NodePanelProps } from '../../types'
import type { AgentV2NodeType } from './types'
import { produce } from 'immer'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks'
import { useStore } from '@/app/components/workflow/store'
import useNodeCrud from '../_base/hooks/use-node-crud'
import { AgentAdvancedSettings } from './components/agent-advanced-settings'
import { AgentOrchestrateDrawerPanel } from './components/agent-orchestrate-drawer-panel'
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
  const [isRosterAgentPanelOpen, setIsRosterAgentPanelOpen] = useState(false)
  const [isInlineAgentPanelOpenedFromTrigger, setIsInlineAgentPanelOpenedFromTrigger] = useState(false)
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const openInlineAgentPanelNodeId = useStore(state => state.openInlineAgentPanelNodeId)
  const setOpenInlineAgentPanelNodeId = useStore(state => state.setOpenInlineAgentPanelNodeId)
  const drawerPortalContainerRef = useRef<HTMLDivElement>(null)
  const declaredOutputs = getAgentV2DeclaredOutputs(inputs)
  const rosterAgentId = inputs.agent_binding?.binding_type === 'roster_agent' ? inputs.agent_binding.agent_id : undefined
  const inlineAgentId = inputs.agent_binding?.binding_type === 'inline_agent' ? inputs.agent_binding.agent_id : undefined
  const isInlineAgentPending = inputs.agent_binding?.binding_type === 'inline_agent' && inputs._isTempNode
  const isInlineAgentReady = Boolean(inlineAgentId && !isInlineAgentPending)
  const isInlineAgentPanelOpen = isInlineAgentReady && openInlineAgentPanelNodeId === id
  const rosterAgentQuery = useAgentRosterDetail(rosterAgentId)
  const inlineAgentQuery = useWorkflowInlineAgentDetail(id, inlineAgentId)
  const inlineAgent = inlineAgentQuery.data?.agent
  const isAgentPanelOpen = isInlineAgentReady ? isInlineAgentPanelOpen : isRosterAgentPanelOpen
  const isInlineAgentLoading = isInlineAgentReady && !inlineAgent
  const displayedAgent = rosterAgentQuery.data ?? (inlineAgentId && isInlineAgentReady
    ? {
        id: inlineAgentId,
        name: inlineAgent?.name || t('nodes.agent.roster.inlineSetup.name', { ns: 'workflow' }),
        description: inlineAgent?.description,
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
    setOpenInlineAgentPanelNodeId(undefined)
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
  }, [handleNodeDataUpdateWithSyncDraft, id, inputs, setOpenInlineAgentPanelNodeId])

  const handleAgentPanelOpenChange = useCallback((open: boolean) => {
    if (isInlineAgentReady) {
      if (open)
        setIsInlineAgentPanelOpenedFromTrigger(true)

      setOpenInlineAgentPanelNodeId(open ? id : undefined)
      return
    }

    setIsRosterAgentPanelOpen(open)
  }, [id, isInlineAgentReady, setOpenInlineAgentPanelNodeId])

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
          canOpenPanel={!isInlineAgentPending}
          isLoading={isInlineAgentLoading}
          isPanelOpen={isAgentPanelOpen}
          isPending={isInlineAgentPending}
          panelBody={isAgentPanelOpen && displayedAgent
            ? (
                <AgentOrchestrateDrawerPanel
                  agentId={displayedAgent.id}
                  inlineComposerState={inlineAgentQuery.data}
                  isInline={isInlineAgentReady}
                  nodeId={id}
                  open={isAgentPanelOpen}
                />
              )
            : undefined}
          panelMode={isInlineAgentReady && !isInlineAgentPanelOpenedFromTrigger ? 'setup' : 'detail'}
          portalContainerRef={drawerPortalContainerRef}
          showPanelDetailActions={!isInlineAgentReady}
          onChange={handleRosterChange}
          onPanelOpenChange={handleAgentPanelOpenChange}
        />
      </div>
      <div
        aria-disabled={isInlineAgentPending}
        inert={isInlineAgentPending ? true : undefined}
        className={isInlineAgentPending ? 'pointer-events-none' : undefined}
      >
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
    </div>
  )
}
