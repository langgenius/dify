import { useTranslation } from 'react-i18next'
import { generateNewNode } from '@/app/components/workflow/utils'
import {
  NODE_WIDTH_X_OFFSET,
  START_INITIAL_POSITION,
} from '@/app/components/workflow/constants'
import { useIsChatMode } from './use-is-chat-mode'
import type { StartNodeType } from '@/app/components/workflow/nodes/start/types'
import startDefault from '@/app/components/workflow/nodes/start/default'
import llmDefault from '@/app/components/workflow/nodes/llm/default'
import answerDefault from '@/app/components/workflow/nodes/answer/default'

export const useWorkflowTemplate = () => {
  const isChatMode = useIsChatMode()
  const { t } = useTranslation()

  const { newNode: startNode } = generateNewNode({
    data: {
      ...startDefault.defaultValue as StartNodeType,
      type: startDefault.metaData.type,
      title: t(`workflow.blocks.${startDefault.metaData.type}`),
    },
    position: START_INITIAL_POSITION,
  })

  if (isChatMode) {
    const { newNode: llmNode } = generateNewNode({
      id: 'llm',
      data: {
        ...llmDefault.defaultValue,
        memory: {
          window: { enabled: false, size: 10 },
          query_prompt_template: '{{#sys.query#}}\n\n{{#sys.files#}}',
        },
        selected: true,
        type: llmDefault.metaData.type,
        title: t(`workflow.blocks.${llmDefault.metaData.type}`),
      },
      position: {
        x: START_INITIAL_POSITION.x + NODE_WIDTH_X_OFFSET,
        y: START_INITIAL_POSITION.y,
      },
    } as any)

    const { newNode: answerNode } = generateNewNode({
      id: 'answer',
      data: {
        ...answerDefault.defaultValue,
        answer: `{{#${llmNode.id}.text#}}`,
        type: answerDefault.metaData.type,
        title: t(`workflow.blocks.${answerDefault.metaData.type}`),
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
