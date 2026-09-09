import type { FC } from 'react'
import type { VersionHistoryPanelProps } from '@/app/components/workflow/panel/version-history-panel'
import { cn } from '@langgenius/dify-ui/cn'
import { memo, useEffect, useRef } from 'react'
import { useStore as useReactflow } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import dynamic from '@/next/dynamic'
import { Panel as NodePanel } from '../nodes'
import { useStore } from '../store'
import EnvPanel from './env-panel'
import { getPreviewPanelMaxWidth } from './panel-width'

const VersionHistoryPanel = dynamic(
  () => import('@/app/components/workflow/panel/version-history-panel'),
  {
    ssr: false,
  },
)

export type PanelProps = {
  components?: {
    left?: React.ReactNode
    right?: React.ReactNode
  }
  versionHistoryPanelProps?: VersionHistoryPanelProps
}

/**
 * Reference MDN standard implementation：https://developer.mozilla.org/zh-CN/docs/Web/API/ResizeObserverEntry/borderBoxSize
 */
const getEntryWidth = (entry: ResizeObserverEntry, element: HTMLElement): number => {
  if (entry.borderBoxSize?.length > 0) return entry.borderBoxSize[0]!.inlineSize

  if (entry.contentRect.width > 0) return entry.contentRect.width

  return element.getBoundingClientRect().width
}

const useResizeObserver = (callback: (width: number) => void) => {
  const elementRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef<number | undefined>(undefined)
  const animationFrameRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const element = elementRef.current
    if (!element) return

    widthRef.current = undefined

    const updateWidth = (width: number) => {
      if (widthRef.current === width) return

      widthRef.current = width
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)

      animationFrameRef.current = requestAnimationFrame(() => {
        animationFrameRef.current = undefined
        callback(width)
      })
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) updateWidth(getEntryWidth(entry, element))
    })

    resizeObserver.observe(element)

    const initialWidth = element.getBoundingClientRect().width
    updateWidth(initialWidth)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = undefined
      }
      resizeObserver.disconnect()
    }
  }, [callback])
  return elementRef
}

const Panel: FC<PanelProps> = ({ components, versionHistoryPanelProps }) => {
  const selectedNode = useReactflow(
    useShallow((s) => {
      const nodes = s.getNodes()
      const currentNode = nodes.find((node) => node.data.selected)

      if (currentNode) {
        return {
          id: currentNode.id,
          type: currentNode.type,
          data: currentNode.data,
        }
      }
    }),
  )
  const showEnvPanel = useStore((s) => s.showEnvPanel)
  const isRestoring = useStore((s) => s.isRestoring)
  const showWorkflowVersionHistoryPanel = useStore((s) => s.showWorkflowVersionHistoryPanel)

  // widths used for adaptive layout
  const workflowCanvasWidth = useStore((s) => s.workflowCanvasWidth)
  const previewPanelWidth = useStore((s) => s.previewPanelWidth)
  const setPreviewPanelWidth = useStore((s) => s.setPreviewPanelWidth)

  useEffect(() => {
    if (!workflowCanvasWidth) return

    const maxAllowed = getPreviewPanelMaxWidth(workflowCanvasWidth, !!selectedNode)

    if (previewPanelWidth > maxAllowed) setPreviewPanelWidth(maxAllowed)
  }, [selectedNode, workflowCanvasWidth, previewPanelWidth, setPreviewPanelWidth])

  const setRightPanelWidth = useStore((s) => s.setRightPanelWidth)
  const setOtherPanelWidth = useStore((s) => s.setOtherPanelWidth)

  const rightPanelRef = useResizeObserver(setRightPanelWidth)

  const otherPanelRef = useResizeObserver(setOtherPanelWidth)

  return (
    <div
      ref={rightPanelRef}
      data-workflow-right-panel
      tabIndex={-1}
      className={cn('absolute top-14 right-0 bottom-1 z-10 flex outline-hidden')}
      key={`${isRestoring}`}
    >
      {components?.left}
      {!!selectedNode && <NodePanel {...selectedNode} />}
      <div className="relative" ref={otherPanelRef}>
        {components?.right}
        {showWorkflowVersionHistoryPanel && versionHistoryPanelProps && (
          <VersionHistoryPanel {...versionHistoryPanelProps} />
        )}
        {showEnvPanel && <EnvPanel />}
      </div>
    </div>
  )
}

export default memo(Panel)
