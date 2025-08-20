import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkflowRun, useWorkflowStartRun } from '@/app/components/workflow/hooks'
import { useStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import { getKeyboardKeyNameBySystem } from '@/app/components/workflow/utils'
import cn from '@/utils/classnames'
import { RiLoader2Line, RiPlayLargeLine } from '@remixicon/react'
import { StopCircle } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'

type RunModeProps = {
  text?: string
}

const RunMode = ({
  text,
}: RunModeProps) => {
  const { t } = useTranslation()
  const { handleWorkflowStartRunInWorkflow } = useWorkflowStartRun()
  const { handleStopRun } = useWorkflowRun()
  const workflowRunningData = useStore(s => s.workflowRunningData)

  const isRunning = workflowRunningData?.result.status === WorkflowRunningStatus.Running

  const handleStop = useCallback(() => {
    handleStopRun(workflowRunningData?.task_id || '')
  }, [handleStopRun, workflowRunningData?.task_id])

  const { eventEmitter } = useEventEmitterContextContext()
  eventEmitter?.useSubscription((v: any) => {
    if (v.type === EVENT_WORKFLOW_STOP)
      handleStop()
  })

  return (
    <div className='flex items-center gap-x-px'>
      <button
        type='button'
        className={cn(
          'system-xs-medium flex h-7 items-center gap-x-1 px-1.5 text-text-accent hover:bg-state-accent-hover',
          isRunning && 'cursor-not-allowed bg-state-accent-hover',
          isRunning ? 'rounded-l-md' : 'rounded-md',
        )}
        onClick={() => {
          handleWorkflowStartRunInWorkflow()
        }}
        disabled={isRunning}
      >
        {
          isRunning
            ? (
              <>
                <RiLoader2Line className='mr-1 size-4 animate-spin' />
                {t('workflow.common.running')}
              </>
            )
            : (
              <>
                <RiPlayLargeLine className='mr-1 size-4' />
                {text ?? t('workflow.common.run')}
              </>
            )
        }
        {
          !isRunning && (
            <div className='system-kbd flex items-center gap-x-0.5 text-text-tertiary'>
              <div className='flex size-4 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray'>
                {getKeyboardKeyNameBySystem('alt')}
              </div>
              <div className='flex size-4 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray'>
                R
              </div>
            </div>
          )
        }
      </button>
      {
        isRunning && (
          <button
            type='button'
            className={cn(
              'flex size-7 items-center justify-center rounded-r-md bg-state-accent-active',
            )}
            onClick={handleStop}
          >
            <StopCircle className='size-4 text-text-accent' />
          </button>
        )
      }
    </div>
  )
}

export default React.memo(RunMode)
