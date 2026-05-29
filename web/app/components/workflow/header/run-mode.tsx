import type { TestRunMenuRef, TriggerOption } from './test-run-menu'
import type { EventEmitterValue } from '@/context/event-emitter'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import * as React from 'react'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import { useWorkflowRun, useWorkflowRunValidation, useWorkflowStartRun } from '@/app/components/workflow/hooks'
import { ShortcutKbd } from '@/app/components/workflow/shortcuts/shortcut-kbd'
import { useWorkflowShortcut } from '@/app/components/workflow/shortcuts/use-workflow-hotkeys'
import { useStore } from '@/app/components/workflow/store/workflow'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
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
  const { warningNodes } = useWorkflowRunValidation()
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const isListening = useStore(s => s.isListening)

  const status = workflowRunningData?.result.status
  const isRunning = status === WorkflowRunningStatus.Running || isListening

  const dynamicOptions = useDynamicTestRunOptions()
  const testRunMenuRef = useRef<TestRunMenuRef>(null)

  const handleToggleTestRunMenu = useCallback(() => {
    testRunMenuRef.current?.toggle()
  }, [])

  useWorkflowShortcut('workflow.open-test-run-menu', handleToggleTestRunMenu)
  useWorkflowShortcut('workflow.run', handleToggleTestRunMenu, {
    enabled: !isRunning,
  })

  const handleTriggerSelect = useCallback((option: TriggerOption) => {
    // Validate checklist before running any workflow
    let isValid: boolean = true
    warningNodes.forEach((node) => {
      if (node.id === option.nodeId)
        isValid = false
    })
    if (!isValid) {
      toast.error(t('panel.checklistTip', { ns: 'workflow' }))
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
  }, [warningNodes, t, handleWorkflowStartRunInWorkflow, handleWorkflowTriggerScheduleRunInWorkflow, handleWorkflowTriggerWebhookRunInWorkflow, handleWorkflowTriggerPluginRunInWorkflow, handleWorkflowRunAllTriggersInWorkflow])

  const handleStop = useCallback(() => {
    handleStopRun(workflowRunningData?.task_id || '')
  }, [handleStopRun, workflowRunningData?.task_id])

  useWorkflowShortcut('workflow.stop-run', handleStop, {
    enabled: isRunning,
  })

  const { eventEmitter } = useEventEmitterContextContext()
  eventEmitter?.useSubscription((event: EventEmitterValue) => {
    if (typeof event !== 'string' && event.type === EVENT_WORKFLOW_STOP)
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
                  'flex h-7 cursor-not-allowed items-center gap-x-1 rounded-l-md bg-state-accent-hover px-1.5 system-xs-medium text-text-accent',
                )}
                disabled={true}
              >
                <span className="mr-1 i-ri-loader-2-line size-4 animate-spin" />
                {isListening ? t('common.listening', { ns: 'workflow' }) : t('common.running', { ns: 'workflow' })}
              </button>
            )
          : (
              <TestRunMenu
                ref={testRunMenuRef}
                options={dynamicOptions}
                onSelect={handleTriggerSelect}
              >
                <button
                  type="button"
                  className={cn(
                    'flex h-7 cursor-pointer items-center gap-x-1 rounded-md px-1.5 system-xs-medium text-text-accent hover:bg-state-accent-hover',
                  )}
                  style={{ userSelect: 'none' }}
                >
                  <span aria-hidden className="mr-1 i-ri-play-large-line size-4" />
                  {text ?? t('common.run', { ns: 'workflow' })}
                  <ShortcutKbd shortcut="workflow.run" textColor="secondary" />
                </button>
              </TestRunMenu>
            )
      }
      {
        isRunning && (
          <button
            type="button"
            aria-label={t('debug.variableInspect.trigger.stop', { ns: 'workflow' })}
            className={cn(
              'flex size-7 items-center justify-center rounded-r-md bg-state-accent-active',
            )}
            onClick={handleStop}
          >
            <span aria-hidden className="i-custom-vender-line-mediaAndDevices-stop-circle size-4 text-text-accent" />
          </button>
        )
      }
    </div>
  )
}

export default React.memo(RunMode)
