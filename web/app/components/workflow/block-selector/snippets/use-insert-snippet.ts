import type { Edge, Node } from '../../types'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import { toast } from '@/app/components/base/ui/toast'
import { consoleQuery } from '@/service/client'
import { useNodesSyncDraft, useWorkflowHistory, WorkflowHistoryEvent } from '../../hooks'

const getSnippetGraph = (graph: Record<string, unknown> | undefined) => {
  if (!graph)
    return { nodes: [] as Node[], edges: [] as Edge[] }

  return {
    nodes: Array.isArray(graph.nodes) ? graph.nodes as Node[] : [],
    edges: Array.isArray(graph.edges) ? graph.edges as Edge[] : [],
  }
}

const remapSnippetGraph = (currentNodes: Node[], snippetNodes: Node[], snippetEdges: Edge[]) => {
  const existingIds = new Set(currentNodes.map(node => node.id))
  const idMapping = new Map<string, string>()
  const rootNodes = snippetNodes.filter(node => !node.parentId)
  const minRootX = rootNodes.length ? Math.min(...rootNodes.map(node => node.position.x)) : 0
  const minRootY = rootNodes.length ? Math.min(...rootNodes.map(node => node.position.y)) : 0
  const currentMaxX = currentNodes.length
    ? Math.max(...currentNodes.map((node) => {
        const nodeX = node.positionAbsolute?.x ?? node.position.x
        return nodeX + (node.width ?? 0)
      }))
    : 0
  const currentMinY = currentNodes.length
    ? Math.min(...currentNodes.map(node => node.positionAbsolute?.y ?? node.position.y))
    : 0
  const offsetX = (currentNodes.length ? currentMaxX + 80 : 80) - minRootX
  const offsetY = (currentNodes.length ? currentMinY : 80) - minRootY

  snippetNodes.forEach((node, index) => {
    let nextId = `${node.id}-${Date.now()}-${index}`
    while (existingIds.has(nextId))
      nextId = `${nextId}-1`
    existingIds.add(nextId)
    idMapping.set(node.id, nextId)
  })

  const nodes = snippetNodes.map((node) => {
    const nextParentId = node.parentId ? idMapping.get(node.parentId) : undefined
    const isRootNode = !node.parentId

    return {
      ...node,
      id: idMapping.get(node.id)!,
      parentId: nextParentId,
      position: isRootNode
        ? {
            x: node.position.x + offsetX,
            y: node.position.y + offsetY,
          }
        : node.position,
      positionAbsolute: node.positionAbsolute
        ? (isRootNode
            ? {
                x: node.positionAbsolute.x + offsetX,
                y: node.positionAbsolute.y + offsetY,
              }
            : node.positionAbsolute)
        : undefined,
      selected: true,
      data: {
        ...node.data,
        selected: true,
        _children: node.data._children?.map(child => ({
          ...child,
          nodeId: idMapping.get(child.nodeId) ?? child.nodeId,
        })),
      },
    }
  })

  const edges = snippetEdges.map(edge => ({
    ...edge,
    id: `${idMapping.get(edge.source)}-${edge.sourceHandle}-${idMapping.get(edge.target)}-${edge.targetHandle}`,
    source: idMapping.get(edge.source)!,
    target: idMapping.get(edge.target)!,
    selected: false,
    data: edge.data
      ? {
          ...edge.data,
          _connectedNodeIsSelected: true,
        }
      : edge.data,
  }))

  return { nodes, edges }
}

export const useInsertSnippet = () => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const store = useStoreApi()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { saveStateToHistory } = useWorkflowHistory()

  const handleInsertSnippet = useCallback(async (snippetId: string) => {
    try {
      const workflow = await queryClient.fetchQuery(consoleQuery.snippets.publishedWorkflow.queryOptions({
        input: {
          params: { snippetId },
        },
      }))
      const { nodes: snippetNodes, edges: snippetEdges } = getSnippetGraph(workflow.graph)

      if (!snippetNodes.length)
        return

      const { getNodes, setNodes, edges, setEdges } = store.getState()
      const currentNodes = getNodes()
      const remappedGraph = remapSnippetGraph(currentNodes, snippetNodes, snippetEdges)
      const clearedNodes = currentNodes.map(node => ({
        ...node,
        selected: false,
        data: {
          ...node.data,
          selected: false,
        },
      }))

      setNodes([...clearedNodes, ...remappedGraph.nodes])
      setEdges([...edges, ...remappedGraph.edges])
      saveStateToHistory(WorkflowHistoryEvent.NodePaste, {
        nodeId: remappedGraph.nodes[0]?.id,
      })
      handleSyncWorkflowDraft()
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : t('createFailed', { ns: 'snippet' }))
    }
  }, [handleSyncWorkflowDraft, queryClient, saveStateToHistory, store, t])

  return {
    handleInsertSnippet,
  }
}
