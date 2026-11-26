import type { PointerEvent, ReactNode } from 'react'
import { createLocalStorageState } from 'foxact/create-local-storage-state'
import { useEffect, useId, useRef, useState } from 'react'
import ResizeHandle from '@/app/components/base/resize-handle'

const MIN_WIDTH = 320
const MAX_WIDTH = 760
const DEFAULT_WIDTH = 400
const RESERVED_CANVAS_WIDTH = 240
const [usePanelWidth] = createLocalStorageState<number>('dify-builder-panel-width', DEFAULT_WIDTH)

export function ResizableBuilderPanel({ label, children }: { label: string; children: ReactNode }) {
  const panelId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const dragRef = useRef<{ pointerId: number; x: number; width: number } | null>(null)
  const [preferredWidth, setPreferredWidth] = usePanelWidth()
  const [availableWidth, setAvailableWidth] = useState<number>()
  const [dragWidth, setDragWidth] = useState<number>()

  useEffect(() => {
    const host = panelRef.current?.parentElement
    if (!host) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0)
        setAvailableWidth(Math.floor(entry.contentRect.width))
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const max =
    availableWidth === undefined
      ? MAX_WIDTH
      : Math.min(
          MAX_WIDTH,
          availableWidth,
          Math.max(MIN_WIDTH, availableWidth - RESERVED_CANVAS_WIDTH),
        )
  const min = Math.min(MIN_WIDTH, max)
  const clamp = (value: number) => Math.min(max, Math.max(min, value))
  const savedWidth =
    typeof preferredWidth === 'number' && Number.isFinite(preferredWidth)
      ? preferredWidth
      : DEFAULT_WIDTH
  const width = clamp(dragWidth ?? savedWidth)

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, width }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const getDragWidth = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragRef.current
    if (start?.pointerId !== event.pointerId) return undefined
    return clamp(start.width + start.x - event.clientX)
  }

  const cancelResize = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragWidth(undefined)
  }

  return (
    <aside
      ref={panelRef}
      id={panelId}
      aria-label={label}
      className="relative z-10 flex h-full max-w-full shrink-0 bg-background-body py-1 pe-1"
      style={{ width }}
    >
      <ResizeHandle
        side="left"
        value={width}
        min={min}
        max={max}
        label={label}
        controls={panelId}
        onResize={setPreferredWidth}
        className="absolute inset-y-0 inset-s-0 z-20 flex w-3 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center select-none"
        onPointerDown={startResize}
        onPointerMove={(event) => {
          const next = getDragWidth(event)
          if (next !== undefined) setDragWidth(next)
        }}
        onPointerUp={(event) => {
          const next = getDragWidth(event)
          if (next !== undefined && next !== clamp(savedWidth)) setPreferredWidth(next)
          cancelResize(event)
        }}
        onPointerCancel={cancelResize}
        onLostPointerCapture={cancelResize}
      >
        <span
          aria-hidden="true"
          className="h-8 w-0.5 rounded-full bg-state-base-handle group-hover/resize:bg-state-accent-solid"
        />
      </ResizeHandle>
      {children}
    </aside>
  )
}
