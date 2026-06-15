import type { KnowledgeBaseNodeType } from '@/app/components/workflow/nodes/knowledge-base/types'
import { useTranslation } from 'react-i18next'
import {
  START_INITIAL_POSITION,
} from '@/app/components/workflow/constants'
import knowledgeBaseDefault from '@/app/components/workflow/nodes/knowledge-base/default'
import { generateNewNode } from '@/app/components/workflow/utils'

export const usePipelineTemplate = () => {
  const { t } = useTranslation()

  const { newNode: knowledgeBaseNode } = generateNewNode({
    id: 'knowledgeBase',
    data: {
      ...knowledgeBaseDefault.defaultValue as KnowledgeBaseNodeType,
      type: knowledgeBaseDefault.metaData.type,
      title: t(`blocks.${knowledgeBaseDefault.metaData.type}`, { ns: 'workflow' }),
      selected: true,
    },
    position: {
      x: START_INITIAL_POSITION.x + 500,
      y: START_INITIAL_POSITION.y,
    },
  })

  return {
    nodes: [knowledgeBaseNode],
    edges: [],
  }
}
