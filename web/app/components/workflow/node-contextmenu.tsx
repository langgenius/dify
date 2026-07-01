import type { Node } from './types'
import {
  ContextMenuContent,
} from '@langgenius/dify-ui/context-menu'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import { NodeActionsContextMenuContent } from './node-actions-menu/context-menu-content'
import { NODE_ACTIONS_MENU_WIDTH_CLASS_NAME } from './node-actions-menu/shared'
import { useStore } from './store'

export function NodeContextmenu({
  onClose,
}: {
  onClose: () => void
}) {
  const nodes = useNodes()
  const contextMenuTarget = useStore(s => s.contextMenuTarget)
  const nodeId = contextMenuTarget?.type === 'node' ? contextMenuTarget.nodeId : undefined
  const currentNode = nodeId ? nodes.find(node => node.id === nodeId) as Node | undefined : undefined

  if (!nodeId || !currentNode)
    return null

  return (
    <ContextMenuContent
      popupClassName={NODE_ACTIONS_MENU_WIDTH_CLASS_NAME}
      sideOffset={4}
    >
      <NodeActionsContextMenuContent
        id={currentNode.id}
        data={currentNode.data}
        onClose={onClose}
        showHelpLink
      />
    </ContextMenuContent>
  )
}
