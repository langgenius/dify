import type { FC } from 'react'
import type { VersionHistoryPanelProps } from '@/app/components/workflow/panel/version-history-panel'
import dynamic from 'next/dynamic'
import { memo, useCallback, useEffect } from 'react'
import { useStore as useReactflow } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import NodePanel from '../nodes/panel'
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

const useResizeObserver = (callback: (width: number) => void) =>
  useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return

      let lastWidth: number | undefined
      let animationFrame: number | undefined

      const updateWidth = (width: number) => {
        if (lastWidth === width) return

        lastWidth = width
        if (animationFrame !== undefined) cancelAnimationFrame(animationFrame)

        animationFrame = requestAnimationFrame(() => {
          animationFrame = undefined
          callback(width)
        })
      }

      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) updateWidth(getEntryWidth(entry, element))
      })

      resizeObserver.observe(element)
      updateWidth(element.getBoundingClientRect().width)

      return () => {
        if (animationFrame !== undefined) cancelAnimationFrame(animationFrame)
        resizeObserver.disconnect()
      }
    },
    [callback],
  )

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
      className="pointer-events-auto relative isolate flex outline-hidden"
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
