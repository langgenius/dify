import type { FC } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useStore,
  useWorkflowStore,
} from '../store'
import {
  useIsChatMode,
  useWorkflowRun,
} from '../hooks'
import { WorkflowRunningStatus } from '../types'
import {
  Play,
  StopCircle,
} from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { ClockPlay } from '@/app/components/base/icons/src/vender/line/time'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import { Loading02 } from '@/app/components/base/icons/src/vender/line/general'
import { useStore as useAppStore } from '@/app/components/app/store'

const RunMode = memo(() => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const { handleStopRun } = useWorkflowRun()
  const runningStatus = useStore(s => s.runningStatus)
  const showInputsPanel = useStore(s => s.showInputsPanel)
  const isRunning = runningStatus === WorkflowRunningStatus.Running

  const handleClick = () => {
    workflowStore.setState({ showInputsPanel: true })
  }

  return (
    <>
      <div
        className={`
          flex items-center px-1.5 h-7 rounded-md text-[13px] font-medium text-primary-600
          hover:bg-primary-50 cursor-pointer
          ${showInputsPanel && 'bg-primary-50'}
          ${isRunning && 'bg-primary-50 !cursor-not-allowed'}
        `}
        onClick={() => !isRunning && handleClick()}
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
            onClick={handleStopRun}
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
  const runningStatus = useStore(s => s.runningStatus)

  const handleClick = () => {
    handleRunSetting()
  }

  return (
    <div
      className={`
        flex items-center px-1.5 h-7 rounded-md text-[13px] font-medium text-primary-600
        hover:bg-primary-50 cursor-pointer
        ${runningStatus && 'bg-primary-50 opacity-50 !cursor-not-allowed'}
      `}
      onClick={() => !runningStatus && handleClick()}
    >
      {
        runningStatus
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
