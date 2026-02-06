import {
  RiClipboardLine,
  RiCloseLine,
} from '@remixicon/react'
import copy from 'copy-to-clipboard'
import {
  memo,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import { RefreshCcw01 } from '@/app/components/base/icons/src/vender/line/arrows'
import Loading from '@/app/components/base/loading'
import Tooltip from '@/app/components/base/tooltip'
import { submitHumanInputForm } from '@/service/workflow'
import { cn } from '@/utils/classnames'
import Toast from '../../base/toast'
import {
  useWorkflowInteractions,
} from '../hooks'
import ResultPanel from '../run/result-panel'
import ResultText from '../run/result-text'
import TracingPanel from '../run/tracing-panel'
import { useStore } from '../store'
import {
  WorkflowRunningStatus,
} from '../types'
import { formatWorkflowRunIdentifier } from '../utils'
import HumanInputFilledFormList from './human-input-filled-form-list'
import HumanInputFormList from './human-input-form-list'
import InputsPanel from './inputs-panel'

const WorkflowPreview = () => {
  const { t } = useTranslation()
  const { handleCancelDebugAndPreviewPanel, handleClearWorkflowRunHistory } = useWorkflowInteractions()
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const isListening = useStore(s => s.isListening)
  const showInputsPanel = useStore(s => s.showInputsPanel)
  const workflowCanvasWidth = useStore(s => s.workflowCanvasWidth)
  const panelWidth = useStore(s => s.previewPanelWidth)
  const setPreviewPanelWidth = useStore(s => s.setPreviewPanelWidth)
  const humanInputFormDataList = useStore(s => s.workflowRunningData?.humanInputFormDataList)
  const humanInputFilledFormDataList = useStore(s => s.workflowRunningData?.humanInputFilledFormDataList)
  const [userSelectedTab, setUserSelectedTab] = useState<string | null>(null)

  const effectiveTab = (() => {
    if (isListening)
      return 'DETAIL'

    if (workflowRunningData) {
      const status = workflowRunningData.result.status
      const isFinishedWithoutOutput = (status === WorkflowRunningStatus.Succeeded || status === WorkflowRunningStatus.Failed)
        && !workflowRunningData.resultText
        && !workflowRunningData.result.files?.length

      if (status === WorkflowRunningStatus.Paused && humanInputFormDataList?.length)
        return 'RESULT'

      if (isFinishedWithoutOutput && userSelectedTab === null)
        return 'DETAIL'

      return userSelectedTab ?? 'RESULT'
    }

    if (showInputsPanel)
      return 'INPUT'

    return 'TRACING'
  })()

  const handleTabChange = (tab: string) => {
    setUserSelectedTab(tab)
  }

  const [isResizing, setIsResizing] = useState(false)

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  const stopResizing = useCallback(() => {
    setIsResizing(false)
  }, [])

  const resize = useCallback((e: MouseEvent) => {
    if (isResizing) {
      const newWidth = window.innerWidth - e.clientX
      // width constraints: 400 <= width <= maxAllowed (canvas - reserved 400)
      const reservedCanvasWidth = 400
      const maxAllowed = workflowCanvasWidth ? (workflowCanvasWidth - reservedCanvasWidth) : 1024

      if (newWidth >= 400 && newWidth <= maxAllowed)
        setPreviewPanelWidth(newWidth)
    }
  }, [isResizing, workflowCanvasWidth, setPreviewPanelWidth])

  useEffect(() => {
    window.addEventListener('mousemove', resize)
    window.addEventListener('mouseup', stopResizing)
    return () => {
      window.removeEventListener('mousemove', resize)
      window.removeEventListener('mouseup', stopResizing)
    }
  }, [resize, stopResizing])

  const handleSubmitHumanInputForm = useCallback(async (formToken: string, formData: {
    inputs: Record<string, string>
    action: string
  }) => {
    await submitHumanInputForm(formToken, formData)
  }, [])

  return (
    <div
      className="relative flex h-full flex-col rounded-l-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl"
      style={{ width: `${panelWidth}px` }}
    >
      <div
        className="absolute bottom-0 left-[3px] top-1/2 z-50 h-6 w-[3px] cursor-col-resize rounded bg-gray-300"
        onMouseDown={startResizing}
      />
      <div className="flex items-center justify-between p-4 pb-1 text-base font-semibold text-text-primary">
        {`${t('singleRun.testRun', { ns: 'workflow' })}${workflowRunningData ? formatWorkflowRunIdentifier(workflowRunningData.result.finished_at, t('common.running', { ns: 'workflow' })) : ''}`}
        <div className="flex items-center gap-1">
          <Tooltip popupContent={t('operation.refresh', { ns: 'common' })}>
            <ActionButton onClick={() => {
              setUserSelectedTab(null)
              handleClearWorkflowRunHistory()
            }}
            >
              <RefreshCcw01 className="h-4 w-4" />
            </ActionButton>
          </Tooltip>
          <div className="mx-3 h-3.5 w-[1px] bg-divider-regular" />
          <div className="cursor-pointer p-1" onClick={() => handleCancelDebugAndPreviewPanel()}>
            <RiCloseLine className="h-4 w-4 text-text-tertiary" />
          </div>
        </div>
      </div>
      <div className="relative flex grow flex-col">
        <div className="flex shrink-0 items-center border-b-[0.5px] border-divider-subtle px-4">
          {showInputsPanel
            ? (
                <div
                  className={cn(
                    'mr-6 cursor-pointer border-b-2 border-transparent py-3 text-[13px] font-semibold leading-[18px] text-text-tertiary',
                    effectiveTab === 'INPUT' && '!border-[rgb(21,94,239)] text-text-secondary',
                  )}
                  onClick={() => handleTabChange('INPUT')}
                >
                  {t('input', { ns: 'runLog' })}
                </div>
              )
            : null}
          <div
            className={cn(
              'mr-6 cursor-pointer border-b-2 border-transparent py-3 text-[13px] font-semibold leading-[18px] text-text-tertiary',
              effectiveTab === 'RESULT' && '!border-[rgb(21,94,239)] text-text-secondary',
              !workflowRunningData && '!cursor-not-allowed opacity-30',
            )}
            onClick={() => {
              if (!workflowRunningData)
                return
              handleTabChange('RESULT')
            }}
          >
            {t('result', { ns: 'runLog' })}
          </div>
          <div
            className={cn(
              'mr-6 cursor-pointer border-b-2 border-transparent py-3 text-[13px] font-semibold leading-[18px] text-text-tertiary',
              effectiveTab === 'DETAIL' && '!border-[rgb(21,94,239)] text-text-secondary',
              !workflowRunningData && '!cursor-not-allowed opacity-30',
            )}
            onClick={() => {
              if (!workflowRunningData)
                return
              handleTabChange('DETAIL')
            }}
          >
            {t('detail', { ns: 'runLog' })}
          </div>
          <div
            className={cn(
              'mr-6 cursor-pointer border-b-2 border-transparent py-3 text-[13px] font-semibold leading-[18px] text-text-tertiary',
              effectiveTab === 'TRACING' && '!border-[rgb(21,94,239)] text-text-secondary',
              !workflowRunningData && '!cursor-not-allowed opacity-30',
            )}
            onClick={() => {
              if (!workflowRunningData)
                return
              handleTabChange('TRACING')
            }}
          >
            {t('tracing', { ns: 'runLog' })}
          </div>
        </div>
        <div className={cn(
          'h-0 grow overflow-y-auto rounded-b-2xl bg-components-panel-bg',
          (effectiveTab === 'RESULT' || effectiveTab === 'TRACING') && '!bg-background-section-burn',
        )}
        >
          {effectiveTab === 'INPUT' && showInputsPanel
            ? <InputsPanel onRun={() => handleTabChange('RESULT')} />
            : null}
          {effectiveTab === 'RESULT'
            ? (
                <div className="p-2">
                  {humanInputFormDataList && humanInputFormDataList.length > 0 && (
                    <HumanInputFormList
                      humanInputFormDataList={humanInputFormDataList}
                      onHumanInputFormSubmit={handleSubmitHumanInputForm}
                    />
                  )}
                  {humanInputFilledFormDataList && humanInputFilledFormDataList.length > 0 && (
                    <HumanInputFilledFormList
                      humanInputFilledFormDataList={humanInputFilledFormDataList}
                    />
                  )}
                  <ResultText
                    isRunning={workflowRunningData?.result?.status === WorkflowRunningStatus.Running || !workflowRunningData?.result}
                    isPaused={workflowRunningData?.result?.status === WorkflowRunningStatus.Paused}
                    outputs={workflowRunningData?.resultText}
                    llmGenerationItems={workflowRunningData?.resultLLMGenerationItems}
                    allFiles={workflowRunningData?.result?.files}
                    error={workflowRunningData?.result?.error}
                    onClick={() => handleTabChange('DETAIL')}
                  />
                  {(workflowRunningData?.result.status === WorkflowRunningStatus.Succeeded && workflowRunningData?.resultText && typeof workflowRunningData?.resultText === 'string') && (
                    <Button
                      className={cn('mb-4 ml-4 space-x-1')}
                      onClick={() => {
                        const content = workflowRunningData?.resultText
                        if (typeof content === 'string')
                          copy(content)
                        else
                          copy(JSON.stringify(content))
                        Toast.notify({ type: 'success', message: t('actionMsg.copySuccessfully', { ns: 'common' }) })
                      }}
                    >
                      <RiClipboardLine className="h-3.5 w-3.5" />
                      <div>{t('operation.copy', { ns: 'common' })}</div>
                    </Button>
                  )}
                </div>
              )
            : null}
          {effectiveTab === 'DETAIL'
            ? (
                <ResultPanel
                  inputs={workflowRunningData?.result?.inputs}
                  inputs_truncated={workflowRunningData?.result?.inputs_truncated}
                  process_data={workflowRunningData?.result?.process_data}
                  process_data_truncated={workflowRunningData?.result?.process_data_truncated}
                  outputs={workflowRunningData?.result?.outputs}
                  outputs_truncated={workflowRunningData?.result?.outputs_truncated}
                  outputs_full_content={workflowRunningData?.result?.outputs_full_content}
                  status={workflowRunningData?.result?.status || ''}
                  error={workflowRunningData?.result?.error}
                  elapsed_time={workflowRunningData?.result?.elapsed_time}
                  total_tokens={workflowRunningData?.result?.total_tokens}
                  created_at={workflowRunningData?.result?.created_at}
                  created_by={workflowRunningData?.result?.created_by?.name}
                  steps={workflowRunningData?.result?.total_steps}
                  exceptionCounts={workflowRunningData?.result?.exceptions_count}
                />
              )
            : null}
          {effectiveTab === 'DETAIL' && !workflowRunningData?.result
            ? (
                <div className="flex h-full items-center justify-center bg-components-panel-bg">
                  <Loading />
                </div>
              )
            : null}
          {effectiveTab === 'TRACING'
            ? (
                <TracingPanel
                  className="bg-background-section-burn"
                  list={workflowRunningData?.tracing || []}
                />
              )
            : null}
          {effectiveTab === 'TRACING' && !workflowRunningData?.tracing?.length
            ? (
                <div className="flex h-full items-center justify-center !bg-background-section-burn">
                  <Loading />
                </div>
              )
            : null}
        </div>
      </div>
    </div>
  )
}

export default memo(WorkflowPreview)
