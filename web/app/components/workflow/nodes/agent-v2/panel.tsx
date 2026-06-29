import type { AgentComposerBindingResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { AgentRosterNodeData } from '../../block-selector/types'
import type { NodePanelProps } from '../../types'
import type { AgentV2NodeType } from './types'
import { useMutation } from '@tanstack/react-query'
import { produce } from 'immer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '#i18n'
import {
  extractAgentOutputNames,
  replaceAgentOutputName,
} from '@/app/components/base/prompt-editor/plugins/agent-output-block/utils'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks'
import { useStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/client'
import useNodeCrud from '../_base/hooks/use-node-crud'
import { AgentAdvancedSettings } from './components/agent-advanced-settings'
import { WorkflowInlineAgentConfigureWorkspace, WorkflowRosterAgentOrchestratePanelContent } from './components/agent-orchestrate-panel-content'
import { AgentOutputVariables } from './components/agent-output-variables'
import { AgentRosterField } from './components/agent-roster-field'
import { AgentTaskField } from './components/agent-task-field'
import { SaveInlineAgentToRosterDialog } from './components/save-inline-agent-to-roster-dialog'
import { useAgentRosterDetail, useCreateInlineAgentBinding, useWorkflowInlineAgentDetail } from './hooks'
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
  const [isSaveToRosterDialogOpen, setIsSaveToRosterDialogOpen] = useState(false)
  const [saveToRosterSessionKey, setSaveToRosterSessionKey] = useState(0)
  const { handleNodeDataUpdate, handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const openInlineAgentPanelNodeId = useStore(state => state.openInlineAgentPanelNodeId)
  const setOpenInlineAgentPanelNodeId = useStore(state => state.setOpenInlineAgentPanelNodeId)
  const appId = useStore(state => state.appId)
  const drawerPortalContainerRef = useRef<HTMLDivElement>(null)
  const declaredOutputs = getAgentV2DeclaredOutputs(inputs)
  const rosterAgentId = inputs.agent_binding?.binding_type === 'roster_agent' ? inputs.agent_binding.agent_id : undefined
  const inlineAgentId = inputs.agent_binding?.binding_type === 'inline_agent' ? inputs.agent_binding.agent_id : undefined
  const isInlineAgentReady = hasValidInlineAgentBinding(inputs)
  const isInlineAgentPending = inputs.agent_binding?.binding_type === 'inline_agent' && !isInlineAgentReady
  const isInlineAgentPanelOpen = (isInlineAgentReady || isInlineAgentPending) && openInlineAgentPanelNodeId === id
  const rosterAgentQuery = useAgentRosterDetail(rosterAgentId)
  const inlineAgentQuery = useWorkflowInlineAgentDetail(id, inlineAgentId)
  const { createInlineAgentBinding, isCreatingInlineAgent } = useCreateInlineAgentBinding()
  const inlineAgent = inlineAgentQuery.data?.agent
  const {
    isPending: isCopyingFromRoster,
    mutate: copyFromRoster,
  } = useMutation(
    consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.copyFromRoster.post.mutationOptions(),
  )
  const isAgentPanelOpen = isInlineAgentReady || isInlineAgentPending ? isInlineAgentPanelOpen : isRosterAgentPanelOpen
  const isInlineAgentLoading = isInlineAgentPending || (isInlineAgentReady && !inlineAgent)
  const isAgentBindingPending = isInlineAgentPending || isCreatingInlineAgent
  const canStartFromScratch = inputs.agent_binding?.binding_type !== 'inline_agent'
  const canSaveInlineToRoster = isInlineAgentReady && !!inlineAgent
  const inlineComposerStateForPanel = inlineAgentQuery.data
  const displayedAgent = rosterAgentQuery.data ?? (isInlineAgentPending || isInlineAgentReady
    ? {
        id: inlineAgentId ?? id,
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

  const handleMakeRosterCopy = useCallback(() => {
    if (!appId || !rosterAgentId || isCopyingFromRoster)
      return

    copyFromRoster({
      params: {
        app_id: appId,
        node_id: id,
      },
      body: {
        source_agent_id: rosterAgentId,
      },
    }, {
      onSuccess: (composerState) => {
        const binding = composerState.binding
        if (
          binding?.binding_type !== 'inline_agent'
          || !binding.agent_id
          || !binding.current_snapshot_id
        ) {
          return
        }

        setIsRosterAgentPanelOpen(false)
        setIsInlineAgentPanelOpenedFromTrigger(true)
        setOpenInlineAgentPanelNodeId(id)

        const newInputs = produce(inputsRef.current, (draft) => {
          delete (draft as AgentV2NodeType & { agent_roster?: unknown }).agent_roster
          draft.agent_binding = {
            binding_type: 'inline_agent',
            agent_id: binding.agent_id,
            current_snapshot_id: binding.current_snapshot_id,
          }
          draft._openInlineAgentPanel = true
        })
        inputsRef.current = newInputs
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
      },
    })
  }, [appId, copyFromRoster, handleNodeDataUpdateWithSyncDraft, id, isCopyingFromRoster, rosterAgentId, setOpenInlineAgentPanelNodeId])

  const handleSaveInlineToRosterOpen = useCallback(() => {
    setSaveToRosterSessionKey(key => key + 1)
    setIsSaveToRosterDialogOpen(true)
  }, [])

  const handleInlineSavedToRoster = useCallback((binding: AgentComposerBindingResponse) => {
    if (binding.binding_type !== 'roster_agent' || !binding.agent_id)
      return

    setOpenInlineAgentPanelNodeId(undefined)
    setIsInlineAgentPanelOpenedFromTrigger(false)
    setIsRosterAgentPanelOpen(true)

    const newInputs = produce(inputsRef.current, (draft) => {
      delete (draft as AgentV2NodeType & { agent_roster?: unknown }).agent_roster
      delete draft._openInlineAgentPanel
      draft.agent_binding = {
        binding_type: 'roster_agent',
        agent_id: binding.agent_id!,
      }
    })
    inputsRef.current = newInputs
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
  }, [handleNodeDataUpdateWithSyncDraft, id, setOpenInlineAgentPanelNodeId])

  const handleInlineAgentBindingCreated = useCallback((binding: {
    agent_id: string
    binding_type: 'inline_agent'
    current_snapshot_id: string
  }) => {
    const newInputs = produce(inputsRef.current, (draft) => {
      delete (draft as AgentV2NodeType & { agent_roster?: unknown }).agent_roster
      draft.agent_binding = binding
      draft._openInlineAgentPanel = true
    })
    inputsRef.current = newInputs
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

  const handleInlineAgentSaved = useCallback((binding: AgentComposerBindingResponse) => {
    if (
      binding.binding_type !== 'inline_agent'
      || !binding.agent_id
      || !binding.current_snapshot_id
    ) {
      return
    }

    const newInputs = produce(inputsRef.current, (draft) => {
      delete (draft as AgentV2NodeType & { agent_roster?: unknown }).agent_roster
      delete draft._openInlineAgentPanel
      draft.agent_binding = {
        binding_type: 'inline_agent',
        agent_id: binding.agent_id,
        current_snapshot_id: binding.current_snapshot_id,
      }
    })
    inputsRef.current = newInputs
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

  const handleStartFromScratch = useCallback(() => {
    setIsRosterAgentPanelOpen(false)
    setIsInlineAgentPanelOpenedFromTrigger(false)
    setOpenInlineAgentPanelNodeId(id)

    const pendingInputs = produce(inputsRef.current, (draft) => {
      delete (draft as AgentV2NodeType & { agent_roster?: unknown }).agent_roster
      draft.agent_binding = {
        binding_type: 'inline_agent',
      }
      draft._openInlineAgentPanel = true
    })
    inputsRef.current = pendingInputs
    handleNodeDataUpdateWithSyncDraft(
      {
        id,
        data: pendingInputs,
      },
      {
        sync: true,
        notRefreshWhenSyncError: true,
      },
    )

    createInlineAgentBinding(id, {
      onSuccess: handleInlineAgentBindingCreated,
    })
  }, [createInlineAgentBinding, handleInlineAgentBindingCreated, handleNodeDataUpdateWithSyncDraft, id, setOpenInlineAgentPanelNodeId])

  const handleAgentPanelOpenChange = useCallback((open: boolean) => {
    if (isInlineAgentReady || isInlineAgentPending) {
      if (open)
        setIsInlineAgentPanelOpenedFromTrigger(true)

      setOpenInlineAgentPanelNodeId(open ? id : undefined)
      if (open && isInlineAgentReady)
        void inlineAgentQuery.refetch()

      if (open && isInlineAgentPending && !isCreatingInlineAgent) {
        createInlineAgentBinding(id, {
          onSuccess: handleInlineAgentBindingCreated,
        })
      }
      return
    }

    setIsRosterAgentPanelOpen(open)
  }, [createInlineAgentBinding, handleInlineAgentBindingCreated, id, inlineAgentQuery, isCreatingInlineAgent, isInlineAgentPending, isInlineAgentReady, setOpenInlineAgentPanelNodeId])

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
          agentId={rosterAgentId ?? inlineAgentId ?? (isInlineAgentPending ? id : undefined)}
          canOpenPanel
          isInlineSetup={isInlineAgentReady || isInlineAgentPending}
          isLoading={isInlineAgentLoading}
          isPanelCopyPending={isCopyingFromRoster}
          isPanelOpen={isAgentPanelOpen}
          isPending={isAgentBindingPending}
          panelBody={isAgentPanelOpen && displayedAgent
            ? (
                isInlineAgentReady || isInlineAgentPending
                  ? (
                      <WorkflowInlineAgentConfigureWorkspace
                        agentId={inlineAgentId ?? undefined}
                        appId={appId}
                        inlineComposerState={inlineComposerStateForPanel}
                        nodeId={id}
                        onClose={() => handleAgentPanelOpenChange(false)}
                        onSaved={handleInlineAgentSaved}
                        onSaveInlineToRoster={canSaveInlineToRoster ? handleSaveInlineToRosterOpen : undefined}
                        open={isAgentPanelOpen}
                      />
                    )
                  : (
                      <WorkflowRosterAgentOrchestratePanelContent
                        agentId={rosterAgentId}
                        nodeId={id}
                        open={isAgentPanelOpen}
                      />
                    )
              )
            : undefined}
          panelMode={isInlineAgentPending || (isInlineAgentReady && !isInlineAgentPanelOpenedFromTrigger) ? 'setup' : 'detail'}
          portalContainerRef={drawerPortalContainerRef}
          showPanelDetailActions={!isInlineAgentReady && !isInlineAgentPending}
          onChange={handleRosterChange}
          onMakeCopy={rosterAgentId ? handleMakeRosterCopy : undefined}
          onPanelOpenChange={handleAgentPanelOpenChange}
          onSaveInlineToRoster={canSaveInlineToRoster ? handleSaveInlineToRosterOpen : undefined}
          onStartFromScratch={canStartFromScratch ? handleStartFromScratch : undefined}
        />
        <SaveInlineAgentToRosterDialog
          key={saveToRosterSessionKey}
          appId={appId}
          formKey={saveToRosterSessionKey}
          initialAgent={inlineAgent}
          nodeId={id}
          open={isSaveToRosterDialogOpen}
          onOpenChange={setIsSaveToRosterDialogOpen}
          onSaved={handleInlineSavedToRoster}
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
