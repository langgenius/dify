'use client'

import type { InputForm } from '@/app/components/base/chat/chat/type'
import type { InputVar as WorkflowInputVar } from '@/app/components/workflow/types'
import type { SnippetInputField } from '@/models/snippet'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import copy from 'copy-to-clipboard'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useCheckInputsForms } from '@/app/components/base/chat/chat/check-input-forms-hooks'
import { getProcessedInputs } from '@/app/components/base/chat/chat/utils'
import Loading from '@/app/components/base/loading'
import {
  useWorkflowInteractions,
  useWorkflowRun,
} from '@/app/components/workflow/hooks'
import FormItem from '@/app/components/workflow/nodes/_base/components/before-run-form/form-item'
import ResultPanel from '@/app/components/workflow/run/result-panel'
import ResultText from '@/app/components/workflow/run/result-text'
import TracingPanel from '@/app/components/workflow/run/tracing-panel'
import { useStore } from '@/app/components/workflow/store'
import {
  InputVarType,
  WorkflowRunningStatus,
} from '@/app/components/workflow/types'
import { formatWorkflowRunIdentifier } from '@/app/components/workflow/utils'
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
  return fields.map(field => ({
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
    if (field.default !== undefined)
      acc[field.variable] = field.default

    return acc
  }, {})
}

