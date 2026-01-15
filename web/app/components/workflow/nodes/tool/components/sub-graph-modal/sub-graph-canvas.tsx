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
  configsMap,
  mentionConfig,
  onMentionConfigChange,
  extractorNode,
  toolParamValue,
  parentAvailableNodes,
  parentAvailableVars,
  onSave,
  onSyncWorkflowDraft,
}) => {
  return (
    <div className="h-full w-full">
      <SubGraph
        toolNodeId={toolNodeId}
        paramKey={paramKey}
        sourceVariable={sourceVariable}
        agentNodeId={agentNodeId}
        agentName={agentName}
        configsMap={configsMap}
        mentionConfig={mentionConfig}
        onMentionConfigChange={onMentionConfigChange}
        extractorNode={extractorNode}
        toolParamValue={toolParamValue}
        parentAvailableNodes={parentAvailableNodes}
        parentAvailableVars={parentAvailableVars}
        onSave={onSave}
        onSyncWorkflowDraft={onSyncWorkflowDraft}
      />
    </div>
  )
}

export default memo(SubGraphCanvas)
