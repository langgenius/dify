'use client'
import type { FC } from 'react'
import NodePanel from './node'
import type { NodeTracing } from '@/types/workflow'

type TracingPanelProps = {
  list: NodeTracing[]
}

const TracingPanel: FC<TracingPanelProps> = ({ list }) => {
  return (
    <div className='bg-gray-50 py-2'>
      {list.map(node => (
        <NodePanel
          key={node.id}
          nodeInfo={node}
        />
      ))}
    </div>
  )
}

export default TracingPanel
