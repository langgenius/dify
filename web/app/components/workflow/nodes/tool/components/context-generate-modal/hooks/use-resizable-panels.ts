import type { PointerEvent } from 'react'
import { useEventListener, useSize } from 'ahooks'
import { useCallback, useMemo, useRef, useState } from 'react'

const minCodeHeight = 80
const minOutputHeight = 80
const splitHandleHeight = 4
const defaultCodePanelHeight = 556

const useResizablePanels = () => {
  const rightContainerRef = useRef<HTMLDivElement>(null)
  const rightContainerSize = useSize(rightContainerRef)
  const [codePanelHeight, setCodePanelHeight] = useState(defaultCodePanelHeight)
  const draggingRef = useRef(false)
  const dragStartRef = useRef({ startY: 0, startHeight: 0 })

  const maxCodePanelHeight = useMemo(() => {
    const containerHeight = rightContainerSize?.height ?? 0
    if (!containerHeight)
      return null
    return Math.max(minCodeHeight, containerHeight - minOutputHeight - splitHandleHeight)
  }, [rightContainerSize?.height])

  const resolvedCodePanelHeight = useMemo(() => {
    if (!maxCodePanelHeight)
      return codePanelHeight
    // Clamp the panel height so the output area always has space.
    return Math.min(codePanelHeight, maxCodePanelHeight)
  }, [codePanelHeight, maxCodePanelHeight])

  const handleResizeStart = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    draggingRef.current = true
    dragStartRef.current = {
      startY: event.clientY,
      startHeight: resolvedCodePanelHeight,
    }
    document.body.style.userSelect = 'none'
  }, [resolvedCodePanelHeight])

  useEventListener('mousemove', (event) => {
    if (!draggingRef.current)
      return

    const containerHeight = rightContainerRef.current?.offsetHeight || 0
    if (!containerHeight)
      return
    const maxHeight = Math.max(minCodeHeight, containerHeight - minOutputHeight - splitHandleHeight)
    const delta = event.clientY - dragStartRef.current.startY
    const nextHeight = Math.min(Math.max(dragStartRef.current.startHeight + delta, minCodeHeight), maxHeight)
    setCodePanelHeight(nextHeight)
  })

  useEventListener('mouseup', () => {
    if (!draggingRef.current)
      return
    draggingRef.current = false
    document.body.style.userSelect = ''
  })

  return {
    rightContainerRef,
    resolvedCodePanelHeight,
    handleResizeStart,
  }
}

export default useResizablePanels
