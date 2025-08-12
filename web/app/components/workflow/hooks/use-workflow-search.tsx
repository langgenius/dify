'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useNodes } from 'reactflow'
import { useNodesInteractions } from './use-nodes-interactions'
import type { CommonNodeType } from '../types'
import { workflowNodesAction } from '@/app/components/goto-anything/actions/workflow-nodes'
import BlockIcon from '@/app/components/workflow/block-icon'
import { setupNodeSelectionListener } from '../utils/node-navigation'
import { BlockEnum } from '../types'
import { useStore } from '../store'
import type { Emoji } from '@/app/components/tools/types'
import { CollectionType } from '@/app/components/tools/types'
import { canFindTool } from '@/utils'

/**
 * Hook to register workflow nodes search functionality
 */
export const useWorkflowSearch = () => {
  const nodes = useNodes()
  const { handleNodeSelect } = useNodesInteractions()

  // Filter and process nodes for search
  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)
  const workflowTools = useStore(s => s.workflowTools)
  const mcpTools = useStore(s => s.mcpTools)

  const searchableNodes = useMemo(() => {
    const filteredNodes = nodes.filter((node) => {
      if (!node.id || !node.data || node.type === 'sticky') return false

      const nodeData = node.data as CommonNodeType
      const nodeType = nodeData?.type

      const internalStartNodes = ['iteration-start', 'loop-start']
      return !internalStartNodes.includes(nodeType)
    })

    const result = filteredNodes
      .map((node) => {
        const nodeData = node.data as CommonNodeType

        // compute tool icon if node is a Tool
        let toolIcon: string | Emoji | undefined
        if (nodeData?.type === BlockEnum.Tool) {
          let targetTools = workflowTools
          if (nodeData.provider_type === CollectionType.builtIn)
            targetTools = buildInTools
          else if (nodeData.provider_type === CollectionType.custom)
            targetTools = customTools
          else if (nodeData.provider_type === CollectionType.mcp)
            targetTools = mcpTools

          toolIcon = targetTools.find(toolWithProvider => canFindTool(toolWithProvider.id, nodeData.provider_id))?.icon
        }

        return {
          id: node.id,
          title: nodeData?.title || nodeData?.type || 'Untitled',
          type: nodeData?.type || '',
          desc: nodeData?.desc || '',
          blockType: nodeData?.type,
          nodeData,
          toolIcon,
        }
      })

    return result
  }, [nodes, buildInTools, customTools, workflowTools, mcpTools])

  // Create search function for workflow nodes
  const searchWorkflowNodes = useCallback((query: string) => {
    if (!searchableNodes.length) return []

    const searchTerm = query.toLowerCase().trim()

    const results = searchableNodes
      .map((node) => {
        const titleMatch = node.title.toLowerCase()
        const typeMatch = node.type.toLowerCase()
        const descMatch = node.desc?.toLowerCase() || ''

        let score = 0

        // If no search term, show all nodes with base score
        if (!searchTerm) {
          score = 1
        }
 else {
          // Score based on search relevance
          if (titleMatch.startsWith(searchTerm)) score += 100
          else if (titleMatch.includes(searchTerm)) score += 50
          else if (typeMatch === searchTerm) score += 80
          else if (typeMatch.includes(searchTerm)) score += 30
          else if (descMatch.includes(searchTerm)) score += 20
        }

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
              // Add required data property for SearchResult type
              data: node.nodeData,
            }
          : null
      })
      .filter((node): node is NonNullable<typeof node> => node !== null)
      .sort((a, b) => {
        // If no search term, sort alphabetically
        if (!searchTerm)
          return a.title.localeCompare(b.title)

        // Sort by relevance when searching
        const aTitle = a.title.toLowerCase()
        const bTitle = b.title.toLowerCase()

        if (aTitle.startsWith(searchTerm) && !bTitle.startsWith(searchTerm)) return -1
        if (!aTitle.startsWith(searchTerm) && bTitle.startsWith(searchTerm)) return 1

        return 0
      })

    return results
  }, [searchableNodes])

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
