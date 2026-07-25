import type { TestRunMenuRef, TriggerOption } from './test-run-menu'
import type { EventEmitterValue } from '@/context/event-emitter'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useHotkey } from '@tanstack/react-hotkeys'
import * as React from 'react'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import {
  useWorkflowRun,
  useWorkflowRunValidation,
  useWorkflowStartRun,
} from '@/app/components/workflow/hooks'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { ShortcutKbd } from '@/app/components/workflow/shortcuts/shortcut-kbd'
import { useStore } from '@/app/components/workflow/store/workflow'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useDynamicTestRunOptions } from '../hooks/use-dynamic-test-run-options'
import { TEST_RUN_MENU_HOTKEY } from '../hotkeys'
import TestRunMenu, { TriggerType } from './test-run-menu'

type RunModeProps = {
  text?: string
  disabled?: boolean
}

const isWorkflowStopEvent = (value: EventEmitterValue) =>
  typeof value !== 'string' && value.type === EVENT_WORKFLOW_STOP

const RunMode = ({ text, disabled = false }: RunModeProps) => {
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
  const workflowRunningData = useStore((s) => s.workflowRunningData)
  const isListening = useStore((s) => s.isListening)
  const canRun = useHooksStore((s) => s.accessControl.canRun)
  const isRunDisabled = disabled || !canRun

  const status = workflowRunningData?.result.status
  const isRunning = status === WorkflowRunningStatus.Running || isListening

  const dynamicOptions = useDynamicTestRunOptions()
  const testRunMenuRef = useRef<TestRunMenuRef>(null)

  const handleToggleTestRunMenu = useCallback(() => {
    if (isRunDisabled) return

    testRunMenuRef.current?.toggle()
  }, [isRunDisabled])

  useHotkey(TEST_RUN_MENU_HOTKEY, handleToggleTestRunMenu, {
    ignoreInputs: true,
  })

  const handleStop = useCallback(() => {
    handleStopRun(workflowRunningData?.task_id || '')
  }, [handleStopRun, workflowRunningData?.task_id])

  const handleTriggerSelect = useCallback(
    (option: TriggerOption) => {
      if (isRunDisabled) return

      // Validate checklist before running any workflow
      let isValid: boolean = true
      warningNodes.forEach((node) => {
        if (node.id === option.nodeId) isValid = false
      })
      if (!isValid) {
        toast.error(t(($) => $['panel.checklistTip'], { ns: 'workflow' }))
        return
      }

      if (option.type === TriggerType.UserInput) {
        handleWorkflowStartRunInWorkflow()
        trackEvent('app_start_action_time', { action_type: 'user_input' })
      } else if (option.type === TriggerType.Schedule) {
        handleWorkflowTriggerScheduleRunInWorkflow(option.nodeId)
        trackEvent('app_start_action_time', { action_type: 'schedule' })
      } else if (option.type === TriggerType.Webhook) {
        if (option.nodeId) handleWorkflowTriggerWebhookRunInWorkflow({ nodeId: option.nodeId })
        trackEvent('app_start_action_time', { action_type: 'webhook' })
      } else if (option.type === TriggerType.Plugin) {
        if (option.nodeId) handleWorkflowTriggerPluginRunInWorkflow(option.nodeId)
        trackEvent('app_start_action_time', { action_type: 'plugin' })
      } else if (option.type === TriggerType.All) {
        const targetNodeIds = option.relatedNodeIds?.filter(Boolean)
        if (targetNodeIds && targetNodeIds.length > 0)
          handleWorkflowRunAllTriggersInWorkflow(targetNodeIds)
        trackEvent('app_start_action_time', { action_type: 'all' })
      }
    },
    [
      isRunDisabled,
      warningNodes,
      t,
      handleWorkflowStartRunInWorkflow,
      handleWorkflowTriggerScheduleRunInWorkflow,
      handleWorkflowTriggerWebhookRunInWorkflow,
      handleWorkflowTriggerPluginRunInWorkflow,
      handleWorkflowRunAllTriggersInWorkflow,
    ],
  )

  const { eventEmitter } = useEventEmitterContextContext()
  eventEmitter?.useSubscription((v: EventEmitterValue) => {
    if (isWorkflowStopEvent(v)) handleStop()
  })

  return (
    <div className="flex items-center gap-x-px">
      {isRunDisabled ? (
        <button
          type="button"
          className={cn(
            'flex h-7 cursor-not-allowed items-center gap-x-1 rounded-md px-1.5 system-xs-medium text-text-accent opacity-50',
          )}
          disabled
          style={{ userSelect: 'none' }}
        >
          <span aria-hidden className="mr-1 i-ri-play-large-line size-4" />
          {text ?? t(($) => $['common.run'], { ns: 'workflow' })}
          <ShortcutKbd hotkey={TEST_RUN_MENU_HOTKEY} textColor="secondary" />
        </button>
      ) : isRunning ? (
        <button
          type="button"
          className={cn(
            'flex h-7 cursor-not-allowed items-center gap-x-1 rounded-l-md bg-state-accent-hover px-1.5 system-xs-medium text-text-accent',
          )}
          disabled={true}
        >
          <span className="mr-1 i-ri-loader-2-line size-4 animate-spin" />
          {isListening
            ? t(($) => $['common.listening'], { ns: 'workflow' })
            : t(($) => $['common.running'], { ns: 'workflow' })}
        </button>
      ) : (
        <TestRunMenu ref={testRunMenuRef} options={dynamicOptions} onSelect={handleTriggerSelect}>
          <button
            type="button"
            className={cn(
              'flex h-7 cursor-pointer items-center gap-x-1 rounded-md px-1.5 system-xs-medium text-text-accent hover:bg-state-accent-hover',
            )}
            style={{ userSelect: 'none' }}
          >
            <span aria-hidden className="mr-1 i-ri-play-large-line size-4" />
            {text ?? t(($) => $['common.run'], { ns: 'workflow' })}
            <ShortcutKbd hotkey={TEST_RUN_MENU_HOTKEY} textColor="secondary" />
          </button>
        </TestRunMenu>
      )}
      {isRunning && !isRunDisabled && (
        <button
          type="button"
          aria-label={t(($) => $['debug.variableInspect.trigger.stop'], { ns: 'workflow' })}
          className={cn(
            'flex size-7 items-center justify-center rounded-r-md bg-state-accent-active',
          )}
          onClick={handleStop}
        >
          <span aria-hidden className="i-ri-stop-circle-line size-4 text-text-accent" />
        </button>
      )}
    </div>
  )
}

export default React.memo(RunMode)
