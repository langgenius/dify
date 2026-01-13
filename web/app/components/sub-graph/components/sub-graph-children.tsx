import type { FC } from 'react'
import type { SubGraphConfig } from '../types'
import { memo, useMemo } from 'react'
import { useStore as useReactFlowStore } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import { Panel as NodePanel } from '@/app/components/workflow/nodes'
import { BlockEnum } from '@/app/components/workflow/types'

type SubGraphChildrenProps = {
  toolNodeId: string
  paramKey: string
  onConfigChange: (config: Partial<SubGraphConfig>) => void
}

const SubGraphChildren: FC<SubGraphChildrenProps> = ({
  toolNodeId: _toolNodeId,
  paramKey: _paramKey,
  onConfigChange: _onConfigChange,
}) => {
  const selectedNode = useReactFlowStore(useShallow((s) => {
    const nodes = s.getNodes()
    const currentNode = nodes.find(node => node.data.selected)

    if (currentNode?.data.type === BlockEnum.LLM) {
      return {
        id: currentNode.id,
        type: currentNode.type,
        data: currentNode.data,
      }
    }
    return null
  }))

  const nodePanel = useMemo(() => {
    if (!selectedNode)
      return null

    return (
      <NodePanel
        id={selectedNode.id}
        type={selectedNode.type}
        data={selectedNode.data}
      />
    )
  }, [selectedNode])

  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex">
      {nodePanel && (
        <div className="pointer-events-auto">
          {nodePanel}
        </div>
      )}
    </div>
  )
}

export default memo(SubGraphChildren)
