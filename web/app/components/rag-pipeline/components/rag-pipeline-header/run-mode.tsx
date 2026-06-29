import { cn } from '@langgenius/dify-ui/cn'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { RiCloseLine, RiDatabase2Line, RiLoader2Line, RiPlayLargeLine } from '@remixicon/react'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from '#i18n'
import { StopCircle } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { useWorkflowRun, useWorkflowStartRun } from '@/app/components/workflow/hooks'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'

type RunModeProps = {
  text?: string
}

const RunMode = ({
  text,
}: RunModeProps) => {
  const { t } = useTranslation()
  const { handleWorkflowStartRunInWorkflow } = useWorkflowStartRun()
  const { handleStopRun } = useWorkflowRun()
  const workflowStore = useWorkflowStore()
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const isPreparingDataSource = useStore(s => s.isPreparingDataSource)
  const canRun = useHooksStore(s => s.accessControl.canRun)

  const isRunning = workflowRunningData?.result.status === WorkflowRunningStatus.Running
  const isDisabled = isPreparingDataSource || isRunning || !canRun

  const handleStop = useCallback(() => {
    handleStopRun(workflowRunningData?.task_id || '')
  }, [handleStopRun, workflowRunningData?.task_id])

  const handleCancelPreparingDataSource = useCallback(() => {
    const { setIsPreparingDataSource, setShowDebugAndPreviewPanel } = workflowStore.getState()
    setIsPreparingDataSource?.(false)
    setShowDebugAndPreviewPanel(false)
  }, [workflowStore])

  const { eventEmitter } = useEventEmitterContextContext()
  eventEmitter?.useSubscription((v: any) => {
    if (v.type === EVENT_WORKFLOW_STOP)
      handleStop()
  })

  if (!canRun)
    return null

  return (
    <div className="flex items-center gap-x-px">
      <button
        type="button"
        className={cn(
          'flex h-7 items-center gap-x-1 px-1.5 system-xs-medium text-text-accent hover:bg-state-accent-hover',
          isDisabled && 'cursor-not-allowed bg-state-accent-hover',
          isDisabled ? 'rounded-l-md' : 'rounded-md',
        )}
        onClick={() => {
          if (canRun)
            handleWorkflowStartRunInWorkflow()
        }}
        disabled={isDisabled}
      >
        {!isDisabled && (
          <>
            <RiPlayLargeLine className="mr-1 size-4" />
            {workflowRunningData ? t('common.reRun', { ns: 'pipeline' }) : (text ?? t('common.testRun', { ns: 'pipeline' }))}
          </>
        )}
        {isRunning && (
          <>
            <RiLoader2Line className="mr-1 size-4 animate-spin" />
            {t('common.processing', { ns: 'pipeline' })}
          </>
        )}
        {isPreparingDataSource && (
          <>
            <RiDatabase2Line className="mr-1 size-4" />
            {t('common.preparingDataSource', { ns: 'pipeline' })}
          </>
        )}
        {
          !isDisabled && (
            <KbdGroup>
              {['Alt', 'R'].map(key => (
                <Kbd key={key}>{formatForDisplay(key)}</Kbd>
              ))}
            </KbdGroup>
          )
        }
      </button>
      {isRunning && (
        <button
          type="button"
          className={cn(
            'flex size-7 items-center justify-center rounded-r-md bg-state-accent-active',
          )}
          onClick={handleStop}
        >
          <StopCircle className="size-4 text-text-accent" />
        </button>
      )}
      {isPreparingDataSource && (
        <button
          type="button"
          className={cn(
            'flex size-7 items-center justify-center rounded-r-md bg-state-accent-active',
          )}
          onClick={handleCancelPreparingDataSource}
        >
          <RiCloseLine className="size-4 text-text-accent" />
        </button>
      )}
    </div>
  )
}

export default React.memo(RunMode)
