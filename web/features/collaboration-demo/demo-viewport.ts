import { useEffect } from 'react'
import { useNodesInitialized, useReactFlow, useStore } from 'reactflow'
import { demoGraphBounds } from './demo-graph'

const toolbarInset = 56
const headerInset = 64

export function getDemoViewport(width: number, height: number) {
  const reserve = width - toolbarInset >= 1000 ? 440 : 48
  const availableWidth = width - toolbarInset - reserve - 16
  const availableHeight = height - headerInset - 64
  const zoom = Math.max(
    0.25,
    Math.min(1, availableWidth / demoGraphBounds.width, availableHeight / demoGraphBounds.height),
  )
  return {
    zoom,
    x:
      toolbarInset + (availableWidth - demoGraphBounds.width * zoom) / 2 - demoGraphBounds.x * zoom,
    y:
      headerInset +
      (availableHeight - demoGraphBounds.height * zoom) / 2 -
      demoGraphBounds.y * zoom,
  }
}

export function getThreadPlacement(
  pin: { x: number; y: number },
  canvas: { width: number; height: number },
) {
  return {
    left: Math.max(8, Math.min(pin.x + 40, canvas.width - 368)),
    top: Math.max(headerInset, Math.min(pin.y - 28, canvas.height - 520)),
  }
}

export function useDemoViewport() {
  const { setViewport } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const width = useStore((state) => state.width)
  const height = useStore((state) => state.height)

  useEffect(() => {
    if (nodesInitialized && width && height) setViewport(getDemoViewport(width, height))
  }, [height, nodesInitialized, setViewport, width])
}
