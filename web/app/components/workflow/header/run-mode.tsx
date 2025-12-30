import type { TestRunMenuRef, TriggerOption } from './test-run-menu'
import { RiLoader2Line, RiPlayLargeLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import { StopCircle } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { useToastContext } from '@/app/components/base/toast'
import { useWorkflowRun, useWorkflowRunValidation, useWorkflowStartRun } from '@/app/components/workflow/hooks'
import { useStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { getKeyboardKeyNameBySystem } from '@/app/components/workflow/utils'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { cn } from '@/utils/classnames'
import { useDynamicTestRunOptions } from '../hooks/use-dynamic-test-run-options'
import TestRunMenu, { TriggerType } from './test-run-menu'

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
    handleWorkflowRunAllTriggersInWorkflow,
  } = useWorkflowStartRun()
  const { handleStopRun } = useWorkflowRun()
  const { validateBeforeRun, warningNodes } = useWorkflowRunValidation()
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const isListening = useStore(s => s.isListening)

  const status = workflowRunningData?.result.status
  const isRunning = status === WorkflowRunningStatus.Running || isListening

  const dynamicOptions = useDynamicTestRunOptions()
  const testRunMenuRef = useRef<TestRunMenuRef>(null)
  const { notify } = useToastContext()

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
    let isValid: boolean = true
    warningNodes.forEach((node) => {
      if (node.id === option.nodeId)
        isValid = false
    })
    if (!isValid) {
      notify({ type: 'error', message: t('panel.checklistTip', { ns: 'workflow' }) })
      return
    }

    if (option.type === TriggerType.UserInput) {
      handleWorkflowStartRunInWorkflow()
      trackEvent('app_start_action_time', { action_type: 'user_input' })
    }
    else if (option.type === TriggerType.Schedule) {
      handleWorkflowTriggerScheduleRunInWorkflow(option.nodeId)
      trackEvent('app_start_action_time', { action_type: 'schedule' })
    }
    else if (option.type === TriggerType.Webhook) {
      if (option.nodeId)
        handleWorkflowTriggerWebhookRunInWorkflow({ nodeId: option.nodeId })
      trackEvent('app_start_action_time', { action_type: 'webhook' })
    }
    else if (option.type === TriggerType.Plugin) {
      if (option.nodeId)
        handleWorkflowTriggerPluginRunInWorkflow(option.nodeId)
      trackEvent('app_start_action_time', { action_type: 'plugin' })
    }
    else if (option.type === TriggerType.All) {
      const targetNodeIds = option.relatedNodeIds?.filter(Boolean)
      if (targetNodeIds && targetNodeIds.length > 0)
        handleWorkflowRunAllTriggersInWorkflow(targetNodeIds)
      trackEvent('app_start_action_time', { action_type: 'all' })
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
    handleWorkflowTriggerPluginRunInWorkflow,
    handleWorkflowRunAllTriggersInWorkflow,
  ])

  const { eventEmitter } = useEventEmitterContextContext()
  eventEmitter?.useSubscription((v: any) => {
    if (v.type === EVENT_WORKFLOW_STOP)
      handleStop()
  })

  return (
    <div className="flex items-center gap-x-px">
      {
        isRunning
          ? (
              <button
                type="button"
                className={cn(
                  'system-xs-medium flex h-7 cursor-not-allowed items-center gap-x-1 rounded-l-md bg-state-accent-hover px-1.5 text-text-accent',
                )}
                disabled={true}
              >
                <RiLoader2Line className="mr-1 size-4 animate-spin" />
                {isListening ? t('common.listening', { ns: 'workflow' }) : t('common.running', { ns: 'workflow' })}
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
                  <RiPlayLargeLine className="mr-1 size-4" />
                  {text ?? t('common.run', { ns: 'workflow' })}
                  <div className="system-kbd flex items-center gap-x-0.5 text-text-tertiary">
                    <div className="flex size-4 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray">
                      {getKeyboardKeyNameBySystem('alt')}
                    </div>
                    <div className="flex size-4 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray">
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
            type="button"
            className={cn(
              'flex size-7 items-center justify-center rounded-r-md bg-state-accent-active',
            )}
            onClick={handleStop}
          >
            <StopCircle className="size-4 text-text-accent" />
          </button>
        )
      }
    </div>
  )
}

export default React.memo(RunMode)
