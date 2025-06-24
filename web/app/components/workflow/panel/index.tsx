import type { FC } from 'react'
import { memo, useEffect, useRef } from 'react'
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
const Panel: FC<PanelProps> = ({
  components,
}) => {
  const nodes = useNodes<CommonNodeType>()
  const selectedNode = nodes.find(node => node.data.selected)
  const showEnvPanel = useStore(s => s.showEnvPanel)
  const isRestoring = useStore(s => s.isRestoring)

  const rightPanelRef = useRef<HTMLDivElement>(null)
  const setRightPanelWidth = useStore(s => s.setRightPanelWidth)

  // get right panel width
  useEffect(() => {
    if (rightPanelRef.current) {
      const resizeRightPanelObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { inlineSize } = entry.borderBoxSize[0]
          setRightPanelWidth(inlineSize)
        }
      })
      resizeRightPanelObserver.observe(rightPanelRef.current)
      return () => {
        resizeRightPanelObserver.disconnect()
      }
    }
  }, [setRightPanelWidth])

  const otherPanelRef = useRef<HTMLDivElement>(null)
  const setOtherPanelWidth = useStore(s => s.setOtherPanelWidth)

  // get other panel width
  useEffect(() => {
    if (otherPanelRef.current) {
      const resizeOtherPanelObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { inlineSize } = entry.borderBoxSize[0]
          setOtherPanelWidth(inlineSize)
        }
      })
      resizeOtherPanelObserver.observe(otherPanelRef.current)
      return () => {
        resizeOtherPanelObserver.disconnect()
      }
    }
  }, [setOtherPanelWidth])
  return (
    <div
      ref={rightPanelRef}
      tabIndex={-1}
      className={cn('absolute bottom-1 right-0 top-14 z-10 flex outline-none')}
      key={`${isRestoring}`}
    >
      {
        components?.left
      }
      {
        !!selectedNode && (
          <NodePanel {...selectedNode!} />
        )
      }
      <div
        className='relative'
        ref={otherPanelRef}
      >
        {
          components?.right
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
