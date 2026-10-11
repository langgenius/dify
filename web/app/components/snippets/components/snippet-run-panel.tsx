'use client'

import type { InputForm } from '@/app/components/base/chat/chat/type'
import type { InputVar as WorkflowInputVar } from '@/app/components/workflow/types'
import type { SnippetInputField } from '@/models/snippet'
import { Button } from '@langgenius/dify-ui/button'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import copy from 'copy-to-clipboard'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useReactFlowStore } from 'reactflow'
import { useCheckInputsForms } from '@/app/components/base/chat/chat/check-input-forms-hooks'
import { getProcessedInputs } from '@/app/components/base/chat/chat/utils'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import ResizeHandle from '@/app/components/base/resize-handle'
import { useWorkflowInteractions } from '@/app/components/workflow/hooks/use-workflow-panel-interactions'
import { useWorkflowRun } from '@/app/components/workflow/hooks/use-workflow-run'
import FormItem from '@/app/components/workflow/nodes/_base/components/before-run-form/form-item'
import { getPreviewPanelMaxWidth } from '@/app/components/workflow/panel/panel-width'
import ResultPanel from '@/app/components/workflow/run/result-panel'
import ResultText from '@/app/components/workflow/run/result-text'
import TracingPanel from '@/app/components/workflow/run/tracing-panel'
import { useStore } from '@/app/components/workflow/store'
import { InputVarType, WorkflowRunningStatus } from '@/app/components/workflow/types'
import { formatWorkflowRunIdentifier } from '@/app/components/workflow/utils'
import { toast } from '@/app/notifications'
import { PipelineInputVarType } from '@/models/pipeline'

type SnippetRunPanelProps = {
  fields: SnippetInputField[]
}

type SnippetRunField = WorkflowInputVar & InputForm

const PIPELINE_TO_WORKFLOW_INPUT_VAR_TYPE: Record<PipelineInputVarType, InputVarType> = {
  [PipelineInputVarType.textInput]: InputVarType.textInput,
  [PipelineInputVarType.paragraph]: InputVarType.paragraph,
  [PipelineInputVarType.select]: InputVarType.select,
  [PipelineInputVarType.number]: InputVarType.number,
  [PipelineInputVarType.singleFile]: InputVarType.singleFile,
  [PipelineInputVarType.multiFiles]: InputVarType.multiFiles,
  [PipelineInputVarType.checkbox]: InputVarType.checkbox,
}

const buildPreviewFields = (fields: SnippetInputField[]): SnippetRunField[] => {
  return fields.map((field) => ({
    type: PIPELINE_TO_WORKFLOW_INPUT_VAR_TYPE[field.type],
    label: field.label,
    variable: field.variable,
    max_length: field.max_length,
    default: field.default_value,
    required: field.required,
    options: field.options,
    placeholder: field.placeholder,
    unit: field.unit,
    hide: false,
    allowed_file_upload_methods: field.allowed_file_upload_methods,
    allowed_file_types: field.allowed_file_types,
    allowed_file_extensions: field.allowed_file_extensions,
  }))
}

const buildInitialInputs = (fields: SnippetRunField[]) => {
  return fields.reduce<Record<string, unknown>>((acc, field) => {
    if (field.default !== undefined) acc[field.variable] = field.default

    return acc
  }, {})
}

