'use client'

import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkflowRun, useWorkflowStartRun } from '@/app/components/workflow/hooks'
import ShortcutsName from '@/app/components/workflow/shortcuts-name'
import { useStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'

type RunModeProps = {
  text?: string
}

const RunMode = ({
  text,
}: RunModeProps) => {
  const { t } = useTranslation('snippet')
  const { handleWorkflowStartRunInWorkflow } = useWorkflowStartRun()
  const { handleStopRun } = useWorkflowRun()
  const workflowRunningData = useStore(s => s.workflowRunningData)

  const isRunning = workflowRunningData?.result.status === WorkflowRunningStatus.Running

  const handleStop = useCallback(() => {
    handleStopRun(workflowRunningData?.task_id || '')
  }, [handleStopRun, workflowRunningData?.task_id])

  const { eventEmitter } = useEventEmitterContextContext()
  eventEmitter?.useSubscription((v) => {
    if (typeof v !== 'string' && v.type === EVENT_WORKFLOW_STOP)
      handleStop()
  })

  return (
    <div className="flex items-center gap-x-px">
      <button
        type="button"
        className={cn(
          'system-xs-medium flex h-7 items-center gap-x-1 rounded-md px-1.5 text-components-button-secondary-accent-text hover:bg-state-accent-hover',
          isRunning && 'cursor-not-allowed rounded-l-md bg-state-accent-hover',
        )}
        onClick={handleWorkflowStartRunInWorkflow}
        disabled={isRunning}
      >
        {isRunning
          ? (
              <>
                <span aria-hidden className="mr-1 i-ri-loader-2-line size-4 animate-spin" />
                {t('common.running', { ns: 'workflow' })}
              </>
            )
          : (
              <>
                <span aria-hidden className="mr-1 i-ri-play-large-line size-4" />
                {text ?? t('common.run', { ns: 'workflow' })}
                <ShortcutsName keys={['alt', 'R']} textColor="secondary" />
              </>
            )}
      </button>

      {isRunning && (
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-r-md bg-state-accent-active"
          onClick={handleStop}
        >
          <span aria-hidden className="i-ri-stop-circle-line size-4 text-text-accent" />
        </button>
      )}
    </div>
  )
}

export default React.memo(RunMode)
