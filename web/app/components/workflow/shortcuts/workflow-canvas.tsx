import type { ReactFlowProps } from 'reactflow'
import { cn } from '@langgenius/dify-ui/cn'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactFlow from 'reactflow'
import { useWorkflowHotkeys } from './use-workflow-hotkeys'

export function WorkflowCanvas({
  className,
  onFocus,
  onBlur,
  onPaneClick,
  onNodeClick,
  onEdgeContextMenu,
  onNodeDragStart,
  onSelectionStart,
  ...props
}: ReactFlowProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation(['app'])
  const [canvasHasFocus, setCanvasHasFocus] = useState(false)
  useWorkflowHotkeys(canvasRef, canvasHasFocus)

  function isCanvasFocusTarget(element: EventTarget | null) {
    return (
      element instanceof HTMLElement &&
      !!canvasRef.current?.contains(element) &&
      !element.isContentEditable &&
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
    )
  }

  function focusCanvas() {
    canvasRef.current?.focus({ preventScroll: true })
  }

  return (
    <ReactFlow
      {...props}
      ref={canvasRef}
      tabIndex={0}
      role="region"
      aria-label={t(($) => $['types.workflow'], { ns: 'app' })}
      className={cn(
        'focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-none focus-visible:ring-inset',
        className,
      )}
      onFocus={(event) => {
        setCanvasHasFocus(isCanvasFocusTarget(event.target))
        onFocus?.(event)
      }}
      onBlur={(event) => {
        setCanvasHasFocus(isCanvasFocusTarget(event.relatedTarget))
        onBlur?.(event)
      }}
      onPaneClick={(event) => {
        focusCanvas()
        onPaneClick?.(event)
      }}
      onNodeClick={(event, node) => {
        const target = event.target
        const control =
          target instanceof Element
            ? target.closest(
                'a[href], button, input, textarea, select, [contenteditable], [tabindex]',
              )
            : null
        if (
          (!control || control === event.currentTarget) &&
          event.currentTarget instanceof HTMLElement
        )
          event.currentTarget.focus({ preventScroll: true })
        onNodeClick?.(event, node)
      }}
      onEdgeContextMenu={(event, edge) => {
        // SVG edge anchors cannot be the menu primitive's HTML focus return target.
        focusCanvas()
        onEdgeContextMenu?.(event, edge)
      }}
      onNodeDragStart={(event, node, nodes) => {
        focusCanvas()
        onNodeDragStart?.(event, node, nodes)
      }}
      onSelectionStart={(event) => {
        focusCanvas()
        onSelectionStart?.(event)
      }}
    />
  )
}