const SnippetRunPanel = ({ fields }: SnippetRunPanelProps) => {
  const { t } = useTranslation(['common', 'runLog', 'workflow'])
  const panelId = useId()
  const { handleCancelDebugAndPreviewPanel } = useWorkflowInteractions()
  const { handleRun } = useWorkflowRun()
  const { checkInputsForm } = useCheckInputsForms()
  const workflowRunningData = useStore((s) => s.workflowRunningData)
  const showInputsPanel = useStore((s) => s.showInputsPanel)
  const workflowCanvasWidth = useStore((s) => s.workflowCanvasWidth)
  const panelWidth = useStore((s) => s.previewPanelWidth)
  const setPreviewPanelWidth = useStore((s) => s.setPreviewPanelWidth)
  const hasSelectedNode = useReactFlowStore((s) => s.getNodes().some((node) => node.data.selected))
  const maxPanelWidth = getPreviewPanelMaxWidth(workflowCanvasWidth, hasSelectedNode)

  const previewFields = useMemo(() => buildPreviewFields(fields), [fields])
  const initialInputs = useMemo(() => buildInitialInputs(previewFields), [previewFields])
  const [inputOverrides, setInputOverrides] = useState<Record<string, unknown> | null>(null)
  const [selectedTab, setSelectedTab] = useState<string | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const inputPanelRef = useRef<HTMLDivElement>(null)
  const isInitialMountRef = useRef(true)

  const inputs = inputOverrides ?? initialInputs
  const hasInputTab = showInputsPanel && previewFields.length > 0
  const defaultTab = hasInputTab ? 'INPUT' : 'RESULT'
  const shouldShowDetailByDefault =
    !!workflowRunningData &&
    (workflowRunningData.result.status === WorkflowRunningStatus.Succeeded ||
      workflowRunningData.result.status === WorkflowRunningStatus.Failed) &&
    !workflowRunningData.resultText &&
    !workflowRunningData.result.files?.length
  const currentTab = selectedTab ?? (shouldShowDetailByDefault ? 'DETAIL' : defaultTab)
  const shouldFocusFirstInput = [
    InputVarType.textInput,
    InputVarType.paragraph,
    InputVarType.number,
  ].some((type) => type === previewFields[0]?.type)

  const handleValueChange = useCallback(
    (variable: string, value: unknown) => {
      setInputOverrides((prev) => ({
        ...(prev ?? initialInputs),
        [variable]: value,
      }))
    },
    [initialInputs],
  )

  const handleSubmit = useCallback(() => {
    if (!checkInputsForm(inputs, previewFields)) return

    setSelectedTab('RESULT')
    handleRun({
      inputs: getProcessedInputs(inputs, previewFields),
    })
  }, [checkInputsForm, handleRun, inputs, previewFields])

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  const stopResizing = useCallback(() => {
    setIsResizing(false)
  }, [])

  const resize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return

      const newWidth = window.innerWidth - e.clientX
      if (newWidth >= 400 && newWidth <= maxPanelWidth) setPreviewPanelWidth(newWidth)
    },
    [isResizing, setPreviewPanelWidth, maxPanelWidth],
  )

  useEffect(() => {
    window.addEventListener('mousemove', resize)
    window.addEventListener('mouseup', stopResizing)
    return () => {
      window.removeEventListener('mousemove', resize)
      window.removeEventListener('mouseup', stopResizing)
    }
  }, [resize, stopResizing])

  useEffect(() => {
    if (!isInitialMountRef.current) return
    isInitialMountRef.current = false

    if (currentTab !== 'INPUT' || !hasInputTab || !shouldFocusFirstInput) return

    inputPanelRef.current?.querySelector<HTMLElement>('input, textarea')?.focus()
  }, [currentTab, hasInputTab, shouldFocusFirstInput])

  return (
    <div
      id={panelId}
      className="relative flex h-full flex-col rounded-l-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl"
      style={{ width: `${panelWidth}px` }}
    >
      <ResizeHandle
        side="left"
        value={panelWidth}
        min={400}
        max={maxPanelWidth}
        controls={panelId}
        label={t(($) => $['singleRun.testRun'], { ns: 'workflow' })}
        onResize={setPreviewPanelWidth}
        className="absolute top-1/2 bottom-0 left-0.75 z-50 h-6 w-0.75 cursor-col-resize bg-state-base-handle"
        onMouseDown={startResizing}
      />
      <div className="flex items-center justify-between p-4 pb-1 text-base font-semibold text-text-primary">
        {`Test Run${formatWorkflowRunIdentifier(workflowRunningData?.result.finished_at, workflowRunningData?.result.status)}`}
        <IconButton
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          onClick={handleCancelDebugAndPreviewPanel}
        >
          <span aria-hidden className="i-ri-close-line h-4 w-4" />
        </IconButton>
      </div>
      <Tabs
        value={currentTab}
        onValueChange={(value) => setSelectedTab(value as string)}
        className="relative flex grow flex-col"
      >
        <TabsList
          aria-label={t(($) => $['singleRun.testRun'], { ns: 'workflow' })}
          activateOnFocus
          className="shrink-0 items-center gap-6 border-b-[0.5px] border-divider-subtle px-4"
        >
          {hasInputTab && (
            <TabsTab value="INPUT" className="py-3 text-[13px] leading-4.5 font-semibold">
              {t(($) => $.input, { ns: 'runLog' })}
            </TabsTab>
          )}
          <TabsTab
            value="RESULT"
            disabled={!workflowRunningData}
            className="py-3 text-[13px] leading-4.5 font-semibold"
          >
            {t(($) => $.result, { ns: 'runLog' })}
          </TabsTab>
          <TabsTab
            value="DETAIL"
            disabled={!workflowRunningData}
            className="py-3 text-[13px] leading-4.5 font-semibold"
          >
            {t(($) => $.detail, { ns: 'runLog' })}
          </TabsTab>
          <TabsTab
            value="TRACING"
            disabled={!workflowRunningData}
            className="py-3 text-[13px] leading-4.5 font-semibold"
          >
            {t(($) => $.tracing, { ns: 'runLog' })}
          </TabsTab>
        </TabsList>
        <div
          className={`h-0 grow overflow-y-auto rounded-b-2xl ${currentTab === 'RESULT' || currentTab === 'TRACING' ? 'bg-background-section-burn!' : 'bg-components-panel-bg'}`}
        >
          <TabsPanel value="INPUT">
            {hasInputTab && (
              <>
                <div ref={inputPanelRef} className="px-4 pt-3 pb-2">
                  {previewFields.map((field) => (
                    <div key={field.variable} className="mb-2 last-of-type:mb-0">
                      <FormItem
                        className="block!"
                        payload={field}
                        value={inputs[field.variable]}
                        onChange={(value) => handleValueChange(field.variable, value)}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between px-4 py-2">
                  <Button
                    variant="primary"
                    className="w-full"
                    disabled={workflowRunningData?.result?.status === WorkflowRunningStatus.Running}
                    onClick={handleSubmit}
                  >
                    {t(($) => $['singleRun.startRun'], { ns: 'workflow' })}
                  </Button>
                </div>
              </>
            )}
          </TabsPanel>
          <TabsPanel value="RESULT">
            <div className="p-2">
              <ResultText
                isRunning={
                  workflowRunningData?.result?.status === WorkflowRunningStatus.Running ||
                  !workflowRunningData?.result
                }
                outputs={workflowRunningData?.resultText}
                allFiles={workflowRunningData?.result?.files}
                error={workflowRunningData?.result?.error}
                onClick={() => workflowRunningData && setSelectedTab('DETAIL')}
              />
              {workflowRunningData?.result.status === WorkflowRunningStatus.Succeeded &&
                workflowRunningData?.resultText &&
                typeof workflowRunningData.resultText === 'string' && (
                  <Button
                    className="mb-4 ml-4"
                    onClick={() => {
                      copy(workflowRunningData?.resultText || '')
                      toast.success(t(($) => $['actionMsg.copySuccessfully'], { ns: 'common' }))
                    }}
                  >
                    <span className="i-ri-clipboard-line h-3.5 w-3.5" />
                    <div>{t(($) => $['operation.copy'], { ns: 'common' })}</div>
                  </Button>
                )}
            </div>
          </TabsPanel>
          <TabsPanel value="DETAIL">
            {workflowRunningData?.result && (
              <ResultPanel
                inputs={workflowRunningData.result?.inputs}
                inputs_truncated={workflowRunningData.result?.inputs_truncated}
                process_data={workflowRunningData.result?.process_data}
                process_data_truncated={workflowRunningData.result?.process_data_truncated}
                outputs={workflowRunningData.result?.outputs}
                outputs_truncated={workflowRunningData.result?.outputs_truncated}
                outputs_full_content={workflowRunningData.result?.outputs_full_content}
                status={workflowRunningData.result?.status || ''}
                error={workflowRunningData.result?.error}
                elapsed_time={workflowRunningData.result?.elapsed_time}
                total_tokens={workflowRunningData.result?.total_tokens}
                created_at={workflowRunningData.result?.created_at}
                created_by={
                  (workflowRunningData.result?.created_by as unknown as { name: string })?.name
                }
                steps={workflowRunningData.result?.total_steps}
                exceptionCounts={workflowRunningData.result?.exceptions_count}
              />
            )}
            {!workflowRunningData?.result && (
              <div className="flex h-full items-center justify-center bg-components-panel-bg">
                <LoadingPlaceholder />
              </div>
            )}
          </TabsPanel>
          <TabsPanel value="TRACING">
            <TracingPanel
              className="bg-background-section-burn"
              list={workflowRunningData?.tracing || []}
            />
            {!workflowRunningData?.tracing?.length && (
              <div className="flex h-full items-center justify-center bg-background-section-burn!">
                <LoadingPlaceholder />
              </div>
            )}
          </TabsPanel>
        </div>
      </Tabs>
    </div>
  )
}

export default memo(SnippetRunPanel)
