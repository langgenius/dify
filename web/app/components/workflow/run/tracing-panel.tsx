'use client'
import type { FC } from 'react'
import NodePanel from './node'
import type { NodeTracing } from '@/types/workflow'

type TracingPanelProps = {
  list: NodeTracing[]
  collapseState: boolean[]
  collapseHandle: (index: number) => void
}

const TracingPanel: FC<TracingPanelProps> = ({ list, collapseState, collapseHandle }) => {
  return (
    <div className='bg-gray-50 py-2'>
      {list.map((node, index) => (
        <NodePanel
          key={node.id}
          nodeInfo={node}
          collapsed={collapseState[index]}
          collapseHandle={() => collapseHandle(index)}
        />
      ))}
    </div>
  )
}

export default TracingPanel
