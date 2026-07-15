import type {
  AgentComposerBindingResponse,
  DeclaredOutputConfig,
  WorkflowAgentComposerResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { AgentRosterNodeData } from '../../block-selector/types'
import type { NodePanelProps } from '../../types'
import type { AgentV2NodeType } from './types'
import type { AgentOutputTypeOptionValue } from '@/app/components/base/prompt-editor/plugins/agent-output-block/utils'
import { useMutation } from '@tanstack/react-query'
import { produce } from 'immer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  createAgentOutputConfig,
  extractAgentOutputNames,
  replaceAgentOutputName,
} from '@/app/components/base/prompt-editor/plugins/agent-output-block/utils'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/client'
import { FlowType } from '@/types/common'
import useNodeCrud from '../_base/hooks/use-node-crud'
import { AgentAdvancedSettings } from './components/agent-advanced-settings'
import {
  WorkflowInlineAgentConfigureWorkspace,
  WorkflowRosterAgentOrchestratePanelContent,
} from './components/agent-orchestrate-panel-content'
import { AgentOutputVariables } from './components/agent-output-variables'
import { OutputEditCard } from './components/agent-output-variables/edit-card'
import { createDraft, isDefaultOutput } from './components/agent-output-variables/utils'
import { AgentRosterField } from './components/agent-roster-field'
import { AgentTaskField } from './components/agent-task-field'
import { SaveInlineAgentToRosterDialog } from './components/save-inline-agent-to-roster-dialog'
import {
  useAgentRosterDetail,
  useCreateInlineAgentBinding,
  useWorkflowInlineAgentDetail,
} from './hooks'
import { getAgentV2DeclaredOutputs } from './output-variables'
import { hasValidInlineAgentBinding } from './types'

function FloatingOutputEditor({
  agentTask,
  editOutputName,
  editOutputRequestKey,
  editOutputType,
  outputs,
  position,
  onCancel,
  onChange,
}: {
  agentTask?: string
  editOutputName?: string
  editOutputRequestKey?: number
  editOutputType?: AgentOutputTypeOptionValue
  outputs: DeclaredOutputConfig[]
  position?: { left: number; top: number }
  onCancel: () => void
  onChange: (outputs: DeclaredOutputConfig[], agentTask?: string) => void
}) {
  if (!editOutputName || !position || typeof document === 'undefined') return null

  const outputIndex = outputs.findIndex((output) => output.name === editOutputName)
  const existingOutput = outputs[outputIndex]
  if (existingOutput && isDefaultOutput(existingOutput)) return null

  const output =
    existingOutput ?? createAgentOutputConfig(editOutputName, editOutputType ?? 'string')
  const isExistingOutput = !!existingOutput

  return createPortal(
    <div
      className="fixed z-50 w-[400px]"
      style={{
        left: position.left,
        top: position.top,
      }}
    >
      <OutputEditCard
        key={`${editOutputRequestKey ?? 0}-${output.name}`}
        editingIndex={isExistingOutput ? outputIndex : undefined}
        existingOutputs={outputs}
        state={{
          ...(isExistingOutput ? { outputIndex } : {}),
          draft: createDraft(output),
        }}
        onCancel={onCancel}
        onConfirm={(nextOutput) => {
          const currentAgentTask = agentTask || ''
          const nextAgentTask =
            nextOutput.name !== editOutputName &&
            extractAgentOutputNames(currentAgentTask).has(editOutputName)
              ? replaceAgentOutputName(currentAgentTask, editOutputName, nextOutput.name)
              : undefined

          onChange(
            isExistingOutput
              ? outputs.map((item, index) => (index === outputIndex ? nextOutput : item))
              : [...outputs.filter((output) => output.name !== editOutputName), nextOutput],
            nextAgentTask,
          )
          onCancel()
        }}
      />
    </div>,
    document.body,
  )
}

