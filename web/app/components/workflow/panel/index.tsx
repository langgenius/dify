import type { FC } from 'react'
import { memo, useCallback, useEffect, useRef } from 'react'
import { useNodes } from 'reactflow'
import type { CommonNodeType } from '../types'
import { Panel as NodePanel } from '../nodes'
import { useStore } from '../store'
import EnvPanel from './env-panel'
import cn from '@/utils/classnames'

export type PanelProps = {
  components?: {
    left?: React.ReactNode
    right?: React.ReactNode
  }
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
}) => {
  const nodes = useNodes<CommonNodeType>()
  const selectedNode = nodes.find(node => node.data.selected)
  const showEnvPanel = useStore(s => s.showEnvPanel)
  const isRestoring = useStore(s => s.isRestoring)
  const showWorkflowVersionHistoryPanel = useStore(s => s.showWorkflowVersionHistoryPanel)

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
        {components?.right}
        {showEnvPanel && <EnvPanel />}
      </div>
    </div>
  )
}

export default memo(Panel)
