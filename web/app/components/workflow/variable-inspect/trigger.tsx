import type { FC } from 'react'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { RiLoader2Line, RiStopCircleFill } from '@remixicon/react'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNodes } from 'reactflow'
import { NodeRunningStatus, WorkflowRunningStatus } from '@/app/components/workflow/types'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import useCurrentVars from '../hooks/use-inspect-vars-crud'
import { useNodesReadOnly } from '../hooks/use-workflow'
import { useStore } from '../store'

const VariableInspectTrigger: FC = () => {
  const { t } = useTranslation()
  const { eventEmitter } = useEventEmitterContextContext()

  const showVariableInspectPanel = useStore((s) => s.showVariableInspectPanel)
  const setShowVariableInspectPanel = useStore((s) => s.setShowVariableInspectPanel)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wasPanelOpenRef = useRef(showVariableInspectPanel)

  const environmentVariables = useStore((s) => s.environmentVariables)
  const setCurrentFocusNodeId = useStore((s) => s.setCurrentFocusNodeId)
  const { conversationVars, systemVars, nodesWithInspectVars, deleteAllInspectorVars } =
    useCurrentVars()
  const currentVars = useMemo(() => {
    const allVars = [
      ...environmentVariables,
      ...conversationVars,
      ...systemVars,
      ...nodesWithInspectVars,
    ]
    return allVars
  }, [environmentVariables, conversationVars, systemVars, nodesWithInspectVars])
  const { nodesReadOnly, getNodesReadOnly } = useNodesReadOnly()
  const workflowRunningData = useStore((s) => s.workflowRunningData)
  const nodes = useNodes<CommonNodeType>()
  const isStepRunning = useMemo(
    () => nodes.some((node) => node.data._singleRunningStatus === NodeRunningStatus.Running),
    [nodes],
  )
  const isPreviewRunning = useMemo(() => {
    if (!workflowRunningData) return false
    return workflowRunningData.result.status === WorkflowRunningStatus.Running
  }, [workflowRunningData])
  const isRunning = useMemo(
    () => isPreviewRunning || isStepRunning,
    [isPreviewRunning, isStepRunning],
  )

  const handleStop = () => {
    eventEmitter?.emit({
      type: EVENT_WORKFLOW_STOP,
    } as any)
  }

  const handleClearAll = () => {
    deleteAllInspectorVars()
    setCurrentFocusNodeId('')
  }

  useEffect(() => {
    const wasPanelOpen = wasPanelOpenRef.current
    wasPanelOpenRef.current = showVariableInspectPanel

    if (wasPanelOpen && !showVariableInspectPanel && document.activeElement === document.body)
      triggerRef.current?.focus()
  }, [showVariableInspectPanel])

  if (showVariableInspectPanel) return null

  return (
    <div className={cn('flex shrink-0 flex-nowrap items-center gap-1 whitespace-nowrap')}>
      {!isRunning && !currentVars.length && (
        <Button
          ref={triggerRef}
          variant="ghost"
          size={null}
          disabled={nodesReadOnly}
          className={cn(
            'flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-2 system-2xs-semibold-uppercase text-text-tertiary shadow-lg backdrop-blur-xs hover:bg-background-default-hover',
            nodesReadOnly &&
              'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled',
          )}
          onClick={() => {
            if (getNodesReadOnly()) return
            setShowVariableInspectPanel(true)
          }}
        >
          {t(($) => $['debug.variableInspect.trigger.normal'], { ns: 'workflow' })}
        </Button>
      )}
      {!isRunning && currentVars.length > 0 && (
        <>
          <Button
            ref={triggerRef}
            variant="ghost"
            size={null}
            disabled={nodesReadOnly}
            className={cn(
              'flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-2 system-xs-medium text-text-accent shadow-lg backdrop-blur-xs hover:bg-components-actionbar-bg-accent',
              nodesReadOnly &&
                'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled',
            )}
            onClick={() => {
              if (getNodesReadOnly()) return
              setShowVariableInspectPanel(true)
            }}
          >
            {t(($) => $['debug.variableInspect.trigger.cached'], { ns: 'workflow' })}
          </Button>
          <Button
            ref={triggerRef}
            variant="ghost"
            size={null}
            disabled={nodesReadOnly}
            className={cn(
              'flex h-6 shrink-0 cursor-pointer items-center rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-1 system-xs-medium text-text-tertiary shadow-lg backdrop-blur-xs hover:bg-components-actionbar-bg-accent hover:text-text-accent',
              nodesReadOnly &&
                'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled',
            )}
            onClick={() => {
              if (getNodesReadOnly()) return
              handleClearAll()
            }}
          >
            {t(($) => $['debug.variableInspect.trigger.clear'], { ns: 'workflow' })}
          </Button>
        </>
      )}
      {isRunning && (
        <>
          <Button
            variant="ghost"
            size={null}
            className="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-2 system-xs-medium text-text-accent shadow-lg backdrop-blur-xs hover:bg-components-actionbar-bg-accent"
            onClick={() => setShowVariableInspectPanel(true)}
          >
            <RiLoader2Line aria-hidden className="size-4 shrink-0 animate-spin" />
            <span className="text-text-accent">
              {t(($) => $['debug.variableInspect.trigger.running'], { ns: 'workflow' })}
            </span>
          </Button>
          {isPreviewRunning && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <IconButton
                    aria-label={t(($) => $['debug.variableInspect.trigger.stop'], {
                      ns: 'workflow',
                    })}
                    variant="ghost"
                    size={null}
                    className="flex h-6 shrink-0 cursor-pointer items-center rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-1 shadow-lg backdrop-blur-xs hover:bg-components-actionbar-bg-accent"
                    onClick={handleStop}
                  >
                    <RiStopCircleFill aria-hidden className="size-4 shrink-0 text-text-accent" />
                  </IconButton>
                }
              />
              <TooltipContent>
                {t(($) => $['debug.variableInspect.trigger.stop'], { ns: 'workflow' })}
              </TooltipContent>
            </Tooltip>
          )}
        </>
      )}
    </div>
  )
}

export default VariableInspectTrigger
