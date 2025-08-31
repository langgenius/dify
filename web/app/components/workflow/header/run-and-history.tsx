import type { FC } from 'react'
import { memo, useEffect, useRef } from 'react'
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
  useWorkflowRunValidation,
  useWorkflowStartRun,
} from '../hooks'
import { WorkflowRunningStatus } from '../types'
import ViewHistory from './view-history'
import Checklist from './checklist'
import TestRunDropdown, { type TestRunDropdownRef } from './test-run-dropdown'
import type { TriggerOption } from './test-run-dropdown'
import { useDynamicTestRunOptions } from '../hooks/use-dynamic-test-run-options'
import cn from '@/utils/classnames'
import {
  StopCircle,
} from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import useTheme from '@/hooks/use-theme'
import ShortcutsName from '../shortcuts-name'

const RunMode = memo(() => {
  const { t } = useTranslation()
  const { handleWorkflowStartRunInWorkflow } = useWorkflowStartRun()
  const { handleStopRun } = useWorkflowRun()
  const { validateBeforeRun } = useWorkflowRunValidation()
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const isRunning = workflowRunningData?.result.status === WorkflowRunningStatus.Running
  const dynamicOptions = useDynamicTestRunOptions()
  const testRunDropdownRef = useRef<TestRunDropdownRef>(null)

  useEffect(() => {
    // @ts-expect-error - Dynamic property for backward compatibility with keyboard shortcuts
    window._toggleTestRunDropdown = () => {
      testRunDropdownRef.current?.toggle()
    }
    return () => {
      // @ts-expect-error - Dynamic property cleanup
      delete window._toggleTestRunDropdown
    }
  }, [])

  const handleStop = () => {
    handleStopRun(workflowRunningData?.task_id || '')
  }

  const handleTriggerSelect = (option: TriggerOption) => {
    // Validate checklist before running any workflow
    if (!validateBeforeRun())
      return

    if (option.type === 'user_input') {
      handleWorkflowStartRunInWorkflow()
    }
 else {
      // Placeholder for trigger-specific execution logic for schedule, webhook, plugin types
      console.log('TODO: Handle trigger execution for type:', option.type, 'nodeId:', option.nodeId)
    }
  }

  const { eventEmitter } = useEventEmitterContextContext()
  eventEmitter?.useSubscription((v: any) => {
    if (v.type === EVENT_WORKFLOW_STOP)
      handleStop()
  })

  return (
    <>
      {
        isRunning
          ? (
            <div
              className={cn(
                'flex h-7 items-center rounded-md px-2.5 text-[13px] font-medium text-components-button-secondary-accent-text',
                '!cursor-not-allowed bg-state-accent-hover',
              )}
            >
              <RiLoader2Line className='mr-1 h-4 w-4 animate-spin' />
              {t('workflow.common.running')}
            </div>
          )
          : (
            <TestRunDropdown
              ref={testRunDropdownRef}
              options={dynamicOptions}
              onSelect={handleTriggerSelect}
            >
              <div
                className={cn(
                  'flex h-7 items-center rounded-md px-2.5 text-[13px] font-medium text-components-button-secondary-accent-text',
                  'cursor-pointer hover:bg-state-accent-hover',
                )}
                style={{ userSelect: 'none' }}
              >
                <RiPlayLargeLine className='mr-1 h-4 w-4' />
                {t('workflow.common.run')}
                <ShortcutsName keys={['alt', 'r']} className="ml-1" textColor="secondary" />
              </div>
            </TestRunDropdown>
          )
      }
      {
        isRunning && (
          <div
            className='ml-0.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md hover:bg-black/5'
            onClick={handleStop}
          >
            <StopCircle className='h-4 w-4 text-components-button-ghost-text' />
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
PreviewMode.displayName = 'PreviewMode'

const RunAndHistory: FC = () => {
  const { theme } = useTheme()
  const isChatMode = useIsChatMode()
  const { nodesReadOnly } = useNodesReadOnly()

  return (
    <>
      <div className={cn(
        'flex h-8 items-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-0.5 shadow-xs',
        theme === 'dark' && 'rounded-lg border border-black/5 bg-white/10 backdrop-blur-sm',
      )}>
        {
          !isChatMode && <RunMode />
        }
        {
          isChatMode && <PreviewMode />
        }
        <div className='mx-0.5 h-3.5 w-[1px] bg-divider-regular'></div>
        <ViewHistory />
        <Checklist disabled={nodesReadOnly} />
      </div>
    </>
  )
}

export default memo(RunAndHistory)
