'use client'
import type { FC } from 'react'
import Iteration from './iteration'
import type { AgentIteration } from '@/models/log'

type TracingPanelProps = {
  list: AgentIteration[]
}

const TracingPanel: FC<TracingPanelProps> = ({ list }) => {
  return (
    <div className='bg-gray-50'>
      {list.map((iteration, index) => (
        <Iteration
          key={index}
          index={index + 1}
          isFinal={index + 1 === list.length}
          iterationInfo={iteration}
        />
      ))}
    </div>
  )
}

export default TracingPanel
