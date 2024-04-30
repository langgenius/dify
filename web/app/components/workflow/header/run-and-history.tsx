import type { FC } from 'react'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import cn from 'classnames'
import {
  useStore,
  useWorkflowStore,
} from '../store'
import {
  useIsChatMode,
  useNodesSyncDraft,
  useWorkflowInteractions,
  useWorkflowRun,
} from '../hooks'
import {
  BlockEnum,
  WorkflowRunningStatus,
} from '../types'
import ViewHistory from './view-history'
import {
  Play,
  StopCircle,
} from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { Loading02 } from '@/app/components/base/icons/src/vender/line/general'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { MessagePlay } from '@/app/components/base/icons/src/vender/line/communication'

const RunMode = memo(() => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const featuresStore = useFeaturesStore()
  const {
    handleStopRun,
    handleRun,
  } = useWorkflowRun()
  const {
    doSyncWorkflowDraft,
  } = useNodesSyncDraft()
  const { handleCancelDebugAndPreviewPanel } = useWorkflowInteractions()
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const isRunning = workflowRunningData?.result.status === WorkflowRunningStatus.Running

  const handleClick = useCallback(async () => {
    const {
      workflowRunningData,
    } = workflowStore.getState()

    if (workflowRunningData?.result.status === WorkflowRunningStatus.Running)
      return

    const { getNodes } = store.getState()
    const nodes = getNodes()
    const startNode = nodes.find(node => node.data.type === BlockEnum.Start)
    const startVariables = startNode?.data.variables || []
    const fileSettings = featuresStore!.getState().features.file
    const {
      showDebugAndPreviewPanel,
      setShowDebugAndPreviewPanel,
      setShowInputsPanel,
    } = workflowStore.getState()

    if (showDebugAndPreviewPanel) {
      handleCancelDebugAndPreviewPanel()
      return
    }

    if (!startVariables.length && !fileSettings?.image?.enabled) {
      await doSyncWorkflowDraft()
      handleRun({ inputs: {}, files: [] })
      setShowDebugAndPreviewPanel(true)
      setShowInputsPanel(false)
    }
    else {
      setShowDebugAndPreviewPanel(true)
      setShowInputsPanel(true)
    }
  }, [
    workflowStore,
    handleRun,
    doSyncWorkflowDraft,
    store,
    featuresStore,
    handleCancelDebugAndPreviewPanel,
  ])

  return (
    <>
      <div
        className={cn(
          'flex items-center px-1.5 h-7 rounded-md text-[13px] font-medium text-primary-600',
          'hover:bg-primary-50 cursor-pointer',
          isRunning && 'bg-primary-50 !cursor-not-allowed',
        )}
        onClick={handleClick}
      >
        {
          isRunning
            ? (
              <>
                <Loading02 className='mr-1 w-4 h-4 animate-spin' />
                {t('workflow.common.running')}
              </>
            )
            : (
              <>
                <Play className='mr-1 w-4 h-4' />
                {t('workflow.common.run')}
              </>
            )
        }
      </div>
      {
        isRunning && (
          <div
            className='flex items-center justify-center ml-0.5 w-7 h-7 cursor-pointer hover:bg-black/5 rounded-md'
            onClick={() => handleStopRun(workflowRunningData?.task_id || '')}
          >
            <StopCircle className='w-4 h-4 text-gray-500' />
          </div>
        )
      }
    </>
  )
})
RunMode.displayName = 'RunMode'

const PreviewMode = memo(() => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const { handleCancelDebugAndPreviewPanel } = useWorkflowInteractions()

  const handleClick = () => {
    const {
      showDebugAndPreviewPanel,
      setShowDebugAndPreviewPanel,
      setHistoryWorkflowData,
    } = workflowStore.getState()

    if (showDebugAndPreviewPanel)
      handleCancelDebugAndPreviewPanel()
    else
      setShowDebugAndPreviewPanel(true)

    setHistoryWorkflowData(undefined)
  }

  return (
    <div
      className={cn(
        'flex items-center px-1.5 h-7 rounded-md text-[13px] font-medium text-primary-600',
        'hover:bg-primary-50 cursor-pointer',
      )}
      onClick={() => handleClick()}
    >
      <MessagePlay className='mr-1 w-4 h-4' />
      {t('workflow.common.debugAndPreview')}
    </div>
  )
})
PreviewMode.displayName = 'PreviewMode'

const RunAndHistory: FC = () => {
  const isChatMode = useIsChatMode()

  return (
    <div className='flex items-center px-0.5 h-8 rounded-lg border-[0.5px] border-gray-200 bg-white shadow-xs'>
      {
        !isChatMode && <RunMode />
      }
      {
        isChatMode && <PreviewMode />
      }
      <div className='mx-0.5 w-[0.5px] h-8 bg-gray-200'></div>
      <ViewHistory />
    </div>
  )
}

export default memo(RunAndHistory)
