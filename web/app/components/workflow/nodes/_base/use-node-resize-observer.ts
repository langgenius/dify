import {
  useEffect,
  useRef,
} from 'react'

export type ObservedNodeSize = {
  width: number
  height: number
}

type ResizeObserverParams = {
  enabled: boolean
  nodeRef: React.RefObject<HTMLDivElement | null>
  onResize: (size: ObservedNodeSize) => void
}

const getObservedNodeSize = (entry: ResizeObserverEntry): ObservedNodeSize => {
  const borderBoxSize = Array.isArray(entry.borderBoxSize)
    ? entry.borderBoxSize[0]
    : entry.borderBoxSize

  if (borderBoxSize) {
    return {
      width: borderBoxSize.inlineSize,
      height: borderBoxSize.blockSize,
    }
  }

  return {
    width: entry.contentRect.width,
    height: entry.contentRect.height,
  }
}

const useNodeResizeObserver = ({
  enabled,
  nodeRef,
  onResize,
}: ResizeObserverParams) => {
  const resizeFrameRef = useRef<number | undefined>(undefined)
  const lastSizeRef = useRef<ObservedNodeSize | undefined>(undefined)

  useEffect(() => {
    if (!enabled || !nodeRef.current)
      return

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry)
        return

      const size = getObservedNodeSize(entry)
      const lastSize = lastSizeRef.current
      if (lastSize?.width === size.width && lastSize.height === size.height)
        return

      lastSizeRef.current = size

      if (resizeFrameRef.current)
        cancelAnimationFrame(resizeFrameRef.current)

      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = undefined
        onResize(size)
      })
    })

    resizeObserver.observe(nodeRef.current)

    return () => {
      if (resizeFrameRef.current) {
        cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = undefined
      }
      resizeObserver.disconnect()
    }
  }, [enabled, nodeRef, onResize])
}

export default useNodeResizeObserver
