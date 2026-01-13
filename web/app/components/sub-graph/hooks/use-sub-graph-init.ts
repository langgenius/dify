import type { SubGraphProps } from '../types'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type { StartNodeType } from '@/app/components/workflow/nodes/start/types'
import type { Edge, Node, ValueSelector } from '@/app/components/workflow/types'
import { useMemo } from 'react'
import { BlockEnum, PromptRole } from '@/app/components/workflow/types'
import { AppModeEnum } from '@/types/app'

export const SUBGRAPH_SOURCE_NODE_ID = 'subgraph-source'
export const SUBGRAPH_LLM_NODE_ID = 'subgraph-llm'

export const getSubGraphInitialNodes = (
  sourceVariable: ValueSelector,
  agentName: string,
): Node[] => {
  const sourceVarName = sourceVariable.length > 1
    ? sourceVariable.slice(1).join('.')
    : 'output'

  const startNode: Node<StartNodeType> = {
    id: SUBGRAPH_SOURCE_NODE_ID,
    type: 'custom',
    position: { x: 100, y: 150 },
    data: {
      type: BlockEnum.Start,
      title: `${agentName}: ${sourceVarName}`,
      desc: 'Source variable from agent',
      _connectedSourceHandleIds: ['source'],
      _connectedTargetHandleIds: [],
      variables: [],
    },
  }

  const llmNode: Node<LLMNodeType> = {
    id: SUBGRAPH_LLM_NODE_ID,
    type: 'custom',
    position: { x: 450, y: 150 },
    data: {
      type: BlockEnum.LLM,
      title: 'LLM',
      desc: 'Transform the output',
      _connectedSourceHandleIds: [],
      _connectedTargetHandleIds: ['target'],
      model: {
        provider: '',
        name: '',
        mode: AppModeEnum.CHAT,
        completion_params: {
          temperature: 0.7,
        },
      },
      prompt_template: [{
        role: PromptRole.system,
        text: '',
      }],
      context: {
        enabled: false,
        variable_selector: [],
      },
      vision: {
        enabled: false,
      },
    },
  }

  return [startNode, llmNode]
}

export const getSubGraphInitialEdges = (): Edge[] => {
  return [
    {
      id: `${SUBGRAPH_SOURCE_NODE_ID}-${SUBGRAPH_LLM_NODE_ID}`,
      source: SUBGRAPH_SOURCE_NODE_ID,
      sourceHandle: 'source',
      target: SUBGRAPH_LLM_NODE_ID,
      targetHandle: 'target',
      type: 'custom',
      data: {
        sourceType: BlockEnum.Start,
        targetType: BlockEnum.LLM,
      },
    },
  ]
}

export const useSubGraphInit = (props: SubGraphProps) => {
  const { sourceVariable, agentName } = props

  const initialNodes = useMemo((): Node[] => {
    return getSubGraphInitialNodes(sourceVariable, agentName)
  }, [sourceVariable, agentName])

  const initialEdges = useMemo((): Edge[] => {
    return getSubGraphInitialEdges()
  }, [])

  return {
    initialNodes,
    initialEdges,
  }
}
