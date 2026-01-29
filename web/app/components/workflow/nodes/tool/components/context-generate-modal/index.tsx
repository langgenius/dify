'use client'
import type { CodeNodeType, OutputVar } from '@/app/components/workflow/nodes/code/types'
import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import type { ContextGenerateResponse } from '@/service/debug'
import * as React from 'react'
import { forwardRef, useCallback, useImperativeHandle, useMemo } from 'react'
import Modal from '@/app/components/base/modal'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks/use-node-data-update'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { NodeRunningStatus, VarType } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'
import LeftPanel from './components/left-panel'
import RightPanel from './components/right-panel'
import useContextGenerate, { normalizeCodeLanguage } from './hooks/use-context-generate'
import useResizablePanels from './hooks/use-resizable-panels'

type Props = {
  isShow: boolean
  onClose: () => void
  toolNodeId: string
  paramKey: string
  codeNodeId: string
  availableVars?: NodeOutPutVar[]
  availableNodes?: Node[]
  onOpenInternalViewAndRun?: () => void
}

export type ContextGenerateModalHandle = {
  onOpen: () => void
}

const normalizeOutputs = (outputs?: Record<string, { type: string }>) => {
  const next: OutputVar = {}
  Object.entries(outputs || {}).forEach(([key, value]) => {
    const type = Object.values(VarType).includes(value?.type as VarType)
      ? value.type as VarType
      : VarType.string
    next[key] = {
      type,
      children: null,
    }
  })
  return next
}

const mapOutputsToResponse = (outputs?: OutputVar) => {
  const next: Record<string, { type: string }> = {}
  Object.entries(outputs || {}).forEach(([key, value]) => {
    next[key] = { type: value.type }
  })
  return next
}

