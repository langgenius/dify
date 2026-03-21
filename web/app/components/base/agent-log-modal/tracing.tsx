'use client'
import type { FC } from 'react'
import type { AgentIteration } from '@/models/log'
import Iteration from './iteration'

type TracingPanelProps = {
  list: AgentIteration[]
}

const TracingPanel: FC<TracingPanelProps> = ({ list }) => {
  return (
    <div className="bg-background-section">
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
