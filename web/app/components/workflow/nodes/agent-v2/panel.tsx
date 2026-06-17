import type { AgentRosterNodeData } from '../../block-selector/types'
import type { NodePanelProps } from '../../types'
import type { AgentV2NodeType } from './types'
import { produce } from 'immer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  extractAgentOutputNames,
  replaceAgentOutputName,
} from '@/app/components/base/prompt-editor/plugins/agent-output-block/utils'
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
import { hasValidInlineAgentBinding } from './types'

export function AgentV2Panel({
  id,
  data,
}: NodePanelProps<AgentV2NodeType>) {
  const { t } = useTranslation()
  const { inputs, setInputs } = useNodeCrud<AgentV2NodeType>(id, data)
  const inputsRef = useRef(inputs)
  const promptOutputNamesRef = useRef(extractAgentOutputNames(inputs.agent_task || ''))
  const [isRosterAgentPanelOpen, setIsRosterAgentPanelOpen] = useState(false)
  const [isInlineAgentPanelOpenedFromTrigger, setIsInlineAgentPanelOpenedFromTrigger] = useState(false)
  const { handleNodeDataUpdate, handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const openInlineAgentPanelNodeId = useStore(state => state.openInlineAgentPanelNodeId)
  const setOpenInlineAgentPanelNodeId = useStore(state => state.setOpenInlineAgentPanelNodeId)
  const drawerPortalContainerRef = useRef<HTMLDivElement>(null)
  const declaredOutputs = getAgentV2DeclaredOutputs(inputs)
  const rosterAgentId = inputs.agent_binding?.binding_type === 'roster_agent' ? inputs.agent_binding.agent_id : undefined
  const inlineAgentId = inputs.agent_binding?.binding_type === 'inline_agent' ? inputs.agent_binding.agent_id : undefined
  const isInlineAgentReady = hasValidInlineAgentBinding(inputs)
  const isInlineAgentPending = inputs.agent_binding?.binding_type === 'inline_agent' && !isInlineAgentReady
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

  useEffect(() => {
    inputsRef.current = inputs
    promptOutputNamesRef.current = extractAgentOutputNames(inputs.agent_task || '')
  }, [inputs])

  useEffect(() => {
    if (!inputs._openInlineAgentPanel || !isInlineAgentReady)
      return

    setOpenInlineAgentPanelNodeId(id)
    handleNodeDataUpdate({
      id,
      data: {
        _openInlineAgentPanel: false,
      },
    })
  }, [handleNodeDataUpdate, id, inputs._openInlineAgentPanel, isInlineAgentReady, setOpenInlineAgentPanelNodeId])

  const handleTaskChange = useCallback((value: string) => {
    const currentPromptOutputNames = extractAgentOutputNames(value)
    const removedPromptOutputNames = [...promptOutputNamesRef.current].filter(name => !currentPromptOutputNames.has(name))
    const newInputs = produce(inputsRef.current, (draft) => {
      draft.agent_task = value
      if (removedPromptOutputNames.length) {
        const removedNameSet = new Set(removedPromptOutputNames)
        draft.agent_declared_outputs = getAgentV2DeclaredOutputs(draft)
          .filter(output => !removedNameSet.has(output.name))
      }
    })
    inputsRef.current = newInputs
    promptOutputNamesRef.current = currentPromptOutputNames
    setInputs(newInputs)
  }, [setInputs])

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

  const handleDeclaredOutputsChange = useCallback((outputs: ReturnType<typeof getAgentV2DeclaredOutputs>, agentTask?: string) => {
    const previousOutputs = getAgentV2DeclaredOutputs(inputsRef.current)
    let nextAgentTask = agentTask
    if (nextAgentTask === undefined && previousOutputs.length === outputs.length) {
      const renamedOutputs = previousOutputs
        .map((previousOutput, index) => ({
          oldName: previousOutput.name,
          nextName: outputs[index]?.name,
        }))
        .filter(({ oldName, nextName }) => nextName && oldName !== nextName)

      if (renamedOutputs.length === 1) {
        const { oldName, nextName } = renamedOutputs[0]!
        const currentAgentTask = inputsRef.current.agent_task || ''
        if (extractAgentOutputNames(currentAgentTask).has(oldName))
          nextAgentTask = replaceAgentOutputName(currentAgentTask, oldName, nextName!)
      }
    }

    const newInputs = produce(inputsRef.current, (draft) => {
      draft.agent_declared_outputs = outputs
      if (nextAgentTask !== undefined)
        draft.agent_task = nextAgentTask
    })
    inputsRef.current = newInputs
    if (nextAgentTask !== undefined)
      promptOutputNamesRef.current = extractAgentOutputNames(nextAgentTask)
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
  }, [handleNodeDataUpdateWithSyncDraft, id])

  return (
    <div ref={drawerPortalContainerRef} className="pt-2">
      <div className="border-b border-divider-subtle">
        <AgentRosterField
          agent={displayedAgent}
          agentId={rosterAgentId ?? inlineAgentId ?? undefined}
          canOpenPanel={!isInlineAgentPending}
          isInlineSetup={isInlineAgentReady}
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
            outputs={declaredOutputs}
            onChange={handleTaskChange}
            onOutputsChange={handleDeclaredOutputsChange}
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
