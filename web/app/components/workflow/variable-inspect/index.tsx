import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { debounce } from 'es-toolkit/compat'
import { useCallback, useEffect, useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ResizeHandle from '@/app/components/base/resize-handle'
import { useResizePanel } from '../nodes/_base/hooks/use-resize-panel'
import { useSetWorkflowVariableInspectPanelHeight } from '../persistence/local-storage-options'
import { useStore } from '../store'
import Panel from './panel'

const VariableInspectPanel: FC = () => {
  const { t } = useTranslation('workflow')
  const panelId = useId()
  const showVariableInspectPanel = useStore((s) => s.showVariableInspectPanel)
  const workflowCanvasHeight = useStore((s) => s.workflowCanvasHeight)
  const variableInspectPanelHeight = useStore((s) => s.variableInspectPanelHeight)
  const setVariableInspectPanelHeight = useStore((s) => s.setVariableInspectPanelHeight)

  const maxHeight = useMemo(() => {
    if (!workflowCanvasHeight) return 480
    return Math.max(120, workflowCanvasHeight - 60)
  }, [workflowCanvasHeight])

  useEffect(() => {
    if (!workflowCanvasHeight) return
    if (variableInspectPanelHeight > maxHeight) setVariableInspectPanelHeight(maxHeight)
  }, [workflowCanvasHeight, variableInspectPanelHeight, maxHeight, setVariableInspectPanelHeight])

  const setPanelHeightStorage = useSetWorkflowVariableInspectPanelHeight()

  const handleResize = useCallback(
    (width: number, height: number) => {
      setPanelHeightStorage(height)
      setVariableInspectPanelHeight(height)
    },
    [setVariableInspectPanelHeight, setPanelHeightStorage],
  )

  const { triggerRef, containerRef } = useResizePanel({
    direction: 'vertical',
    triggerDirection: 'top',
    minHeight: 120,
    maxHeight,
    onResize: debounce(handleResize),
  })

  if (!showVariableInspectPanel) return null

  return (
    <div className={cn('relative pb-1')}>
      <ResizeHandle
        ref={triggerRef}
        side="top"
        value={variableInspectPanelHeight}
        min={120}
        max={maxHeight}
        controls={panelId}
        label={t(($) => $['debug.variableInspect.title'])}
        onResize={(height) => handleResize(0, height)}
        className="absolute -top-1 left-0 flex h-1 w-full cursor-row-resize items-center justify-center"
      >
        <div className="h-0.5 w-10 rounded-xs bg-state-base-handle group-focus-visible/resize:w-full group-focus-visible/resize:bg-state-accent-solid hover:w-full hover:bg-state-accent-solid active:w-full active:bg-state-accent-solid"></div>
      </ResizeHandle>
      <div
        id={panelId}
        ref={containerRef}
        className={cn(
          'overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl',
        )}
        style={{ height: `${variableInspectPanelHeight}px` }}
      >
        <Panel />
      </div>
    </div>
  )
}

export default VariableInspectPanel