export function AgentV2Panel({ id, data }: NodePanelProps<AgentV2NodeType>) {
  const { t } = useTranslation()
  const { inputs, setInputs } = useNodeCrud<AgentV2NodeType>(id, data)
  const inputsRef = useRef(inputs)
  const promptOutputNamesRef = useRef(extractAgentOutputNames(inputs.agent_task || ''))
  const [isRosterAgentPanelOpen, setIsRosterAgentPanelOpen] = useState(false)
  const [isInlineAgentPanelOpenedFromTrigger, setIsInlineAgentPanelOpenedFromTrigger] =
    useState(false)
  const [isSaveToRosterDialogOpen, setIsSaveToRosterDialogOpen] = useState(false)
  const [editingOutputFromTask, setEditingOutputFromTask] = useState<{
    name: string
    outputType: AgentOutputTypeOptionValue
    position: { left: number; top: number }
    requestKey: number
  } | null>(null)
  const [isOutputVariablesCollapsed, setIsOutputVariablesCollapsed] = useState(true)
  const [saveToRosterSessionKey, setSaveToRosterSessionKey] = useState(0)
  const { handleNodeDataUpdate, handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const openInlineAgentPanelNodeId = useStore((state) => state.openInlineAgentPanelNodeId)
  const setOpenInlineAgentPanelNodeId = useStore((state) => state.setOpenInlineAgentPanelNodeId)
  const configsMap = useHooksStore((state) => state.configsMap)
  const drawerPortalContainerRef = useRef<HTMLDivElement>(null)
  const [localDeclaredOutputs, setLocalDeclaredOutputs] = useState<DeclaredOutputConfig[] | null>(
    null,
  )
  const declaredOutputs = localDeclaredOutputs ?? getAgentV2DeclaredOutputs(inputs)
  const rosterAgentId =
    inputs.agent_binding?.binding_type === 'roster_agent'
      ? inputs.agent_binding.agent_id
      : undefined
  const inlineAgentId =
    inputs.agent_binding?.binding_type === 'inline_agent'
      ? inputs.agent_binding.agent_id
      : undefined
  const isInlineAgentReady = hasValidInlineAgentBinding(inputs)
  const isInlineAgentPending =
    inputs.agent_binding?.binding_type === 'inline_agent' && !isInlineAgentReady
  const isInlineAgentPanelOpen =
    (isInlineAgentReady || isInlineAgentPending) && openInlineAgentPanelNodeId === id
  const rosterAgentQuery = useAgentRosterDetail(rosterAgentId)
  const inlineAgentQuery = useWorkflowInlineAgentDetail(id, inlineAgentId)
  const { createInlineAgentBinding, isCreatingInlineAgent } = useCreateInlineAgentBinding()
  const inlineAgent = inlineAgentQuery.data?.agent
  const { isPending: isAppCopyingFromRoster, mutate: copyFromRosterApp } = useMutation(
    consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.copyFromRoster.post.mutationOptions(),
  )
  const { isPending: isSnippetCopyingFromRoster, mutate: copyFromRosterSnippet } = useMutation(
    consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.copyFromRoster.post.mutationOptions(),
  )
  const isCopyingFromRoster = isAppCopyingFromRoster || isSnippetCopyingFromRoster
  const isAgentPanelOpen =
    isInlineAgentReady || isInlineAgentPending ? isInlineAgentPanelOpen : isRosterAgentPanelOpen
  const isInlineAgentLoading = isInlineAgentPending || (isInlineAgentReady && !inlineAgent)
  const isAgentBindingPending = isInlineAgentPending || isCreatingInlineAgent
  const canStartFromScratch = inputs.agent_binding?.binding_type !== 'inline_agent'
  const canSaveInlineToRoster = isInlineAgentReady && !!inlineAgent
  const inlineComposerStateForPanel = inlineAgentQuery.data
  const displayedAgent =
    rosterAgentQuery.data ??
    (isInlineAgentPending || isInlineAgentReady
      ? {
          id: inlineAgentId ?? id,
          name:
            inlineAgent?.name ||
            t(($) => $['nodes.agent.roster.inlineSetup.name'], { ns: 'workflow' }),
          description: inlineAgent?.description,
          role: t(($) => $['nodes.agent.roster.inlineSetup.type'], { ns: 'workflow' }),
        }
      : undefined)

  useEffect(() => {
    inputsRef.current = inputs
    promptOutputNamesRef.current = extractAgentOutputNames(inputs.agent_task || '')
  }, [inputs])

  useEffect(() => {
    if (!inputs._openInlineAgentPanel || !isInlineAgentReady) return

    setOpenInlineAgentPanelNodeId(id)
    handleNodeDataUpdate({
      id,
      data: {
        _openInlineAgentPanel: false,
      },
    })
  }, [
    handleNodeDataUpdate,
    id,
    inputs._openInlineAgentPanel,
    isInlineAgentReady,
    setOpenInlineAgentPanelNodeId,
  ])

  const handleTaskChange = useCallback(
    (value: string) => {
      const currentPromptOutputNames = extractAgentOutputNames(value)
      const removedPromptOutputNames = [...promptOutputNamesRef.current].filter(
        (name) => !currentPromptOutputNames.has(name),
      )
      const addedPromptOutputNames = [...currentPromptOutputNames].filter(
        (name) => !promptOutputNamesRef.current.has(name),
      )
      const newInputs = produce(inputsRef.current, (draft) => {
        draft.agent_task = value
        if (removedPromptOutputNames.length) {
          const currentDeclaredOutputs = getAgentV2DeclaredOutputs(draft)
          if (removedPromptOutputNames.length === 1 && addedPromptOutputNames.length === 1) {
            const oldName = removedPromptOutputNames[0]!
            const nextName = addedPromptOutputNames[0]!
            draft.agent_declared_outputs = currentDeclaredOutputs.map((output) =>
              output.name === oldName ? { ...output, name: nextName } : output,
            )
          } else {
            const removedNameSet = new Set(removedPromptOutputNames)
            draft.agent_declared_outputs = currentDeclaredOutputs.filter(
              (output) => !removedNameSet.has(output.name),
            )
          }
        }
      })
      inputsRef.current = newInputs
      promptOutputNamesRef.current = currentPromptOutputNames
      if (removedPromptOutputNames.length)
        setLocalDeclaredOutputs(newInputs.agent_declared_outputs ?? [])
      setInputs(newInputs)
    },
    [setInputs],
  )

  const handleRosterChange = useCallback(
    (agent: AgentRosterNodeData) => {
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
    },
    [handleNodeDataUpdateWithSyncDraft, id, inputs, setOpenInlineAgentPanelNodeId],
  )

  const handleRosterCopySuccess = useCallback(
    (composerState: WorkflowAgentComposerResponse) => {
      const binding = composerState.binding
      if (
        binding?.binding_type !== 'inline_agent' ||
        !binding.agent_id ||
        !binding.current_snapshot_id
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
    [handleNodeDataUpdateWithSyncDraft, id, setOpenInlineAgentPanelNodeId],
  )

  const handleMakeRosterCopy = useCallback(() => {
    if (!configsMap?.flowId || !rosterAgentId || isCopyingFromRoster) return

    const body = {
      source_agent_id: rosterAgentId,
    }
    const options = {
      onSuccess: handleRosterCopySuccess,
    }

    if (configsMap.flowType === FlowType.snippet) {
      copyFromRosterSnippet(
        {
          params: {
            snippet_id: configsMap.flowId,
            node_id: id,
          },
          body,
        },
        options,
      )
      return
    }

    if (configsMap.flowType === FlowType.appFlow) {
      copyFromRosterApp(
        {
          params: {
            app_id: configsMap.flowId,
            node_id: id,
          },
          body,
        },
        options,
      )
    }
  }, [
    configsMap?.flowId,
    configsMap?.flowType,
    copyFromRosterApp,
    copyFromRosterSnippet,
    handleRosterCopySuccess,
    id,
    isCopyingFromRoster,
    rosterAgentId,
  ])

  const handleSaveInlineToRosterOpen = useCallback(() => {
    setSaveToRosterSessionKey((key) => key + 1)
    setIsSaveToRosterDialogOpen(true)
  }, [])

  const handleInlineSavedToRoster = useCallback(
    (binding: AgentComposerBindingResponse) => {
      if (binding.binding_type !== 'roster_agent' || !binding.agent_id) return

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
    },
    [handleNodeDataUpdateWithSyncDraft, id, setOpenInlineAgentPanelNodeId],
  )

  const handleInlineAgentBindingCreated = useCallback(
    (binding: { agent_id: string; binding_type: 'inline_agent'; current_snapshot_id: string }) => {
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
    },
    [handleNodeDataUpdateWithSyncDraft, id],
  )

  const handleInlineAgentSaved = useCallback(
    (binding: AgentComposerBindingResponse) => {
      if (
        binding.binding_type !== 'inline_agent' ||
        !binding.agent_id ||
        !binding.current_snapshot_id
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
    },
    [handleNodeDataUpdateWithSyncDraft, id],
  )

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
  }, [
    createInlineAgentBinding,
    handleInlineAgentBindingCreated,
    handleNodeDataUpdateWithSyncDraft,
    id,
    setOpenInlineAgentPanelNodeId,
  ])

  const handleAgentPanelOpenChange = useCallback(
    (open: boolean) => {
      if (isInlineAgentReady || isInlineAgentPending) {
        if (open) setIsInlineAgentPanelOpenedFromTrigger(true)

        setOpenInlineAgentPanelNodeId(open ? id : undefined)
        if (open && isInlineAgentReady) void inlineAgentQuery.refetch()

        if (open && isInlineAgentPending && !isCreatingInlineAgent) {
          createInlineAgentBinding(id, {
            onSuccess: handleInlineAgentBindingCreated,
          })
        }
        return
      }

      setIsRosterAgentPanelOpen(open)
    },
    [
      createInlineAgentBinding,
      handleInlineAgentBindingCreated,
      id,
      inlineAgentQuery,
      isCreatingInlineAgent,
      isInlineAgentPending,
      isInlineAgentReady,
      setOpenInlineAgentPanelNodeId,
    ],
  )

  const handleDeclaredOutputsChange = useCallback(
    (outputs: ReturnType<typeof getAgentV2DeclaredOutputs>, agentTask?: string) => {
      setIsOutputVariablesCollapsed(false)
      const previousOutputs = getAgentV2DeclaredOutputs(inputsRef.current)
      let nextAgentTask = agentTask
      let nextOutputs = outputs
      if (agentTask !== undefined) {
        const nextPromptOutputNames = extractAgentOutputNames(agentTask)
        const removedPromptOutputNames = [...promptOutputNamesRef.current].filter(
          (name) => !nextPromptOutputNames.has(name),
        )
        const addedPromptOutputNames = [...nextPromptOutputNames].filter(
          (name) => !promptOutputNamesRef.current.has(name),
        )

        if (removedPromptOutputNames.length === 1 && addedPromptOutputNames.length === 1) {
          const oldName = removedPromptOutputNames[0]!
          const nextName = addedPromptOutputNames[0]!
          const oldOutputIndex = previousOutputs.findIndex((output) => output.name === oldName)
          const nextOutput = outputs.find((output) => output.name === nextName)
          if (oldOutputIndex >= 0 && nextOutput) {
            nextOutputs = previousOutputs.map((output, index) =>
              index === oldOutputIndex ? nextOutput : output,
            )
          }
        }
      }
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
        draft.agent_declared_outputs = nextOutputs
        if (nextAgentTask !== undefined) draft.agent_task = nextAgentTask
      })
      inputsRef.current = newInputs
      setLocalDeclaredOutputs(nextOutputs)
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
    },
    [handleNodeDataUpdateWithSyncDraft, id],
  )

  const handleEditTaskOutput = useCallback(
    (name: string, outputType: AgentOutputTypeOptionValue) => {
      setIsOutputVariablesCollapsed(false)
      const panelRect = drawerPortalContainerRef.current?.getBoundingClientRect()
      const editorWidth = 400
      const gap = 24
      const position = {
        left: Math.max(16, (panelRect?.left ?? 0) - editorWidth - gap),
        top: Math.max(16, (panelRect?.top ?? 0) + 144),
      }

      setEditingOutputFromTask((current) => ({
        name,
        outputType,
        position,
        requestKey: (current?.requestKey ?? 0) + 1,
      }))
    },
    [],
  )

  return (
    <div ref={drawerPortalContainerRef} className="relative pt-2">
      <FloatingOutputEditor
        agentTask={inputs.agent_task}
        editOutputName={editingOutputFromTask?.name}
        editOutputRequestKey={editingOutputFromTask?.requestKey}
        editOutputType={editingOutputFromTask?.outputType}
        outputs={declaredOutputs}
        position={editingOutputFromTask?.position}
        onCancel={() => setEditingOutputFromTask(null)}
        onChange={handleDeclaredOutputsChange}
      />
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
          panelBody={
            isAgentPanelOpen && displayedAgent ? (
              isInlineAgentReady || isInlineAgentPending ? (
                <WorkflowInlineAgentConfigureWorkspace
                  agentId={inlineAgentId ?? undefined}
                  flowId={configsMap?.flowId}
                  flowType={configsMap?.flowType}
                  inlineComposerState={inlineComposerStateForPanel}
                  nodeId={id}
                  onClose={() => handleAgentPanelOpenChange(false)}
                  onSaved={handleInlineAgentSaved}
                  onSaveInlineToRoster={
                    canSaveInlineToRoster ? handleSaveInlineToRosterOpen : undefined
                  }
                  open={isAgentPanelOpen}
                />
              ) : (
                <WorkflowRosterAgentOrchestratePanelContent
                  agentId={rosterAgentId}
                  nodeId={id}
                  open={isAgentPanelOpen}
                />
              )
            ) : undefined
          }
          panelMode={
            isInlineAgentPending || (isInlineAgentReady && !isInlineAgentPanelOpenedFromTrigger)
              ? 'setup'
              : 'detail'
          }
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
          flowId={configsMap?.flowId}
          flowType={configsMap?.flowType}
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
            onEditOutput={handleEditTaskOutput}
            onOutputsChange={handleDeclaredOutputsChange}
          />
        </div>
        <AgentAdvancedSettings />
        <div>
          <AgentOutputVariables
            collapsed={isOutputVariablesCollapsed}
            outputs={declaredOutputs}
            onCollapse={setIsOutputVariablesCollapsed}
            onChange={handleDeclaredOutputsChange}
          />
        </div>
      </div>
    </div>
  )
}
