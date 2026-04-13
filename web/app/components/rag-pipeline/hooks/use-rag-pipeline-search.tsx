'use client'

import type { KnowledgeRetrievalNodeType } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type { ToolNodeType } from '@/app/components/workflow/nodes/tool/types'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { useCallback, useEffect, useMemo } from 'react'
import { ragPipelineNodesAction } from '@/app/components/goto-anything/actions/rag-pipeline-nodes'
import BlockIcon from '@/app/components/workflow/block-icon'
import { useNodesInteractions } from '@/app/components/workflow/hooks/use-nodes-interactions'
import { useGetToolIcon } from '@/app/components/workflow/hooks/use-tool-icon'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import { BlockEnum } from '@/app/components/workflow/types'
import { setupNodeSelectionListener } from '@/app/components/workflow/utils/node-navigation'

/**
 * Hook to register RAG pipeline nodes search functionality
 */
export const useRagPipelineSearch = () => {
  const nodes = useNodes()
  const { handleNodeSelect } = useNodesInteractions()
  const getToolIcon = useGetToolIcon()

  // Process nodes to create searchable data structure
  const searchableNodes = useMemo(() => {
    return nodes.map((node) => {
      const nodeData = node.data as CommonNodeType
      const title = nodeData.title || nodeData.type || 'Untitled Node'
      let desc = nodeData.desc || ''

      // Keep the original node title for consistency with workflow display
      // Only enhance description for better search context
      if (nodeData.type === BlockEnum.Tool) {
        const toolData = nodeData as ToolNodeType
        desc = toolData.tool_description || toolData.tool_label || desc
      }

      if (nodeData.type === BlockEnum.LLM) {
        const llmData = nodeData as LLMNodeType
        if (llmData.model?.provider && llmData.model?.name)
          desc = `${llmData.model.name} (${llmData.model.provider}) - ${llmData.model.mode || desc}`
      }

      if (nodeData.type === BlockEnum.KnowledgeRetrieval) {
        const knowledgeData = nodeData as KnowledgeRetrievalNodeType
        if (knowledgeData.dataset_ids?.length)
          desc = `Knowledge Retrieval with ${knowledgeData.dataset_ids.length} datasets - ${desc}`
      }

      return {
        id: node.id,
        title,
        desc,
        type: nodeData.type,
        blockType: nodeData.type,
        nodeData,
        toolIcon: getToolIcon(nodeData),
        modelInfo: nodeData.type === BlockEnum.LLM
          ? {
              provider: (nodeData as LLMNodeType).model?.provider,
              name: (nodeData as LLMNodeType).model?.name,
              mode: (nodeData as LLMNodeType).model?.mode,
            }
          : {
              provider: undefined,
              name: undefined,
              mode: undefined,
            },
      }
    })
  }, [nodes, getToolIcon])

  // Calculate relevance score for search results
  const calculateScore = useCallback((node: {
    title: string
    type: string
    desc: string
    modelInfo: { provider?: string, name?: string, mode?: string }
  }, searchTerm: string): number => {
    if (!searchTerm)
      return 1

    let score = 0
    const term = searchTerm.toLowerCase()

    // Title match (highest priority)
    if (node.title.toLowerCase().includes(term))
      score += 10

    // Type match
    if (node.type.toLowerCase().includes(term))
      score += 8

    // Description match
    if (node.desc.toLowerCase().includes(term))
      score += 5

    // Model info matches (for LLM nodes)
    if (node.modelInfo.provider?.toLowerCase().includes(term))
      score += 6
    if (node.modelInfo.name?.toLowerCase().includes(term))
      score += 6
    if (node.modelInfo.mode?.toLowerCase().includes(term))
      score += 4

    return score
  }, [])

  // Create search function for RAG pipeline nodes
  const searchRagPipelineNodes = useCallback((query: string) => {
    if (!searchableNodes.length)
      return []

    const searchTerm = query.toLowerCase().trim()

    const results = searchableNodes
      .map((node) => {
        const score = calculateScore(node, searchTerm)

        return score > 0
          ? {
              id: node.id,
              title: node.title,
              description: node.desc || node.type,
              type: 'workflow-node' as const,
              path: `#${node.id}`,
              icon: (
                <BlockIcon
                  type={node.blockType}
                  className="shrink-0"
                  size="sm"
                  toolIcon={node.toolIcon}
                />
              ),
              metadata: {
                nodeId: node.id,
                nodeData: node.nodeData,
              },
              data: node.nodeData,
              score,
            }
          : null
      })
      .filter((node): node is NonNullable<typeof node> => node !== null)
      .sort((a, b) => {
        // If no search term, sort alphabetically
        if (!searchTerm)
          return a.title.localeCompare(b.title)
        // Sort by relevance score (higher score first)
        return (b.score || 0) - (a.score || 0)
      })

    return results
  }, [searchableNodes, calculateScore])

  // Directly set the search function on the action object
  useEffect(() => {
    if (searchableNodes.length > 0) {
      // Set the search function directly on the action
      ragPipelineNodesAction.searchFn = searchRagPipelineNodes
    }

    return () => {
      // Clean up when component unmounts
      ragPipelineNodesAction.searchFn = undefined
    }
  }, [searchableNodes, searchRagPipelineNodes])

  // Set up node selection event listener using the utility function
  useEffect(() => {
    return setupNodeSelectionListener(handleNodeSelect)
  }, [handleNodeSelect])

  return null
}
