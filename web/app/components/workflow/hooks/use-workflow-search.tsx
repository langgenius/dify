'use client'

import type { LLMNodeType } from '../nodes/llm/types'
import type { CommonNodeType } from '../types'
import type { Emoji } from '@/app/components/tools/types'
import { useCallback, useEffect, useMemo } from 'react'
import { useNodes } from 'reactflow'
import { workflowNodesAction } from '@/app/components/goto-anything/actions/workflow-nodes'
import { CollectionType } from '@/app/components/tools/types'
import BlockIcon from '@/app/components/workflow/block-icon'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import { canFindTool } from '@/utils'
import { BlockEnum } from '../types'
import { setupNodeSelectionListener } from '../utils/node-navigation'
import { useNodesInteractions } from './use-nodes-interactions'

/**
 * Hook to register workflow nodes search functionality
 */
export const useWorkflowSearch = () => {
  const nodes = useNodes()
  const { handleNodeSelect } = useNodesInteractions()

  // Filter and process nodes for search
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()

  // Extract tool icon logic - clean separation of concerns
  const getToolIcon = useCallback((nodeData: CommonNodeType): string | Emoji | undefined => {
    if (nodeData?.type !== BlockEnum.Tool)
      return undefined

    const toolCollections: Record<string, any[]> = {
      [CollectionType.builtIn]: buildInTools || [],
      [CollectionType.custom]: customTools || [],
      [CollectionType.mcp]: mcpTools || [],
    }

    const targetTools = (nodeData.provider_type && toolCollections[nodeData.provider_type]) || workflowTools
    return targetTools?.find((tool: any) => canFindTool(tool.id, nodeData.provider_id))?.icon
  }, [buildInTools, customTools, workflowTools, mcpTools])

  // Extract model info logic - clean extraction
  const getModelInfo = useCallback((nodeData: CommonNodeType) => {
    if (nodeData?.type !== BlockEnum.LLM)
      return {}

    const llmNodeData = nodeData as LLMNodeType
    return llmNodeData.model
      ? {
          provider: llmNodeData.model.provider,
          name: llmNodeData.model.name,
          mode: llmNodeData.model.mode,
        }
      : {}
  }, [])

  const searchableNodes = useMemo(() => {
    const filteredNodes = nodes.filter((node) => {
      if (!node.id || !node.data || node.type === 'sticky')
        return false

      const nodeData = node.data as CommonNodeType
      const nodeType = nodeData?.type

      const internalStartNodes = ['iteration-start', 'loop-start']
      return !internalStartNodes.includes(nodeType)
    })

    return filteredNodes.map((node) => {
      const nodeData = node.data as CommonNodeType

      return {
        id: node.id,
        title: nodeData?.title || nodeData?.type || 'Untitled',
        type: nodeData?.type || '',
        desc: nodeData?.desc || '',
        blockType: nodeData?.type,
        nodeData,
        toolIcon: getToolIcon(nodeData),
        modelInfo: getModelInfo(nodeData),
      }
    })
  }, [nodes, getToolIcon, getModelInfo])

  // Calculate search score - clean scoring logic
  const calculateScore = useCallback((node: {
    title: string
    type: string
    desc: string
    modelInfo: { provider?: string, name?: string, mode?: string }
  }, searchTerm: string): number => {
    if (!searchTerm)
      return 1

    const titleMatch = node.title.toLowerCase()
    const typeMatch = node.type.toLowerCase()
    const descMatch = node.desc?.toLowerCase() || ''
    const modelProviderMatch = node.modelInfo?.provider?.toLowerCase() || ''
    const modelNameMatch = node.modelInfo?.name?.toLowerCase() || ''
    const modelModeMatch = node.modelInfo?.mode?.toLowerCase() || ''

    let score = 0

    // Title matching (exact prefix > partial match)
    if (titleMatch.startsWith(searchTerm))
      score += 100
    else if (titleMatch.includes(searchTerm))
      score += 50

    // Type matching (exact > partial)
    if (typeMatch === searchTerm)
      score += 80
    else if (typeMatch.includes(searchTerm))
      score += 30

    // Description matching (additive)
    if (descMatch.includes(searchTerm))
      score += 20

    // LLM model matching (additive - can combine multiple matches)
    if (modelNameMatch && modelNameMatch.includes(searchTerm))
      score += 60
    if (modelProviderMatch && modelProviderMatch.includes(searchTerm))
      score += 40
    if (modelModeMatch && modelModeMatch.includes(searchTerm))
      score += 30

    return score
  }, [])

  // Create search function for workflow nodes
  const searchWorkflowNodes = useCallback((query: string) => {
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
      workflowNodesAction.searchFn = searchWorkflowNodes
    }

    return () => {
      // Clean up when component unmounts
      workflowNodesAction.searchFn = undefined
    }
  }, [searchableNodes, searchWorkflowNodes])

  // Set up node selection event listener using the utility function
  useEffect(() => {
    return setupNodeSelectionListener(handleNodeSelect)
  }, [handleNodeSelect])

  return null
}
