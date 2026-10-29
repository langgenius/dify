import type { Node } from './types'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import { NodeActionsContextMenuContent } from './node-actions-menu/context-menu-content'
import { useStore } from './store'

export function NodeContextmenu({ onClose }: { onClose: () => void }) {
  const nodes = useNodes()
  const contextMenuTarget = useStore((s) => s.contextMenuTarget)
  const nodeId = contextMenuTarget?.type === 'node' ? contextMenuTarget.nodeId : undefined
  const currentNode = nodeId
    ? (nodes.find((node) => node.id === nodeId) as Node | undefined)
    : undefined

  if (!nodeId || !currentNode) return null

  return (
    <NodeActionsContextMenuContent
      id={currentNode.id}
      data={currentNode.data}
      onClose={onClose}
      showHelpLink
    />
  )
}
