import { useTranslation } from 'react-i18next'
import { generateNewNode } from '@/app/components/workflow/utils'
import {
  START_INITIAL_POSITION,
} from '@/app/components/workflow/constants'
import type { KnowledgeBaseNodeType } from '@/app/components/workflow/nodes/knowledge-base/types'
import knowledgeBaseDefault from '@/app/components/workflow/nodes/knowledge-base/default'

export const usePipelineTemplate = () => {
  const { t } = useTranslation()

  const { newNode: knowledgeBaseNode } = generateNewNode({
    data: {
      ...knowledgeBaseDefault.defaultValue as KnowledgeBaseNodeType,
      type: knowledgeBaseDefault.metaData.type,
      title: t(`workflow.blocks.${knowledgeBaseDefault.metaData.type}`),
    },
    position: START_INITIAL_POSITION,
  })

  return {
    nodes: [knowledgeBaseNode],
    edges: [],
  }
}
