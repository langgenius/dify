'use client'

import type { Node } from '../types'
import { toast } from '@langgenius/dify-ui/toast'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from '@/next/navigation'
import { scrollToWorkflowNode } from '../utils/node-navigation'
import { useNodesInteractions } from './use-nodes-interactions'

/**
 * Hook to locate a node by ID from URL query parameter `node_id`.
 *
 * Usage scenario: operators find a failing node ID from server logs,
 * construct a URL like `/workflow?node_id=xxx`, and the editor will
 * automatically select and scroll to that node on load.
 *
 * The hook reads `node_id` from the URL search params, waits for nodes
 * to be available, then selects and scrolls to the target node.
 * A toast message is shown to indicate success or failure.
 */
export const useLocateNode = (nodes: Node[]) => {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const nodeIdFromUrl = searchParams.get('node_id')
  const { handleNodeSelect } = useNodesInteractions()
  const hasLocateRef = useRef(false)

  useEffect(() => {
    if (!nodeIdFromUrl || hasLocateRef.current)
      return

    // Wait for nodes to be loaded
    if (!nodes.length)
      return

    const targetNode = nodes.find(n => n.id === nodeIdFromUrl)

    if (!targetNode) {
      // Don't mark as located yet — nodes may still be loading asynchronously.
      // Retry on the next nodes update before reporting "not found".
      return
    }

    // Select the node (opens its panel) and scroll to it
    handleNodeSelect(nodeIdFromUrl)

    // Delay scroll to ensure node selection state has been applied
    const scrollTimer = setTimeout(() => {
      scrollToWorkflowNode(nodeIdFromUrl)
    }, 200)

    toast.success(t('panel.locateNodeSuccess', { ns: 'workflow', title: targetNode.data?.title || nodeIdFromUrl }))
    hasLocateRef.current = true

    return () => clearTimeout(scrollTimer)
  }, [nodeIdFromUrl, nodes, handleNodeSelect, t])

  // Report "not found" after nodes have settled (no longer changing)
  useEffect(() => {
    if (!nodeIdFromUrl || hasLocateRef.current || !nodes.length)
      return

    const targetNode = nodes.find(n => n.id === nodeIdFromUrl)
    if (targetNode)
      return

    // Debounce: wait to see if nodes continue loading before reporting not found
    const notFoundTimer = setTimeout(() => {
      if (hasLocateRef.current)
        return
      const stillMissing = !nodes.find(n => n.id === nodeIdFromUrl)
      if (stillMissing) {
        toast.error(t('panel.locateNodeNotFound', { ns: 'workflow', nodeId: nodeIdFromUrl }))
        hasLocateRef.current = true
      }
    }, 500)

    return () => clearTimeout(notFoundTimer)
  }, [nodeIdFromUrl, nodes, t])
}
