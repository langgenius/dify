import { generateNewNode } from '../utils'
import {
  NODE_WIDTH_X_OFFSET,
  START_INITIAL_POSITION,
} from '../constants'
import { useIsChatMode } from './use-workflow'
import { useNodesInitialData } from './use-nodes-data'

export const useWorkflowTemplate = () => {
  const isChatMode = useIsChatMode()
  const nodesInitialData = useNodesInitialData()

  const { newNode: startNode } = generateNewNode({
    data: nodesInitialData.start,
    position: START_INITIAL_POSITION,
  })

  if (isChatMode) {
    const { newNode: llmNode } = generateNewNode({
      id: 'llm',
      data: {
        ...nodesInitialData.llm,
        memory: {
          window: { enabled: false, size: 10 },
        },
        selected: true,
      },
      position: {
        x: START_INITIAL_POSITION.x + NODE_WIDTH_X_OFFSET,
        y: START_INITIAL_POSITION.y,
      },
    } as any)

    const { newNode: answerNode } = generateNewNode({
      id: 'answer',
      data: {
        ...nodesInitialData.answer,
        answer: `{{#${llmNode.id}.text#}}`,
      },
      position: {
        x: START_INITIAL_POSITION.x + NODE_WIDTH_X_OFFSET * 2,
        y: START_INITIAL_POSITION.y,
      },
    } as any)

    const startToLlmEdge = {
      id: `${startNode.id}-${llmNode.id}`,
      source: startNode.id,
      sourceHandle: 'source',
      target: llmNode.id,
      targetHandle: 'target',
    }

    const llmToAnswerEdge = {
      id: `${llmNode.id}-${answerNode.id}`,
      source: llmNode.id,
      sourceHandle: 'source',
      target: answerNode.id,
      targetHandle: 'target',
    }

    return {
      nodes: [startNode, llmNode, answerNode],
      edges: [startToLlmEdge, llmToAnswerEdge],
    }
  }
  else {
    return {
      nodes: [startNode],
      edges: [],
    }
  }
}
