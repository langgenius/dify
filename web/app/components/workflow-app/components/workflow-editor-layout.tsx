import type { ComponentType, ReactNode, Ref } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useLayoutEffect, useRef } from 'react'
import { useStore } from '@/app/components/workflow/store'

const MIN_DOCKED_EDITOR_WIDTH = 680
const NATIVE_PANEL_WIDTH_RESERVE = 808
const TOOLBAR_WIDTH = 48

export function WorkflowEditorLayout({
  builderPanel: BuilderPanel,
  canvasRef,
  children,
}: {
  builderPanel?: ComponentType<{ minimumEditorWidth?: number }>
  canvasRef?: Ref<HTMLDivElement>
  children: ReactNode
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const rightPanelWidth = useStore((state) => (BuilderPanel ? state.rightPanelWidth : undefined))
  const minimumEditorWidth = Math.max(
    MIN_DOCKED_EDITOR_WIDTH,
    Math.min(rightPanelWidth ?? 0, NATIVE_PANEL_WIDTH_RESERVE) + TOOLBAR_WIDTH,
  )

  useLayoutEffect(() => {
    if (!BuilderPanel && viewportRef.current) viewportRef.current.scrollLeft = 0
  }, [BuilderPanel])

  return (
    <div
      ref={viewportRef}
      className={cn(
        'flex size-full min-w-0',
        BuilderPanel ? 'overflow-x-auto overflow-y-hidden' : 'overflow-hidden',
      )}
    >
      <div
        ref={canvasRef}
        className={cn('relative min-w-0 flex-1', BuilderPanel && '[--workflow-min-width:0px]')}
        style={BuilderPanel ? { minWidth: minimumEditorWidth } : undefined}
      >
        {children}
      </div>
      {BuilderPanel && <BuilderPanel minimumEditorWidth={minimumEditorWidth} />}
    </div>
  )
}
