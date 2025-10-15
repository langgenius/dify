import type { FC } from 'react'
import { memo, useCallback, useEffect, useRef } from 'react'
import type { VersionHistoryPanelProps } from '@/app/components/workflow/panel/version-history-panel'
import { useShallow } from 'zustand/react/shallow'
import { useStore as useReactflow } from 'reactflow'
import { Panel as NodePanel } from '../nodes'
import { useStore } from '../store'
import EnvPanel from './env-panel'
import cn from '@/utils/classnames'
import dynamic from 'next/dynamic'

const VersionHistoryPanel = dynamic(() => import('@/app/components/workflow/panel/version-history-panel'), {
  ssr: false,
})

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
  if (entry.borderBoxSize?.length > 0)
    return entry.borderBoxSize[0].inlineSize

  if (entry.contentRect.width > 0)
    return entry.contentRect.width

  return element.getBoundingClientRect().width
}

const useResizeObserver = (
  callback: (width: number) => void,
  dependencies: React.DependencyList = [],
) => {
  const elementRef = useRef<HTMLDivElement>(null)

  const stableCallback = useCallback(callback, [callback])

  useEffect(() => {
    const element = elementRef.current
    if (!element) return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = getEntryWidth(entry, element)
        stableCallback(width)
      }
    })

    resizeObserver.observe(element)

    const initialWidth = element.getBoundingClientRect().width
    stableCallback(initialWidth)

    return () => {
      resizeObserver.disconnect()
    }
  }, [stableCallback, ...dependencies])
  return elementRef
}

const Panel: FC<PanelProps> = ({
  components,
  versionHistoryPanelProps,
}) => {
  const selectedNode = useReactflow(useShallow((s) => {
    const nodes = s.getNodes()
    const currentNode = nodes.find(node => node.data.selected)

    if (currentNode) {
      return {
        id: currentNode.id,
        type: currentNode.type,
        data: currentNode.data,
      }
    }
  }))
  const showEnvPanel = useStore(s => s.showEnvPanel)
  const isRestoring = useStore(s => s.isRestoring)
  const showWorkflowVersionHistoryPanel = useStore(s => s.showWorkflowVersionHistoryPanel)

  // widths used for adaptive layout
  const workflowCanvasWidth = useStore(s => s.workflowCanvasWidth)
  const previewPanelWidth = useStore(s => s.previewPanelWidth)
  const setPreviewPanelWidth = useStore(s => s.setPreviewPanelWidth)

  // When a node is selected and the NodePanel appears, if the current width
  // of preview/otherPanel is too large, it may result in the total width of
  // the two panels exceeding the workflowCanvasWidth, causing the NodePanel
  // to be pushed out. Here we check and, if necessary, reduce the previewPanelWidth
  // to "workflowCanvasWidth - 400 (minimum NodePanel width) - 400 (minimum canvas space)",
  // while still ensuring that previewPanelWidth ≥ 400.

  useEffect(() => {
    if (!selectedNode || !workflowCanvasWidth)
      return

    const reservedCanvasWidth = 400 // Reserve the minimum visible width for the canvas
    const minNodePanelWidth = 400
    const maxAllowed = Math.max(workflowCanvasWidth - reservedCanvasWidth - minNodePanelWidth, 400)

    if (previewPanelWidth > maxAllowed)
      setPreviewPanelWidth(maxAllowed)
  }, [selectedNode, workflowCanvasWidth, previewPanelWidth, setPreviewPanelWidth])

  const setRightPanelWidth = useStore(s => s.setRightPanelWidth)
  const setOtherPanelWidth = useStore(s => s.setOtherPanelWidth)

  const rightPanelRef = useResizeObserver(
    setRightPanelWidth,
    [setRightPanelWidth, selectedNode, showEnvPanel, showWorkflowVersionHistoryPanel],
  )

  const otherPanelRef = useResizeObserver(
    setOtherPanelWidth,
    [setOtherPanelWidth, showEnvPanel, showWorkflowVersionHistoryPanel],
  )

  return (
    <div
      ref={rightPanelRef}
      tabIndex={-1}
      className={cn('absolute bottom-1 right-0 top-14 z-10 flex outline-none')}
      key={`${isRestoring}`}
    >
      {components?.left}
      {!!selectedNode && <NodePanel {...selectedNode} />}
      <div
        className="relative"
        ref={otherPanelRef}
      >
        {
          components?.right
        }
        {
          showWorkflowVersionHistoryPanel && (
            <VersionHistoryPanel {...versionHistoryPanelProps} />
          )
        }
        {
          showEnvPanel && (
            <EnvPanel />
          )
        }
      </div>
    </div>
  )
}

export default memo(Panel)
