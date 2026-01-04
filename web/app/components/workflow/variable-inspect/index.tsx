import type { FC } from 'react'
import { debounce } from 'es-toolkit/compat'
import {
  useCallback,
  useMemo,
} from 'react'
import { cn } from '@/utils/classnames'
import { useResizePanel } from '../nodes/_base/hooks/use-resize-panel'
import { useStore } from '../store'
import Panel from './panel'

const VariableInspectPanel: FC = () => {
  const showVariableInspectPanel = useStore(s => s.showVariableInspectPanel)
  const workflowCanvasHeight = useStore(s => s.workflowCanvasHeight)
  const variableInspectPanelHeight = useStore(s => s.variableInspectPanelHeight)
  const setVariableInspectPanelHeight = useStore(s => s.setVariableInspectPanelHeight)

  const maxHeight = useMemo(() => {
    if (!workflowCanvasHeight)
      return 480
    return workflowCanvasHeight - 60
  }, [workflowCanvasHeight])

  const handleResize = useCallback((width: number, height: number) => {
    localStorage.setItem('workflow-variable-inpsect-panel-height', `${height}`)
    setVariableInspectPanelHeight(height)
  }, [setVariableInspectPanelHeight])

  const {
    triggerRef,
    containerRef,
  } = useResizePanel({
    direction: 'vertical',
    triggerDirection: 'top',
    minHeight: 120,
    maxHeight,
    onResize: debounce(handleResize),
  })

  if (!showVariableInspectPanel)
    return null

  return (
    <div className={cn('relative pb-1')}>
      <div
        ref={triggerRef}
        className="absolute -top-1 left-0 flex h-1 w-full cursor-row-resize resize-y items-center justify-center"
      >
        <div className="h-0.5 w-10 rounded-sm bg-state-base-handle hover:w-full hover:bg-state-accent-solid active:w-full active:bg-state-accent-solid"></div>
      </div>
      <div
        ref={containerRef}
        className={cn('overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl')}
        style={{ height: `${variableInspectPanelHeight}px` }}
      >
        <Panel />
      </div>
    </div>
  )
}

export default VariableInspectPanel
