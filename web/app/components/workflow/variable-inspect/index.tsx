import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { debounce } from 'es-toolkit/compat'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useResizePanel } from '../nodes/_base/hooks/use-resize-panel'
import { useSetWorkflowVariableInspectPanelHeight } from '../persistence/local-storage-options'
import { useStore } from '../store'
import Panel from './panel'

const VariableInspectPanel: FC = () => {
  const { t } = useTranslation()
  const showVariableInspectPanel = useStore((s) => s.showVariableInspectPanel)
  const workflowCanvasHeight = useStore((s) => s.workflowCanvasHeight)
  const variableInspectPanelHeight = useStore((s) => s.variableInspectPanelHeight)
  const setVariableInspectPanelHeight = useStore((s) => s.setVariableInspectPanelHeight)

  const maxHeight = useMemo(() => {
    if (!workflowCanvasHeight) return 480
    return workflowCanvasHeight - 60
  }, [workflowCanvasHeight])

  const setPanelHeightStorage = useSetWorkflowVariableInspectPanelHeight()

  const handleResize = useCallback(
    (width: number, height: number) => {
      setPanelHeightStorage(height)
      setVariableInspectPanelHeight(height)
    },
    [setVariableInspectPanelHeight, setPanelHeightStorage],
  )

  const { triggerRef, containerRef, resizeHandleProps } = useResizePanel({
    direction: 'vertical',
    triggerDirection: 'top',
    minHeight: 120,
    maxHeight,
    currentHeight: variableInspectPanelHeight,
    onResize: debounce(handleResize),
  })

  useEffect(() => {
    if (showVariableInspectPanel) containerRef.current?.focus()
  }, [containerRef, showVariableInspectPanel])

  if (!showVariableInspectPanel) return null

  return (
    <div className={cn('relative pb-1')}>
      <div
        ref={triggerRef}
        {...resizeHandleProps}
        aria-controls="workflow-variable-inspect-panel"
        aria-label={t(($) => $['debug.variableInspect.title'], { ns: 'workflow' })}
        className="group absolute -top-1 left-0 flex h-1 w-full cursor-row-resize resize-y items-center justify-center focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
      >
        <div className="h-0.5 w-10 rounded-xs bg-state-base-handle group-focus-visible:w-full group-focus-visible:bg-state-accent-solid hover:w-full hover:bg-state-accent-solid active:w-full active:bg-state-accent-solid"></div>
      </div>
      <div
        id="workflow-variable-inspect-panel"
        ref={containerRef}
        role="region"
        tabIndex={-1}
        aria-label={t(($) => $['debug.variableInspect.title'], { ns: 'workflow' })}
        className={cn(
          'overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
        )}
        style={{ height: `${variableInspectPanelHeight}px` }}
      >
        <Panel />
      </div>
    </div>
  )
}

export default VariableInspectPanel
