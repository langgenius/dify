import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { RiLoader2Line, RiStopCircleFill } from '@remixicon/react'
import Tooltip from '@/app/components/base/tooltip'
import { useStore } from '../store'
import useCurrentVars from '../hooks/use-current-vars'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

const VariableInspectTrigger: FC = () => {
  const { t } = useTranslation()

  const showVariableInspectPanel = useStore(s => s.showVariableInspectPanel)
  const setShowVariableInspectPanel = useStore(s => s.setShowVariableInspectPanel)

  const workflowRunningData = useStore(s => s.workflowRunningData)
  const isRunning = useMemo(() => {
    if (!workflowRunningData)
      return false
    if (workflowRunningData.result.status === WorkflowRunningStatus.Running)
      return true
    return (workflowRunningData.tracing || []).some(tracingData => tracingData.status === NodeRunningStatus.Running)
  }, [workflowRunningData])

  const {
    currentVars,
    clearCurrentVars,
  } = useCurrentVars()

  // ##TODD stop handle

  if (showVariableInspectPanel)
    return null

  return (
    <div className={cn('flex items-center gap-1')}>
      {!isRunning && !currentVars.length && (
        <div
          className='system-2xs-semibold-uppercase flex h-5 cursor-pointer items-center gap-1 rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-2 text-text-tertiary shadow-lg backdrop-blur-sm hover:bg-background-default-hover'
          onClick={() => setShowVariableInspectPanel(true)}
        >
          {t('workflow.debug.variableInspect.trigger.normal')}
        </div>
      )}
      {!isRunning && currentVars.length > 0 && (
        <>
          <div
            className='system-xs-medium flex h-6 cursor-pointer items-center gap-1 rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-2 text-text-accent shadow-lg backdrop-blur-sm hover:bg-components-actionbar-bg-accent'
            onClick={() => setShowVariableInspectPanel(true)}
          >
            {t('workflow.debug.variableInspect.trigger.cached')}
            </div>
          <div
            className='system-xs-medium flex h-6 cursor-pointer items-center rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-1 text-text-tertiary shadow-lg backdrop-blur-sm hover:bg-components-actionbar-bg-accent hover:text-text-accent'
            onClick={clearCurrentVars}
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
          <Tooltip
            popupContent={t('workflow.debug.variableInspect.trigger.stop')}
          >
            <div
              className='flex h-6 cursor-pointer items-center rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-1 shadow-lg backdrop-blur-sm hover:bg-components-actionbar-bg-accent'
              // onClick={() => {}}
            >
              <RiStopCircleFill className='h-4 w-4 text-text-accent' />
            </div>
          </Tooltip>
        </>
      )}
    </div>
  )
}

export default VariableInspectTrigger
