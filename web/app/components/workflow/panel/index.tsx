import type { FC } from 'react'
import { memo } from 'react'
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

  return (
    <div
      tabIndex={-1}
      className={cn('absolute bottom-2 right-0 top-14 z-10 flex outline-none')}
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
      {
        components?.right
      }
      {
        showEnvPanel && (
          <EnvPanel />
        )
      }
    </div>
  )
}

export default memo(Panel)