const SnippetRunPanel = ({
  fields,
}: SnippetRunPanelProps) => {
  const { t } = useTranslation()
  const { handleCancelDebugAndPreviewPanel } = useWorkflowInteractions()
  const { handleRun } = useWorkflowRun()
  const { checkInputsForm } = useCheckInputsForms()
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const showInputsPanel = useStore(s => s.showInputsPanel)
  const workflowCanvasWidth = useStore(s => s.workflowCanvasWidth)
  const panelWidth = useStore(s => s.previewPanelWidth)
  const setPreviewPanelWidth = useStore(s => s.setPreviewPanelWidth)

  const previewFields = useMemo(() => buildPreviewFields(fields), [fields])
  const initialInputs = useMemo(() => buildInitialInputs(previewFields), [previewFields])
  const [inputOverrides, setInputOverrides] = useState<Record<string, unknown> | null>(null)
  const [selectedTab, setSelectedTab] = useState<string | null>(null)
  const [isResizing, setIsResizing] = useState(false)

  const inputs = inputOverrides ?? initialInputs
  const hasInputTab = showInputsPanel && previewFields.length > 0
  const defaultTab = hasInputTab ? 'INPUT' : 'RESULT'
  const shouldShowDetailByDefault = !!workflowRunningData
    && (workflowRunningData.result.status === WorkflowRunningStatus.Succeeded || workflowRunningData.result.status === WorkflowRunningStatus.Failed)
    && !workflowRunningData.resultText
    && !workflowRunningData.result.files?.length
  const currentTab = selectedTab ?? (shouldShowDetailByDefault ? 'DETAIL' : defaultTab)

  const handleValueChange = useCallback((variable: string, value: unknown) => {
    setInputOverrides(prev => ({
      ...(prev ?? initialInputs),
      [variable]: value,
    }))
  }, [initialInputs])

  const handleSubmit = useCallback(() => {
    if (!checkInputsForm(inputs, previewFields))
      return

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

  const resize = useCallback((e: MouseEvent) => {
    if (!isResizing)
      return

    const newWidth = window.innerWidth - e.clientX
    const reservedCanvasWidth = 400
    const maxAllowed = workflowCanvasWidth ? (workflowCanvasWidth - reservedCanvasWidth) : 1024

    if (newWidth >= 400 && newWidth <= maxAllowed)
      setPreviewPanelWidth(newWidth)
  }, [isResizing, setPreviewPanelWidth, workflowCanvasWidth])

  useEffect(() => {
    window.addEventListener('mousemove', resize)
    window.addEventListener('mouseup', stopResizing)
    return () => {
      window.removeEventListener('mousemove', resize)
      window.removeEventListener('mouseup', stopResizing)
    }
  }, [resize, stopResizing])

  return (
    <div
      className="relative flex h-full flex-col rounded-l-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl"
      style={{ width: `${panelWidth}px` }}
    >
      <div
        className="absolute top-1/2 bottom-0 left-[3px] z-50 h-6 w-[3px] cursor-col-resize rounded bg-gray-300"
        onMouseDown={startResizing}
      />
      <div className="flex items-center justify-between p-4 pb-1 text-base font-semibold text-text-primary">
        {`Test Run${formatWorkflowRunIdentifier(workflowRunningData?.result.finished_at, workflowRunningData?.result.status)}`}
        <div className="cursor-pointer p-1" onClick={handleCancelDebugAndPreviewPanel}>
          <span className="i-ri-close-line h-4 w-4 text-text-tertiary" />
        </div>
      </div>
      <div className="relative flex grow flex-col">
        <div className="flex shrink-0 items-center border-b-[0.5px] border-divider-subtle px-4">
          {hasInputTab && (
            <div
              className={`mr-6 cursor-pointer border-b-2 py-3 text-[13px] leading-[18px] font-semibold ${currentTab === 'INPUT' ? '!border-[rgb(21,94,239)] text-text-secondary' : 'border-transparent text-text-tertiary'}`}
              onClick={() => setSelectedTab('INPUT')}
            >
              {t('input', { ns: 'runLog' })}
            </div>
          )}
          <div
            className={`mr-6 cursor-pointer border-b-2 py-3 text-[13px] leading-[18px] font-semibold ${currentTab === 'RESULT' ? '!border-[rgb(21,94,239)] text-text-secondary' : 'border-transparent text-text-tertiary'} ${!workflowRunningData ? '!cursor-not-allowed opacity-30' : ''}`}
            onClick={() => workflowRunningData && setSelectedTab('RESULT')}
          >
            {t('result', { ns: 'runLog' })}
          </div>
          <div
            className={`mr-6 cursor-pointer border-b-2 py-3 text-[13px] leading-[18px] font-semibold ${currentTab === 'DETAIL' ? '!border-[rgb(21,94,239)] text-text-secondary' : 'border-transparent text-text-tertiary'} ${!workflowRunningData ? '!cursor-not-allowed opacity-30' : ''}`}
            onClick={() => workflowRunningData && setSelectedTab('DETAIL')}
          >
            {t('detail', { ns: 'runLog' })}
          </div>
          <div
            className={`mr-6 cursor-pointer border-b-2 py-3 text-[13px] leading-[18px] font-semibold ${currentTab === 'TRACING' ? '!border-[rgb(21,94,239)] text-text-secondary' : 'border-transparent text-text-tertiary'} ${!workflowRunningData ? '!cursor-not-allowed opacity-30' : ''}`}
            onClick={() => workflowRunningData && setSelectedTab('TRACING')}
          >
            {t('tracing', { ns: 'runLog' })}
          </div>
        </div>
        <div className={`h-0 grow overflow-y-auto rounded-b-2xl ${(currentTab === 'RESULT' || currentTab === 'TRACING') ? '!bg-background-section-burn' : 'bg-components-panel-bg'}`}>
          {currentTab === 'INPUT' && hasInputTab && (
            <>
              <div className="px-4 pt-3 pb-2">
                {previewFields.map((field, index) => (
                  <div
                    key={field.variable}
                    className="mb-2 last-of-type:mb-0"
                  >
                    <FormItem
                      autoFocus={index === 0}
                      className="!block"
                      payload={field}
                      value={inputs[field.variable]}
                      onChange={value => handleValueChange(field.variable, value)}
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
                  {t('singleRun.startRun', { ns: 'workflow' })}
                </Button>
              </div>
            </>
          )}
          {currentTab === 'RESULT' && (
            <div className="p-2">
              <ResultText
                isRunning={workflowRunningData?.result?.status === WorkflowRunningStatus.Running || !workflowRunningData?.result}
                outputs={workflowRunningData?.resultText}
                allFiles={workflowRunningData?.result?.files}
                error={workflowRunningData?.result?.error}
                onClick={() => setSelectedTab('DETAIL')}
              />
              {(workflowRunningData?.result.status === WorkflowRunningStatus.Succeeded && workflowRunningData?.resultText && typeof workflowRunningData.resultText === 'string') && (
                <Button
                  className="mb-4 ml-4 space-x-1"
                  onClick={() => {
                    copy(workflowRunningData?.resultText || '')
                    toast.success(t('actionMsg.copySuccessfully', { ns: 'common' }))
                  }}
                >
                  <span className="i-ri-clipboard-line h-3.5 w-3.5" />
                  <div>{t('operation.copy', { ns: 'common' })}</div>
                </Button>
              )}
            </div>
          )}
          {currentTab === 'DETAIL' && workflowRunningData?.result && (
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
              created_by={(workflowRunningData.result?.created_by as unknown as { name: string })?.name}
              steps={workflowRunningData.result?.total_steps}
              exceptionCounts={workflowRunningData.result?.exceptions_count}
            />
          )}
          {currentTab === 'DETAIL' && !workflowRunningData?.result && (
            <div className="flex h-full items-center justify-center bg-components-panel-bg">
              <Loading />
            </div>
          )}
          {currentTab === 'TRACING' && (
            <TracingPanel
              className="bg-background-section-burn"
              list={workflowRunningData?.tracing || []}
            />
          )}
          {currentTab === 'TRACING' && !workflowRunningData?.tracing?.length && (
            <div className="flex h-full items-center justify-center !bg-background-section-burn">
              <Loading />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default memo(SnippetRunPanel)
