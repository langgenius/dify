import type { FC } from 'react'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import {
  useStore,
  useWorkflowStore,
} from '../store'
import {
  useIsChatMode,
  useNodesReadOnly,
  useNodesSyncDraft,
  useWorkflowRun,
} from '../hooks'
import {
  BlockEnum,
  WorkflowRunningStatus,
} from '../types'
import {
  Play,
  StopCircle,
} from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { ClockPlay } from '@/app/components/base/icons/src/vender/line/time'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import { Loading02 } from '@/app/components/base/icons/src/vender/line/general'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useFeaturesStore } from '@/app/components/base/features/hooks'

const RunMode = memo(() => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const featuresStore = useFeaturesStore()
  const {
    handleStopRun,
    handleRunSetting,
    handleRun,
  } = useWorkflowRun()
  const {
    doSyncWorkflowDraft,
    handleSyncWorkflowDraft,
  } = useNodesSyncDraft()
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const showInputsPanel = useStore(s => s.showInputsPanel)
  const isRunning = workflowRunningData?.result.status === WorkflowRunningStatus.Running

  const handleClick = useCallback(async () => {
    const {
      setShowInputsPanel,
      workflowRunningData,
    } = workflowStore.getState()

    if (workflowRunningData?.result.status === WorkflowRunningStatus.Running)
      return

    const { getNodes } = store.getState()
    const nodes = getNodes()
    const startNode = nodes.find(node => node.data.type === BlockEnum.Start)
    const startVariables = startNode?.data.variables || []
    const fileSettings = featuresStore!.getState().features.file

    if (!startVariables.length && !fileSettings.image.enabled) {
      await doSyncWorkflowDraft()
      handleRunSetting()
      handleRun({ inputs: {}, files: [] })
    }
    else {
      setShowInputsPanel(true)
      handleSyncWorkflowDraft(true)
    }
  }, [
    workflowStore,
    handleSyncWorkflowDraft,
    handleRunSetting,
    handleRun,
    doSyncWorkflowDraft,
    store,
    featuresStore,
  ])

  return (
    <>
      <div
        className={`
          flex items-center px-1.5 h-7 rounded-md text-[13px] font-medium text-primary-600
          hover:bg-primary-50 cursor-pointer
          ${showInputsPanel && 'bg-primary-50'}
          ${isRunning && 'bg-primary-50 !cursor-not-allowed'}
        `}
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
  const { handleRunSetting } = useWorkflowRun()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { nodesReadOnly } = useNodesReadOnly()

  const handleClick = () => {
    handleSyncWorkflowDraft(true)
    handleRunSetting()
  }

  return (
    <div
      className={`
        flex items-center px-1.5 h-7 rounded-md text-[13px] font-medium text-primary-600
        hover:bg-primary-50 cursor-pointer
        ${nodesReadOnly && 'bg-primary-50 opacity-50 !cursor-not-allowed'}
      `}
      onClick={() => !nodesReadOnly && handleClick()}
    >
      {
        nodesReadOnly
          ? (
            <>
              {t('workflow.common.inPreview')}
            </>
          )
          : (
            <>
              <Play className='mr-1 w-4 h-4' />
              {t('workflow.common.preview')}
            </>
          )
      }
    </div>
  )
})
PreviewMode.displayName = 'PreviewMode'

const RunAndHistory: FC = () => {
  const { t } = useTranslation()
  const { setCurrentLogItem, setShowMessageLogModal } = useAppStore()
  const workflowStore = useWorkflowStore()
  const isChatMode = useIsChatMode()
  const showRunHistory = useStore(state => state.showRunHistory)

  return (
    <div className='flex items-center px-0.5 h-8 rounded-lg border-[0.5px] border-gray-200 bg-white shadow-xs'>
      {
        !isChatMode && <RunMode />
      }
      {
        isChatMode && <PreviewMode />
      }
      <div className='mx-0.5 w-[0.5px] h-8 bg-gray-200'></div>
      <TooltipPlus
        popupContent={t('workflow.common.viewRunHistory')}
      >
        <div
          className={`
            flex items-center justify-center w-7 h-7 rounded-md hover:bg-black/5 cursor-pointer
            ${showRunHistory && 'bg-primary-50'}
          `}
          onClick={() => {
            workflowStore.setState({ showRunHistory: !showRunHistory })
            setCurrentLogItem()
            setShowMessageLogModal(false)
          }}
        >
          <ClockPlay className={`w-4 h-4 ${showRunHistory ? 'text-primary-600' : 'text-gray-500'}`} />
        </div>
      </TooltipPlus>
    </div>
  )
}

export default memo(RunAndHistory)
