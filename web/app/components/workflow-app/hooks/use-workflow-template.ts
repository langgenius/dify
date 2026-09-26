import type { StartNodeType } from '@/app/components/workflow/nodes/start/types'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { NODE_WIDTH_X_OFFSET, START_INITIAL_POSITION } from '@/app/components/workflow/constants'
import answerDefault from '@/app/components/workflow/nodes/answer/default'
import llmDefault from '@/app/components/workflow/nodes/llm/default'
import startPlaceholderDefault from '@/app/components/workflow/nodes/start-placeholder/default'
import startDefault from '@/app/components/workflow/nodes/start/default'
import { useStore } from '@/app/components/workflow/store'
import { generateNewNode } from '@/app/components/workflow/utils'
import { consoleQuery } from '@/service/console'
import { AppModeEnum } from '@/types/app'

export const useWorkflowTemplate = () => {
  const appId = useStore((state) => state.appId)
  const { data: appDetail } = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: appId ? { params: { app_id: appId } } : skipToken,
    }),
  )
  const { t } = useTranslation(['workflow'])

  const createStartNode = () => {
    const { newNode: startNode } = generateNewNode({
      data: {
        ...(startDefault.defaultValue as StartNodeType),
        type: startDefault.metaData.type,
        title: t(($) => $[`blocks.${startDefault.metaData.type}`], { ns: 'workflow' }),
      },
      position: START_INITIAL_POSITION,
    })

    return startNode
  }

  if (appDetail?.mode === AppModeEnum.ADVANCED_CHAT) {
    const startNode = createStartNode()

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
        title: t(($) => $[`blocks.${llmDefault.metaData.type}`], { ns: 'workflow' }),
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
        title: t(($) => $[`blocks.${answerDefault.metaData.type}`], { ns: 'workflow' }),
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
  if (appDetail?.mode === AppModeEnum.WORKFLOW) {
    const { newNode: startPlaceholderNode } = generateNewNode({
      data: {
        ...startPlaceholderDefault.defaultValue,
        selected: true,
        type: startPlaceholderDefault.metaData.type,
        title: t(($) => $[`blocks.${startPlaceholderDefault.metaData.type}`], { ns: 'workflow' }),
        desc: '',
      },
      position: START_INITIAL_POSITION,
    })

    return {
      nodes: [startPlaceholderNode],
      edges: [],
    }
  }

  return {
    nodes: [createStartNode()],
    edges: [],
  }
}
