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
import Button from '@/app/components/base/button'
import Loading from '@/app/components/base/loading'
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
import InputsPanel from './inputs-panel'

const WorkflowPreview = () => {
  const { t } = useTranslation()
  const { handleCancelDebugAndPreviewPanel } = useWorkflowInteractions()
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const isListening = useStore(s => s.isListening)
  const showInputsPanel = useStore(s => s.showInputsPanel)
  const workflowCanvasWidth = useStore(s => s.workflowCanvasWidth)
  const panelWidth = useStore(s => s.previewPanelWidth)
  const setPreviewPanelWidth = useStore(s => s.setPreviewPanelWidth)
  const showDebugAndPreviewPanel = useStore(s => s.showDebugAndPreviewPanel)
  const [currentTab, setCurrentTab] = useState<string>(showInputsPanel ? 'INPUT' : 'TRACING')

  const switchTab = async (tab: string) => {
    setCurrentTab(tab)
  }

  useEffect(() => {
    if (showDebugAndPreviewPanel && showInputsPanel)
      setCurrentTab('INPUT')
  }, [showDebugAndPreviewPanel, showInputsPanel])

  useEffect(() => {
    if (isListening)
      switchTab('DETAIL')
  }, [isListening])

  useEffect(() => {
    const status = workflowRunningData?.result.status
    if (!workflowRunningData)
      return

    if ((status === WorkflowRunningStatus.Succeeded || status === WorkflowRunningStatus.Failed) && !workflowRunningData.resultText && !workflowRunningData.result.files?.length)
      switchTab('DETAIL')
  }, [workflowRunningData])

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
        {`Test Run${formatWorkflowRunIdentifier(workflowRunningData?.result.finished_at)}`}
        <div className="cursor-pointer p-1" onClick={() => handleCancelDebugAndPreviewPanel()}>
          <RiCloseLine className="h-4 w-4 text-text-tertiary" />
        </div>
      </div>
      <div className="relative flex grow flex-col">
        <div className="flex shrink-0 items-center border-b-[0.5px] border-divider-subtle px-4">
          {showInputsPanel && (
            <div
              className={cn(
                'mr-6 cursor-pointer border-b-2 border-transparent py-3 text-[13px] font-semibold leading-[18px] text-text-tertiary',
                currentTab === 'INPUT' && '!border-[rgb(21,94,239)] text-text-secondary',
              )}
              onClick={() => switchTab('INPUT')}
            >
              {t('input', { ns: 'runLog' })}
            </div>
          )}
          <div
            className={cn(
              'mr-6 cursor-pointer border-b-2 border-transparent py-3 text-[13px] font-semibold leading-[18px] text-text-tertiary',
              currentTab === 'RESULT' && '!border-[rgb(21,94,239)] text-text-secondary',
              !workflowRunningData && '!cursor-not-allowed opacity-30',
            )}
            onClick={() => {
              if (!workflowRunningData)
                return
              switchTab('RESULT')
            }}
          >
            {t('result', { ns: 'runLog' })}
          </div>
          <div
            className={cn(
              'mr-6 cursor-pointer border-b-2 border-transparent py-3 text-[13px] font-semibold leading-[18px] text-text-tertiary',
              currentTab === 'DETAIL' && '!border-[rgb(21,94,239)] text-text-secondary',
              !workflowRunningData && '!cursor-not-allowed opacity-30',
            )}
            onClick={() => {
              if (!workflowRunningData)
                return
              switchTab('DETAIL')
            }}
          >
            {t('detail', { ns: 'runLog' })}
          </div>
          <div
            className={cn(
              'mr-6 cursor-pointer border-b-2 border-transparent py-3 text-[13px] font-semibold leading-[18px] text-text-tertiary',
              currentTab === 'TRACING' && '!border-[rgb(21,94,239)] text-text-secondary',
              !workflowRunningData && '!cursor-not-allowed opacity-30',
            )}
            onClick={() => {
              if (!workflowRunningData)
                return
              switchTab('TRACING')
            }}
          >
            {t('tracing', { ns: 'runLog' })}
          </div>
        </div>
        <div className={cn(
          'h-0 grow overflow-y-auto rounded-b-2xl bg-components-panel-bg',
          (currentTab === 'RESULT' || currentTab === 'TRACING') && '!bg-background-section-burn',
        )}
        >
          {currentTab === 'INPUT' && showInputsPanel && (
            <InputsPanel onRun={() => switchTab('RESULT')} />
          )}
          {currentTab === 'RESULT' && (
            <>
              <ResultText
                isRunning={workflowRunningData?.result?.status === WorkflowRunningStatus.Running || !workflowRunningData?.result}
                outputs={workflowRunningData?.resultText}
                allFiles={workflowRunningData?.result?.files}
                error={workflowRunningData?.result?.error}
                onClick={() => switchTab('DETAIL')}
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
            </>
          )}
          {currentTab === 'DETAIL' && (
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
              created_by={(workflowRunningData?.result?.created_by as any)?.name}
              steps={workflowRunningData?.result?.total_steps}
              exceptionCounts={workflowRunningData?.result?.exceptions_count}
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

export default memo(WorkflowPreview)
