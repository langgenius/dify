import { useTranslation } from 'react-i18next'
import { generateNewNode } from '@/app/components/workflow/utils'
import {
  NODE_WIDTH_X_OFFSET,
  START_INITIAL_POSITION,
} from '@/app/components/workflow/constants'
import type { KnowledgeBaseNodeType } from '@/app/components/workflow/nodes/knowledge-base/types'
import knowledgeBaseDefault from '@/app/components/workflow/nodes/knowledge-base/default'
import ToolNodeDefault from '@/app/components/workflow/nodes/tool/default'

export const usePipelineTemplate = () => {
  const { t } = useTranslation()

  const { newNode: difyExtractorNode } = generateNewNode({
    id: 'difyExtractor',
    data: {
      ...ToolNodeDefault.defaultValue,
      type: ToolNodeDefault.metaData.type,
      title: '',
      provider_id: 'langgenius/dify_extractor/dify_extractor',
      tool_name: 'dify_extractor',
      _notInitialized: true,
    },
    position: {
      x: START_INITIAL_POSITION.x + NODE_WIDTH_X_OFFSET,
      y: START_INITIAL_POSITION.y,
    },
  } as any)

  const { newNode: generalChunkNode } = generateNewNode({
    id: 'generalChunk',
    data: {
      ...ToolNodeDefault.defaultValue,
      type: ToolNodeDefault.metaData.type,
      title: '',
      provider_id: 'langgenius/general_chunker/general_chunker',
      tool_name: 'general_chunker',
      _notInitialized: true,
    },
    position: {
      x: START_INITIAL_POSITION.x + NODE_WIDTH_X_OFFSET * 2,
      y: START_INITIAL_POSITION.y,
    },
  } as any)

  const { newNode: knowledgeBaseNode } = generateNewNode({
    id: 'knowledgeBase',
    data: {
      ...knowledgeBaseDefault.defaultValue as KnowledgeBaseNodeType,
      type: knowledgeBaseDefault.metaData.type,
      title: t(`workflow.blocks.${knowledgeBaseDefault.metaData.type}`),
    },
    position: {
      x: START_INITIAL_POSITION.x + NODE_WIDTH_X_OFFSET * 3,
      y: START_INITIAL_POSITION.y,
    },
  })

  const difyExtractorToGeneralChunkEdge = {
    id: `${difyExtractorNode.id}-${generalChunkNode.id}`,
    source: difyExtractorNode.id,
    sourceHandle: 'source',
    target: generalChunkNode.id,
    targetHandle: 'target',
  }

  const generalChunkToKnowledgeBaseEdge = {
    id: `${generalChunkNode.id}-${knowledgeBaseNode.id}`,
    source: generalChunkNode.id,
    sourceHandle: 'source',
    target: knowledgeBaseNode.id,
    targetHandle: 'target',
  }

  return {
    nodes: [difyExtractorNode, generalChunkNode, knowledgeBaseNode],
    edges: [difyExtractorToGeneralChunkEdge, generalChunkToKnowledgeBaseEdge],
  }
}
