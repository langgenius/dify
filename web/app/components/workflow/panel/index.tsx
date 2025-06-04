import type { FC } from 'react'
import { memo } from 'react'
import { useNodes } from 'reactflow'
import type { VersionHistoryPanelProps } from '@/app/components/workflow/panel/version-history-panel'
import VersionHistoryPanel from '@/app/components/workflow/panel/version-history-panel'
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
  versionHistoryPanelProps?: VersionHistoryPanelProps
}
const Panel: FC<PanelProps> = ({
  components,
  versionHistoryPanelProps,
}) => {
  const nodes = useNodes<CommonNodeType>()
  const selectedNode = nodes.find(node => node.data.selected)
  const showEnvPanel = useStore(s => s.showEnvPanel)
  const isRestoring = useStore(s => s.isRestoring)
  const showWorkflowVersionHistoryPanel = useStore(s => s.showWorkflowVersionHistoryPanel)

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
  )
}

export default memo(Panel)
