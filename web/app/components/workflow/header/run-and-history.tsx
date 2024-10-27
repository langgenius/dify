import type { FC } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiLoader2Line,
  RiPlayLargeLine,
} from '@remixicon/react'
import { useStore } from '../store'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflowRun,
  useWorkflowStartRun,
} from '../hooks'
import { WorkflowRunningStatus } from '../types'
import ViewHistory from './view-history'
import Checklist from './checklist'
import cn from '@/utils/classnames'
import {
  StopCircle,
} from '@/app/components/base/icons/src/vender/line/mediaAndDevices'

const RunMode = memo(() => {
  const { t } = useTranslation()
  const { handleWorkflowStartRunInWorkflow } = useWorkflowStartRun()
  const { handleStopRun } = useWorkflowRun()
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const isRunning = workflowRunningData?.result.status === WorkflowRunningStatus.Running

  return (
    <>
      <div
        className={cn(
          'flex items-center px-2.5 h-7 rounded-md text-[13px] font-medium text-components-button-secondary-accent-text',
          'hover:bg-state-accent-hover cursor-pointer',
          isRunning && 'bg-state-accent-hover !cursor-not-allowed',
        )}
        onClick={() => {
          handleWorkflowStartRunInWorkflow()
        }}
      >
        {
          isRunning
            ? (
              <>
                <RiLoader2Line className='mr-1 w-4 h-4 animate-spin' />
                {t('workflow.common.running')}
              </>
            )
            : (
              <>
                <RiPlayLargeLine className='mr-1 w-4 h-4' />
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
            <StopCircle className='w-4 h-4 text-components-button-ghost-text' />
          </div>
        )
      }
    </>
  )
})
RunMode.displayName = 'RunMode'

const PreviewMode = memo(() => {
  const { t } = useTranslation()
  const { handleWorkflowStartRunInChatflow } = useWorkflowStartRun()

  return (
    <div
      className={cn(
        'flex items-center px-2.5 h-7 rounded-md text-[13px] font-medium text-components-button-secondary-accent-text',
        'hover:bg-state-accent-hover cursor-pointer',
      )}
      onClick={() => handleWorkflowStartRunInChatflow()}
    >
      <RiPlayLargeLine className='mr-1 w-4 h-4' />
      {t('workflow.common.debugAndPreview')}
    </div>
  )
})
PreviewMode.displayName = 'PreviewMode'

const RunAndHistory: FC = () => {
  const isChatMode = useIsChatMode()
  const { nodesReadOnly } = useNodesReadOnly()

  return (
    <div className='flex items-center px-0.5 h-8 rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs'>
      {
        !isChatMode && <RunMode />
      }
      {
        isChatMode && <PreviewMode />
      }
      <div className='mx-0.5 w-[1px] h-3.5 bg-divider-regular'></div>
      <ViewHistory />
      <Checklist disabled={nodesReadOnly} />
    </div>
  )
}

export default memo(RunAndHistory)