const ContextGenerateModal = forwardRef<ContextGenerateModalHandle, Props>(({
  isShow,
  onClose,
  toolNodeId,
  paramKey,
  codeNodeId,
  availableVars,
  availableNodes,
  onOpenInternalViewAndRun,
}, ref) => {
  const configsMap = useHooksStore(s => s.configsMap)
  const nodes = useStore(s => s.nodes)
  const workflowStore = useWorkflowStore()
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()

  const flowId = configsMap?.flowId || ''
  const storageKey = useMemo(() => {
    const segments = [flowId || 'unknown', toolNodeId, paramKey].filter(Boolean)
    return segments.join('-')
  }, [flowId, paramKey, toolNodeId])

  const codeNode = useMemo(() => {
    return nodes.find(node => node.id === codeNodeId)
  }, [codeNodeId, nodes])
  const codeNodeData = codeNode?.data as CodeNodeType | undefined

  const fallbackVersion = useMemo<ContextGenerateResponse | null>(() => {
    if (!codeNodeData)
      return null
    return {
      variables: (codeNodeData.variables || []).map(variable => ({
        variable: variable.variable,
        value_selector: Array.isArray(variable.value_selector) ? variable.value_selector : [],
      })),
      code_language: codeNodeData.code_language,
      code: codeNodeData.code || '',
      outputs: mapOutputsToResponse(codeNodeData.outputs),
      message: '',
      error: '',
    }
  }, [codeNodeData])

  const {
    current,
    currentVersionIndex,
    setCurrentVersionIndex,
    promptMessages,
    inputValue,
    setInputValue,
    suggestedQuestions,
    hasFetchedSuggestions,
    isGenerating,
    model,
    handleModelChange,
    handleCompletionParamsChange,
    handleGenerate,
    handleReset,
    handleFetchSuggestedQuestions,
    abortSuggestedQuestions,
    resetSuggestions,
    defaultAssistantMessage,
    versionOptions,
    currentVersionLabel,
    isInitView,
  } = useContextGenerate({
    storageKey,
    toolNodeId,
    paramKey,
    codeNodeData,
    availableVars,
    availableNodes,
  })

  const handleCloseModal = useCallback(() => {
    abortSuggestedQuestions()
    resetSuggestions()
    onClose()
  }, [abortSuggestedQuestions, onClose, resetSuggestions])

  const handleResetWithSuggestions = useCallback(() => {
    abortSuggestedQuestions()
    handleReset()
    resetSuggestions()
    void handleFetchSuggestedQuestions({ force: true })
  }, [abortSuggestedQuestions, handleFetchSuggestedQuestions, handleReset, resetSuggestions])

  useImperativeHandle(ref, () => ({
    onOpen: () => {
      void handleFetchSuggestedQuestions()
    },
  }), [handleFetchSuggestedQuestions])

  const displayVersion = isInitView ? null : (current || fallbackVersion)
  const displayCodeLanguage = normalizeCodeLanguage(displayVersion?.code_language)
  const displayOutputData = useMemo<{
    variables: ContextGenerateResponse['variables']
    outputs: ContextGenerateResponse['outputs']
  } | null>(() => {
    if (!displayVersion)
      return null
    return {
      variables: displayVersion.variables,
      outputs: displayVersion.outputs,
    }
  }, [displayVersion])

  const applyToNode = useCallback((closeOnApply: boolean) => {
    if (!current || !codeNodeData)
      return

    const nextOutputs = normalizeOutputs(current.outputs)
    const nextVariables = current.variables.map(item => ({
      variable: item.variable,
      value_selector: Array.isArray(item.value_selector) ? item.value_selector : [],
    }))

    handleNodeDataUpdateWithSyncDraft({
      id: codeNodeId,
      data: {
        ...codeNodeData,
        code_language: normalizeCodeLanguage(current.code_language),
        code: current.code,
        outputs: nextOutputs,
        variables: nextVariables,
      },
    })

    if (closeOnApply)
      handleCloseModal()
  }, [codeNodeData, codeNodeId, current, handleCloseModal, handleNodeDataUpdateWithSyncDraft])

  const handleRun = useCallback(() => {
    if (!codeNodeId)
      return
    if (current)
      applyToNode(false)

    if (onOpenInternalViewAndRun) {
      // Close this modal and open internal view, then run
      handleCloseModal()
      onOpenInternalViewAndRun()
    }
    else {
      // Fallback: direct run (for cases without internal view)
      const store = workflowStore.getState()
      store.setInitShowLastRunTab(true)
      store.setPendingSingleRun({
        nodeId: codeNodeId,
        action: 'run',
      })
    }
  }, [applyToNode, codeNodeId, current, handleCloseModal, onOpenInternalViewAndRun, workflowStore])

  const isRunning = useMemo(() => {
    const target = nodes.find(node => node.id === codeNodeId)
    return target?.data?._singleRunningStatus === NodeRunningStatus.Running
  }, [codeNodeId, nodes])

  const { rightContainerRef, resolvedCodePanelHeight, handleResizeStart } = useResizablePanels()
  const canRun = !!displayVersion?.code || !!codeNodeData?.code
  const canApply = !!current

  return (
    <Modal
      isShow={isShow}
      onClose={handleCloseModal}
      className={cn(
        'max-w-[calc(100vw-32px)] border-[0.5px] border-components-panel-border bg-background-body !p-0 shadow-xl shadow-shadow-shadow-5',
        isInitView ? 'w-[1280px]' : 'w-[1200px]',
      )}
    >
      <div className="relative flex h-[720px] max-h-[calc(100vh-32px)] flex-wrap">
        <LeftPanel
          isInitView={isInitView}
          isGenerating={isGenerating}
          inputValue={inputValue}
          onInputChange={setInputValue}
          onGenerate={handleGenerate}
          onReset={handleResetWithSuggestions}
          suggestedQuestions={suggestedQuestions}
          hasFetchedSuggestions={hasFetchedSuggestions}
          model={model}
          onModelChange={handleModelChange}
          onCompletionParamsChange={handleCompletionParamsChange}
          promptMessages={promptMessages}
          versionOptions={versionOptions}
          currentVersionIndex={currentVersionIndex}
          onSelectVersion={setCurrentVersionIndex}
          defaultAssistantMessage={defaultAssistantMessage}
        />
        <RightPanel
          isInitView={isInitView}
          isGenerating={isGenerating}
          displayVersion={displayVersion}
          displayCodeLanguage={displayCodeLanguage}
          displayOutputData={displayOutputData}
          rightContainerRef={rightContainerRef}
          resolvedCodePanelHeight={resolvedCodePanelHeight}
          onResizeStart={handleResizeStart}
          versionOptions={versionOptions}
          currentVersionIndex={currentVersionIndex}
          currentVersionLabel={currentVersionLabel}
          onSelectVersion={setCurrentVersionIndex}
          onRun={handleRun}
          onApply={() => applyToNode(true)}
          canRun={canRun}
          canApply={canApply}
          isRunning={isRunning}
          onClose={handleCloseModal}
        />
      </div>
    </Modal>
  )
})

ContextGenerateModal.displayName = 'ContextGenerateModal'

export default React.memo(ContextGenerateModal)
