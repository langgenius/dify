import { useEffect } from 'react'
import { useNodesInitialized, useReactFlow, useStore } from 'reactflow'
import { demoGraphBounds } from './demo-graph'
import { demoCommentPosition } from './playback-script'

const toolbarInset = 56
const headerInset = 64
const threadColumn = 448
const markerColumn = 64

export function getDemoViewport(width: number, height: number) {
  // The comment's point is the right-most content; its marker, and the thread when it fits,
  // sit beyond it at screen size.
  const contentWidth = demoCommentPosition.x - demoGraphBounds.x
  const besideThread = width - toolbarInset - threadColumn - 16
  const availableWidth =
    besideThread / contentWidth >= 0.4 ? besideThread : width - toolbarInset - markerColumn - 16
  const availableHeight = height - headerInset - 64
  const zoom = Math.max(
    0.25,
    Math.min(1, availableWidth / contentWidth, availableHeight / demoGraphBounds.height),
  )
  return {
    zoom,
    x: toolbarInset + (availableWidth - contentWidth * zoom) / 2 - demoGraphBounds.x * zoom,
    y:
      headerInset +
      (availableHeight - demoGraphBounds.height * zoom) / 2 -
      demoGraphBounds.y * zoom,
  }
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
