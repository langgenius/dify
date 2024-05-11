import {
  memo,
  useEffect,
  // useRef,
  useState,
} from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import copy from 'copy-to-clipboard'
import ResultText from '../run/result-text'
import ResultPanel from '../run/result-panel'
import TracingPanel from '../run/tracing-panel'
import {
  useWorkflowInteractions,
} from '../hooks'
import { useStore } from '../store'
import {
  WorkflowRunningStatus,
} from '../types'
import { SimpleBtn } from '../../app/text-generate/item'
import Toast from '../../base/toast'
import InputsPanel from './inputs-panel'
import Loading from '@/app/components/base/loading'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'
import { Clipboard } from '@/app/components/base/icons/src/vender/line/files'

const WorkflowPreview = () => {
  const { t } = useTranslation()
  const { handleCancelDebugAndPreviewPanel } = useWorkflowInteractions()
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const showInputsPanel = useStore(s => s.showInputsPanel)
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
    if ((workflowRunningData?.result.status === WorkflowRunningStatus.Succeeded || workflowRunningData?.result.status === WorkflowRunningStatus.Failed) && !workflowRunningData.resultText)
      switchTab('DETAIL')
  }, [workflowRunningData])

  return (
    <div className={`
      flex flex-col w-[420px] h-full rounded-l-2xl border-[0.5px] border-gray-200 shadow-xl bg-white
    `}>
      <div className='flex items-center justify-between p-4 pb-1 text-base font-semibold text-gray-900'>
        {`Test Run${!workflowRunningData?.result.sequence_number ? '' : `#${workflowRunningData?.result.sequence_number}`}`}
        <div className='p-1 cursor-pointer' onClick={() => handleCancelDebugAndPreviewPanel()}>
          <XClose className='w-4 h-4 text-gray-500' />
        </div>
      </div>
      <div className='grow relative flex flex-col'>
        <div className='shrink-0 flex items-center px-4 border-b-[0.5px] border-[rgba(0,0,0,0.05)]'>
          {showInputsPanel && (
            <div
              className={cn(
                'mr-6 py-3 border-b-2 border-transparent text-[13px] font-semibold leading-[18px] text-gray-400 cursor-pointer',
                currentTab === 'INPUT' && '!border-[rgb(21,94,239)] text-gray-700',
              )}
              onClick={() => switchTab('INPUT')}
            >{t('runLog.input')}</div>
          )}
          <div
            className={cn(
              'mr-6 py-3 border-b-2 border-transparent text-[13px] font-semibold leading-[18px] text-gray-400 cursor-pointer',
              currentTab === 'RESULT' && '!border-[rgb(21,94,239)] text-gray-700',
              !workflowRunningData && 'opacity-30 !cursor-not-allowed',
            )}
            onClick={() => {
              if (!workflowRunningData)
                return
              switchTab('RESULT')
            }}
          >{t('runLog.result')}</div>
          <div
            className={cn(
              'mr-6 py-3 border-b-2 border-transparent text-[13px] font-semibold leading-[18px] text-gray-400 cursor-pointer',
              currentTab === 'DETAIL' && '!border-[rgb(21,94,239)] text-gray-700',
              !workflowRunningData && 'opacity-30 !cursor-not-allowed',
            )}
            onClick={() => {
              if (!workflowRunningData)
                return
              switchTab('DETAIL')
            }}
          >{t('runLog.detail')}</div>
          <div
            className={cn(
              'mr-6 py-3 border-b-2 border-transparent text-[13px] font-semibold leading-[18px] text-gray-400 cursor-pointer',
              currentTab === 'TRACING' && '!border-[rgb(21,94,239)] text-gray-700',
              !workflowRunningData && 'opacity-30 !cursor-not-allowed',
            )}
            onClick={() => {
              if (!workflowRunningData)
                return
              switchTab('TRACING')
            }}
          >{t('runLog.tracing')}</div>
        </div>
        <div className={cn(
          'grow bg-white h-0 overflow-y-auto rounded-b-2xl',
          (currentTab === 'RESULT' || currentTab === 'TRACING') && '!bg-gray-50',
        )}>
          {currentTab === 'INPUT' && showInputsPanel && (
            <InputsPanel onRun={() => switchTab('RESULT')} />
          )}
          {currentTab === 'RESULT' && (
            <>
              <ResultText
                isRunning={workflowRunningData?.result?.status === WorkflowRunningStatus.Running || !workflowRunningData?.result}
                outputs={workflowRunningData?.resultText}
                error={workflowRunningData?.result?.error}
                onClick={() => switchTab('DETAIL')}
              />
              <SimpleBtn
                isDisabled={workflowRunningData?.result.status !== WorkflowRunningStatus.Succeeded}
                className={cn('ml-4 mb-4 inline-flex space-x-1')}
                onClick={() => {
                  const content = workflowRunningData?.resultText
                  if (typeof content === 'string')
                    copy(content)
                  else
                    copy(JSON.stringify(content))
                  Toast.notify({ type: 'success', message: t('common.actionMsg.copySuccessfully') })
                }}>
                <Clipboard className='w-3.5 h-3.5' />
                <div>{t('common.operation.copy')}</div>
              </SimpleBtn>
            </>
          )}
          {currentTab === 'DETAIL' && (
            <ResultPanel
              inputs={workflowRunningData?.result?.inputs}
              outputs={workflowRunningData?.result?.outputs}
              status={workflowRunningData?.result?.status || ''}
              error={workflowRunningData?.result?.error}
              elapsed_time={workflowRunningData?.result?.elapsed_time}
              total_tokens={workflowRunningData?.result?.total_tokens}
              created_at={workflowRunningData?.result?.created_at}
              created_by={(workflowRunningData?.result?.created_by as any)?.name}
              steps={workflowRunningData?.result?.total_steps}
            />
          )}
          {currentTab === 'DETAIL' && !workflowRunningData?.result && (
            <div className='flex h-full items-center justify-center bg-white'>
              <Loading />
            </div>
          )}
          {currentTab === 'TRACING' && (
            <TracingPanel
              list={workflowRunningData?.tracing || []}
            />
          )}
          {currentTab === 'TRACING' && !workflowRunningData?.tracing?.length && (
            <div className='flex h-full items-center justify-center bg-gray-50'>
              <Loading />
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

export default memo(WorkflowPreview)
