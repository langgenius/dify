import { useDirection } from '@langgenius/dify-ui/direction-provider'
import { useEffect } from 'react'
import { useNodesInitialized, useReactFlow, useStore } from 'reactflow'
import { demoGraphBounds } from './demo-graph'
import { demoCommentPosition } from './playback-script'

const toolbarInset = 56
const headerInset = 64
const threadColumn = 448
const markerColumn = 64

export function getDemoViewport(width: number, height: number, direction: 'ltr' | 'rtl' = 'ltr') {
  // The comment's point is the right-most content; its marker, and the thread when it fits,
  // sit beyond it at screen size.
  const contentWidth = demoCommentPosition.x - demoGraphBounds.x
  const left = direction === 'rtl' ? 16 : toolbarInset
  const right = direction === 'rtl' ? toolbarInset : 16
  const besideThread = width - left - threadColumn - right
  const availableWidth =
    besideThread / contentWidth >= 0.4 ? besideThread : width - left - markerColumn - right
  const availableHeight = height - headerInset - 64
  const zoom = Math.max(
    0.25,
    Math.min(1, availableWidth / contentWidth, availableHeight / demoGraphBounds.height),
  )
  return {
    zoom,
    x: left + (availableWidth - contentWidth * zoom) / 2 - demoGraphBounds.x * zoom,
    y:
      headerInset +
      (availableHeight - demoGraphBounds.height * zoom) / 2 -
      demoGraphBounds.y * zoom,
  }
}

/**
 * Frames the canvas once its nodes are measured and again whenever it resizes. The nodes and the
 * React Flow attribution stay out of the accessibility tree and the tab order.
 */
export function DemoViewportFit() {
  const { setViewport } = useReactFlow()
  const direction = useDirection()
  const flowElement = useStore((state) => state.domNode)
  const nodesInitialized = useNodesInitialized()
  const width = useStore((state) => state.width)
  const height = useStore((state) => state.height)

  useEffect(() => {
    if (nodesInitialized && width && height) setViewport(getDemoViewport(width, height, direction))
  }, [direction, height, nodesInitialized, setViewport, width])

  useEffect(() => {
    flowElement
      ?.querySelector(':scope > .react-flow__renderer')
      ?.setAttribute('aria-hidden', 'true')
    const attribution = flowElement?.querySelector(':scope > .react-flow__attribution')
    attribution?.setAttribute('inert', '')
    attribution?.setAttribute('aria-hidden', 'true')
  }, [flowElement])

  return null
}
