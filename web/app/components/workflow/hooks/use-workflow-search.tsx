'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useNodes } from 'reactflow'
import { useNodesInteractions } from './use-nodes-interactions'
import type { CommonNodeType } from '../types'
import { workflowNodesAction } from '@/app/components/goto-anything/actions/workflow-nodes'
import BlockIcon from '@/app/components/workflow/block-icon'
import { setupNodeSelectionListener } from '../utils/node-navigation'

/**
 * Hook to register workflow nodes search functionality
 */
export const useWorkflowSearch = () => {
  const nodes = useNodes()
  const { handleNodeSelect } = useNodesInteractions()

  // Filter and process nodes for search
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

        return {
          id: node.id,
          title: nodeData?.title || nodeData?.type || 'Untitled',
          type: nodeData?.type || '',
          desc: nodeData?.desc || '',
          blockType: nodeData?.type,
          nodeData,
        }
      })

    return result
  }, [nodes])

  // Create search function for workflow nodes
  const searchWorkflowNodes = useCallback((query: string) => {
    if (!searchableNodes.length || !query.trim()) return []

    const searchTerm = query.toLowerCase()

    const results = searchableNodes
      .map((node) => {
        const titleMatch = node.title.toLowerCase()
        const typeMatch = node.type.toLowerCase()
        const descMatch = node.desc?.toLowerCase() || ''

        let score = 0

        if (titleMatch.startsWith(searchTerm)) score += 100
        else if (titleMatch.includes(searchTerm)) score += 50
        else if (typeMatch === searchTerm) score += 80
        else if (typeMatch.includes(searchTerm)) score += 30
        else if (descMatch.includes(searchTerm)) score += 20

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
