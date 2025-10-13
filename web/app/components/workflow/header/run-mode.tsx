import React, { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkflowRun, useWorkflowRunValidation, useWorkflowStartRun } from '@/app/components/workflow/hooks'
import { useStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import { getKeyboardKeyNameBySystem } from '@/app/components/workflow/utils'
import cn from '@/utils/classnames'
import { RiLoader2Line, RiPlayLargeLine } from '@remixicon/react'
import { StopCircle } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { useDynamicTestRunOptions } from '../hooks/use-dynamic-test-run-options'
import TestRunMenu, { type TestRunMenuRef, type TriggerOption } from './test-run-menu'

type RunModeProps = {
  text?: string
}

const RunMode = ({
  text,
}: RunModeProps) => {
  const { t } = useTranslation()
  const {
    handleWorkflowStartRunInWorkflow,
    handleWorkflowTriggerScheduleRunInWorkflow,
    handleWorkflowTriggerWebhookRunInWorkflow,
    handleWorkflowTriggerPluginRunInWorkflow,
  } = useWorkflowStartRun()
  const { handleStopRun } = useWorkflowRun()
  const { validateBeforeRun } = useWorkflowRunValidation()
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const isListening = useStore(s => s.isListening)

  const status = workflowRunningData?.result.status
  const isRunning = status === WorkflowRunningStatus.Running || isListening

  const dynamicOptions = useDynamicTestRunOptions()
  const testRunMenuRef = useRef<TestRunMenuRef>(null)

  useEffect(() => {
    // @ts-expect-error - Dynamic property for backward compatibility with keyboard shortcuts
    window._toggleTestRunDropdown = () => {
      testRunMenuRef.current?.toggle()
    }
    return () => {
      // @ts-expect-error - Dynamic property cleanup
      delete window._toggleTestRunDropdown
    }
  }, [])

  const handleStop = useCallback(() => {
    handleStopRun(workflowRunningData?.task_id || '')
  }, [handleStopRun, workflowRunningData?.task_id])

  const handleTriggerSelect = useCallback((option: TriggerOption) => {
    // Validate checklist before running any workflow
    if (!validateBeforeRun())
      return

    if (option.type === 'user_input') {
      handleWorkflowStartRunInWorkflow()
    }
    else if (option.type === 'schedule') {
      handleWorkflowTriggerScheduleRunInWorkflow(option.nodeId)
    }
    else if (option.type === 'webhook') {
      if (option.nodeId)
        handleWorkflowTriggerWebhookRunInWorkflow({ nodeId: option.nodeId })
    }
    else if (option.type === 'plugin') {
      if (option.nodeId)
        handleWorkflowTriggerPluginRunInWorkflow(option.nodeId)
    }
    else {
      // Placeholder for trigger-specific execution logic for schedule, webhook, plugin types
      console.log('TODO: Handle trigger execution for type:', option.type, 'nodeId:', option.nodeId)
    }
  }, [
    validateBeforeRun,
    handleWorkflowStartRunInWorkflow,
    handleWorkflowTriggerScheduleRunInWorkflow,
    handleWorkflowTriggerWebhookRunInWorkflow,
  ])

  const { eventEmitter } = useEventEmitterContextContext()
  eventEmitter?.useSubscription((v: any) => {
    if (v.type === EVENT_WORKFLOW_STOP)
      handleStop()
  })

  return (
    <div className='flex items-center gap-x-px'>
      {
        isRunning
          ? (
            <button
              type='button'
              className={cn(
                'system-xs-medium flex h-7 cursor-not-allowed items-center gap-x-1 rounded-l-md bg-state-accent-hover px-1.5 text-text-accent',
              )}
              disabled={true}
            >
              <RiLoader2Line className='mr-1 size-4 animate-spin' />
              {isListening ? t('workflow.common.listening') : t('workflow.common.running')}
            </button>
          )
          : (
            <TestRunMenu
              ref={testRunMenuRef}
              options={dynamicOptions}
              onSelect={handleTriggerSelect}
            >
              <div
                className={cn(
                  'system-xs-medium flex h-7 cursor-pointer items-center gap-x-1 rounded-md px-1.5 text-text-accent hover:bg-state-accent-hover',
                )}
                style={{ userSelect: 'none' }}
              >
                <RiPlayLargeLine className='mr-1 size-4' />
                {text ?? t('workflow.common.run')}
                <div className='system-kbd flex items-center gap-x-0.5 text-text-tertiary'>
                  <div className='flex size-4 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray'>
                    {getKeyboardKeyNameBySystem('alt')}
                  </div>
                  <div className='flex size-4 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray'>
                    R
                  </div>
                </div>
              </div>
            </TestRunMenu>
          )
      }
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
