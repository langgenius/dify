import { useCallback, useMemo, useState } from 'react'
import type { NodeTracing } from '@/types/workflow'

type UseTracingSearchProps = {
  treeNodes: NodeTracing[]
}

type UseTracingSearchReturn = {
  searchQuery: string
  setSearchQuery: (query: string) => void
  filteredNodes: NodeTracing[]
  clearSearch: () => void
  searchStats: {
    matched: number
    total: number
  }
}

export const useTracingSearch = ({ treeNodes }: UseTracingSearchProps): UseTracingSearchReturn => {
  const [searchQuery, setSearchQuery] = useState('')

  // Recursively count all nodes including children
  const countNodesRecursively = useCallback((nodes: NodeTracing[]): number => {
    return nodes.reduce((count, node) => {
      let nodeCount = 1
      if (node.parallelDetail?.children)
        nodeCount += countNodesRecursively(node.parallelDetail.children)
      return count + nodeCount
    }, 0)
  }, [])

  // Deep recursive search filtering logic
  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return treeNodes

    const query = searchQuery.toLowerCase().trim()

    // Deep search object content with proper typing
    const MAX_SEARCH_DEPTH = 10
    const searchInObject = (obj: unknown, depth = MAX_SEARCH_DEPTH): boolean => {
      if (!obj || depth <= 0)
        return false

      if (typeof obj === 'string')
        return obj.toLowerCase().includes(query)
      if (typeof obj === 'number')
        return obj.toString().includes(query)
      if (typeof obj === 'boolean')
        return obj.toString().includes(query)

      if (Array.isArray(obj))
        return obj.some(item => searchInObject(item, depth - 1))

      if (typeof obj === 'object' && obj !== null)
        return Object.values(obj).some(value => searchInObject(value, depth - 1))

      return false
    }

    // Search all content in a single node with safe property access
    // Type guards for optional properties
    const hasStatus = (node: NodeTracing): node is NodeTracing & { status: string } => {
      return typeof (node as any).status === 'string'
    }
    const hasProcessData = (node: NodeTracing): node is NodeTracing & { process_data: unknown } => {
      return 'process_data' in node
    }
    const hasExecutionMetadata = (node: NodeTracing): node is NodeTracing & { execution_metadata: unknown } => {
      return 'execution_metadata' in node
    }

    const searchInNode = (node: NodeTracing): boolean => {
      // Safe string search with nullish coalescing
      const titleMatch = node.title?.toLowerCase().includes(query) ?? false
      const nodeTypeMatch = node.node_type?.toLowerCase().includes(query) ?? false
      const statusMatch = hasStatus(node) ? node.status.toLowerCase().includes(query) : false

      // Search in node data with proper type checking
      const inputsMatch = searchInObject(node.inputs)
      const outputsMatch = searchInObject(node.outputs)
      const processDataMatch = hasProcessData(node) ? searchInObject(node.process_data) : false
      const metadataMatch = hasExecutionMetadata(node) ? searchInObject(node.execution_metadata) : false

      return titleMatch || nodeTypeMatch || statusMatch || inputsMatch || outputsMatch || processDataMatch || metadataMatch
    }

    // Recursively search node and all its children
    const searchNodeRecursively = (node: NodeTracing): boolean => {
      // Search current node
      if (searchInNode(node)) return true

      // Search parallel branch children with safe access
      if (node.parallelDetail?.children)
        return node.parallelDetail.children.some((child: NodeTracing) => searchNodeRecursively(child))

      return false
    }

    // Recursively filter node tree while maintaining hierarchy
    const filterNodesRecursively = (nodes: NodeTracing[]): NodeTracing[] => {
      return nodes.reduce((acc: NodeTracing[], node: NodeTracing) => {
        const nodeMatches = searchInNode(node)
        const hasMatchingChildren = node.parallelDetail?.children
          ? node.parallelDetail.children.some((child: NodeTracing) => searchNodeRecursively(child))
          : false

        if (nodeMatches || hasMatchingChildren) {
          const filteredNode = { ...node }

          // If has parallel children, recursively filter them
          if (node.parallelDetail?.children) {
            const filteredChildren = filterNodesRecursively(node.parallelDetail.children)
            if (filteredChildren.length > 0) {
              filteredNode.parallelDetail = {
                ...node.parallelDetail,
                children: filteredChildren,
              }
            }
          }

          acc.push(filteredNode)
        }

        return acc
      }, [])
    }

    return filterNodesRecursively(treeNodes)
  }, [treeNodes, searchQuery])

  // Clear search function
  const clearSearch = useCallback(() => {
    setSearchQuery('')
  }, [])

  // Calculate search statistics
  const searchStats = useMemo(() => ({
    matched: countNodesRecursively(filteredNodes),
    total: countNodesRecursively(treeNodes),
  }), [filteredNodes, treeNodes, countNodesRecursively])

  return {
    searchQuery,
    setSearchQuery,
    filteredNodes,
    clearSearch,
    searchStats,
  }
}
