'use client'
import type { FC } from 'react'
import type { SubGraphCanvasProps } from './types'
import { memo } from 'react'
import SubGraph from '@/app/components/sub-graph'

const SubGraphCanvas: FC<SubGraphCanvasProps> = ({
  toolNodeId,
  paramKey,
  sourceVariable,
  agentNodeId,
  agentName,
  extractorNode,
  toolParamValue,
  onSave,
}) => {
  return (
    <div className="h-full w-full">
      <SubGraph
        toolNodeId={toolNodeId}
        paramKey={paramKey}
        sourceVariable={sourceVariable}
        agentNodeId={agentNodeId}
        agentName={agentName}
        extractorNode={extractorNode}
        toolParamValue={toolParamValue}
        onSave={onSave}
      />
    </div>
  )
}

export default memo(SubGraphCanvas)
