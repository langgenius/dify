import type { FC } from 'react'
import { useMemo } from 'react'
import { useNodes } from 'reactflow'
import { useTranslation } from 'react-i18next'
import { RiLoader2Line, RiStopCircleFill } from '@remixicon/react'
import Tooltip from '@/app/components/base/tooltip'
import { useStore } from '../store'
import useCurrentVars from '../hooks/use-inspect-vars-crud'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import cn from '@/utils/classnames'
import { useNodesReadOnly } from '../hooks/use-workflow'

const VariableInspectTrigger: FC = () => {
  const { t } = useTranslation()
  const { eventEmitter } = useEventEmitterContextContext()

  const showVariableInspectPanel = useStore(s => s.showVariableInspectPanel)
  const setShowVariableInspectPanel = useStore(s => s.setShowVariableInspectPanel)

  const environmentVariables = useStore(s => s.environmentVariables)
  const setCurrentFocusNodeId = useStore(s => s.setCurrentFocusNodeId)
  const {
    conversationVars,
    systemVars,
    nodesWithInspectVars,
    deleteAllInspectorVars,
  } = useCurrentVars()
  const currentVars = useMemo(() => {
    const allVars = [...environmentVariables, ...conversationVars, ...systemVars, ...nodesWithInspectVars]
    return allVars
  }, [environmentVariables, conversationVars, systemVars, nodesWithInspectVars])
  const {
    nodesReadOnly,
    getNodesReadOnly,
  } = useNodesReadOnly()
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const nodes = useNodes<CommonNodeType>()
  const isStepRunning = useMemo(() => nodes.some(node => node.data._singleRunningStatus === NodeRunningStatus.Running), [nodes])
  const isPreviewRunning = useMemo(() => {
    if (!workflowRunningData)
      return false
    return workflowRunningData.result.status === WorkflowRunningStatus.Running
  }, [workflowRunningData])
  const isRunning = useMemo(() => isPreviewRunning || isStepRunning, [isPreviewRunning, isStepRunning])

  const handleStop = () => {
    eventEmitter?.emit({
      type: EVENT_WORKFLOW_STOP,
    } as any)
  }

  const handleClearAll = () => {
    deleteAllInspectorVars()
    setCurrentFocusNodeId('')
  }

  if (showVariableInspectPanel)
    return null

  return (
    <div className={cn('flex items-center gap-1')}>
      {!isRunning && !currentVars.length && (
        <div
          className={cn('system-2xs-semibold-uppercase flex h-5 cursor-pointer items-center gap-1 rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-2 text-text-tertiary shadow-lg backdrop-blur-sm hover:bg-background-default-hover',
            nodesReadOnly && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled',
          )}
          onClick={() => {
            if (getNodesReadOnly())
              return
            setShowVariableInspectPanel(true)
          }}
        >
          {t('workflow.debug.variableInspect.trigger.normal')}
        </div>
      )}
      {!isRunning && currentVars.length > 0 && (
        <>
          <div
            className={cn('system-xs-medium flex h-6 cursor-pointer items-center gap-1 rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-2 text-text-accent shadow-lg backdrop-blur-sm hover:bg-components-actionbar-bg-accent',
              nodesReadOnly && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled',
            )}
            onClick={() => {
              if (getNodesReadOnly())
                return
              setShowVariableInspectPanel(true)
            }}
          >
            {t('workflow.debug.variableInspect.trigger.cached')}
          </div>
          <div
            className={cn('system-xs-medium flex h-6 cursor-pointer items-center rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-1 text-text-tertiary shadow-lg backdrop-blur-sm hover:bg-components-actionbar-bg-accent hover:text-text-accent',
              nodesReadOnly && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled',
            )}
            onClick={handleClearAll}
          >
            {t('workflow.debug.variableInspect.trigger.clear')}
          </div>
        </>
      )}
      {isRunning && (
        <>
          <div
            className='system-xs-medium flex h-6 cursor-pointer items-center gap-1 rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-2 text-text-accent shadow-lg backdrop-blur-sm hover:bg-components-actionbar-bg-accent'
            onClick={() => setShowVariableInspectPanel(true)}
          >
            <RiLoader2Line className='h-4 w-4' />
            <span className='text-text-accent'>{t('workflow.debug.variableInspect.trigger.running')}</span>
          </div>
          {isPreviewRunning && (
            <Tooltip
              popupContent={t('workflow.debug.variableInspect.trigger.stop')}
            >
              <div
                className='flex h-6 cursor-pointer items-center rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-1 shadow-lg backdrop-blur-sm hover:bg-components-actionbar-bg-accent'
                onClick={handleStop}
              >
                <RiStopCircleFill className='h-4 w-4 text-text-accent' />
              </div>
            </Tooltip>
          )}
        </>
      )}
    </div>
  )
}

export default VariableInspectTrigger
