import { useEffect } from 'react'
import { useNodesInitialized, useReactFlow, useStore } from 'reactflow'
import { demoGraphBounds } from './demo-graph'

const toolbarInset = 56
const headerInset = 64
const threadColumn = 448
const markerWidth = 47
const markerHeight = 27

export function getDemoViewport(width: number, height: number) {
  const besideThread = width - toolbarInset - threadColumn - 16
  const availableWidth =
    besideThread / demoGraphBounds.width >= 0.4 ? besideThread : width - toolbarInset - 64
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
  const right = pin.x + markerWidth + 16
  const left = pin.x - 16 - 360
  const top = Math.max(headerInset, Math.min(pin.y - 28, canvas.height - 520))
  if (right + 360 <= canvas.width - 8) return { left: right, top }
  if (left >= 8) return { left, top }
  return { left: Math.max(8, Math.min(pin.x, canvas.width - 368)), top: pin.y + markerHeight + 8 }
}

export function useDemoViewport() {
  const { setViewport } = useReactFlow()
  const flowElement = useStore((state) => state.domNode)
  const nodesInitialized = useNodesInitialized()
  const width = useStore((state) => state.width)
  const height = useStore((state) => state.height)

  useEffect(() => {
    if (nodesInitialized && width && height) setViewport(getDemoViewport(width, height))
  }, [height, nodesInitialized, setViewport, width])

  useEffect(() => {
    const decorative = flowElement?.querySelectorAll(
      ':scope > .react-flow__renderer, :scope > .react-flow__attribution',
    )
    decorative?.forEach((element) => {
      element.setAttribute('inert', '')
      element.setAttribute('aria-hidden', 'true')
    })
  }, [flowElement])
}
