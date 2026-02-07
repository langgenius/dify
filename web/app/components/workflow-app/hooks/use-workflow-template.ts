import type { StartNodeType } from '@/app/components/workflow/nodes/start/types'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import {
  NODE_WIDTH_X_OFFSET,
  START_INITIAL_POSITION,
} from '@/app/components/workflow/constants'
import answerDefault from '@/app/components/workflow/nodes/answer/default'
import llmDefault from '@/app/components/workflow/nodes/llm/default'
import startDefault from '@/app/components/workflow/nodes/start/default'
import { BlockEnum } from '@/app/components/workflow/types'
import { generateNewNode } from '@/app/components/workflow/utils'
import { STORAGE_KEYS } from '@/config/storage-keys'
import { storage } from '@/utils/storage'
import { useIsChatMode } from './use-is-chat-mode'

export const useWorkflowTemplate = () => {
  const isChatMode = useIsChatMode()
  const appDetail = useAppStore(s => s.appDetail)
  const isSandboxedByType = appDetail?.runtime_type === 'sandboxed'
  const isSandboxedBySelection = appDetail?.id
    ? storage.getBoolean(`${STORAGE_KEYS.LOCAL.WORKFLOW.SANDBOX_RUNTIME_PREFIX}${appDetail.id}`) === true
    : false
  const isSandboxed = isSandboxedByType || isSandboxedBySelection
  const { t } = useTranslation()

  const { newNode: startNode } = generateNewNode({
    data: {
      ...startDefault.defaultValue as StartNodeType,
      type: startDefault.metaData.type,
      title: t(`blocks.${startDefault.metaData.type}`, { ns: 'workflow' }),
    },
    position: START_INITIAL_POSITION,
  })

  if (isChatMode) {
    const llmTitle = isSandboxed
      ? t('blocks.agent', { ns: 'workflow' })
      : t(`blocks.${llmDefault.metaData.type}` as const, { ns: 'workflow' })

    const { newNode: llmNode } = generateNewNode({
      id: 'llm',
      data: {
        ...llmDefault.defaultValue,
        memory: {
          window: { enabled: false, size: 10 },
          query_prompt_template: '{{#sys.query#}}\n\n{{#sys.files#}}',
        },
        selected: true,
        _iconTypeOverride: isSandboxed ? BlockEnum.Agent : undefined,
        type: llmDefault.metaData.type,
        title: llmTitle,
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
        answer: `{{#${llmNode.id}.generation#}}`,
        type: answerDefault.metaData.type,
        title: t(`blocks.${answerDefault.metaData.type}`, { ns: 'workflow' }),
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
