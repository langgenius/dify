import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiLoader2Line,
  RiPlayLargeLine,
} from '@remixicon/react'
import { useStore } from '../store'
import {
  useNodesReadOnly,
  useWorkflowRun,
  useWorkflowStartRun,
} from '../hooks'
import { WorkflowRunningStatus } from '../types'
import type { ViewHistoryProps } from './view-history'
import ViewHistory from './view-history'
import Checklist from './checklist'
import cn from '@/utils/classnames'
import {
  StopCircle,
} from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'

type RunModeProps = {
  text?: string
  isRunning?: boolean
  onStopRun?: () => void
}
const RunMode = memo(({
  text,
  isRunning: running,
  onStopRun,
}: RunModeProps) => {
  const { t } = useTranslation()
  const { handleWorkflowStartRunInWorkflow } = useWorkflowStartRun()
  const { handleStopRun } = useWorkflowRun()
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const isRunning = workflowRunningData?.result.status === WorkflowRunningStatus.Running
  const mergedRunning = isRunning || running

  const handleStop = () => {
    handleStopRun(workflowRunningData?.task_id || '')
  }

  const { eventEmitter } = useEventEmitterContextContext()
  eventEmitter?.useSubscription((v: any) => {
    if (v.type === EVENT_WORKFLOW_STOP)
      handleStop()
  })

  return (
    <>
      <div
        className={cn(
          'flex h-7 items-center px-2.5 text-[13px] font-medium text-components-button-secondary-accent-text',
          'cursor-pointer hover:bg-state-accent-hover',
          mergedRunning && 'cursor-not-allowed bg-state-accent-hover',
          mergedRunning ? 'rounded-l-md' : 'rounded-md',
        )}
        onClick={() => {
          handleWorkflowStartRunInWorkflow()
        }}
      >
        {
          mergedRunning
            ? (
              <>
                <RiLoader2Line className='mr-1 h-4 w-4 animate-spin' />
                {t('workflow.common.running')}
              </>
            )
            : (
              <>
                <RiPlayLargeLine className='mr-1 h-4 w-4' />
                {text ?? t('workflow.common.run')}
              </>
            )
        }
      </div>
      {
        mergedRunning && (
          <div
            className={cn(
              'ml-[1px] flex h-7 w-7 cursor-pointer items-center justify-center rounded-r-md bg-state-accent-active',
            )}
            onClick={() => onStopRun ? onStopRun() : handleStopRun(workflowRunningData?.task_id || '')}
          >
            <StopCircle className='h-4 w-4 text-text-accent' />
          </div>
        )
      }
    </>
  )
})

const PreviewMode = memo(() => {
  const { t } = useTranslation()
  const { handleWorkflowStartRunInChatflow } = useWorkflowStartRun()

  return (
    <div
      className={cn(
        'flex h-7 items-center rounded-md px-2.5 text-[13px] font-medium text-components-button-secondary-accent-text',
        'cursor-pointer hover:bg-state-accent-hover',
      )}
      onClick={() => handleWorkflowStartRunInChatflow()}
    >
      <RiPlayLargeLine className='mr-1 h-4 w-4' />
      {t('workflow.common.debugAndPreview')}
    </div>
  )
})

export type RunAndHistoryProps = {
  showRunButton?: boolean
  runButtonText?: string
  isRunning?: boolean
  onStopRun?: () => void
  showPreviewButton?: boolean
  viewHistoryProps?: ViewHistoryProps
}
const RunAndHistory = ({
  showRunButton,
  runButtonText,
  isRunning,
  onStopRun,
  showPreviewButton,
  viewHistoryProps,
}: RunAndHistoryProps) => {
  const { nodesReadOnly } = useNodesReadOnly()

  return (
    <div className='flex h-8 items-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-0.5 shadow-xs'>
      {
        showRunButton && <RunMode text={runButtonText} isRunning={isRunning} onStopRun={onStopRun} />
      }
      {
        showPreviewButton && <PreviewMode />
      }
      <div className='mx-0.5 h-3.5 w-[1px] bg-divider-regular'></div>
      <ViewHistory {...viewHistoryProps} />
      <Checklist disabled={nodesReadOnly} />
    </div>
  )
}

export default memo(RunAndHistory)
