'use client'
import type { AgentIterationLogResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { FC } from 'react'
import Iteration from './iteration'

type TracingPanelProps = Readonly<{
  list: AgentIterationLogResponse[]
}>

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
