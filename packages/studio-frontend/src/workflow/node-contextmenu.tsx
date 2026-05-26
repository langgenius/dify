import type { Node } from '@/app/components/workflow/types'
import {
  ContextMenu,
  ContextMenuContent,
} from '@langgenius/dify-ui/context-menu'
import { useMemo } from 'react'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import { usePanelInteractions } from '@/app/components/workflow/hooks/index'
import { NodeActionsContextMenuContent } from '@/app/components/workflow/node-actions-menu/context-menu-content'
import { NODE_ACTIONS_MENU_WIDTH_CLASS_NAME } from '@/app/components/workflow/node-actions-menu/shared'
import { useStore } from '@/app/components/workflow/store/index'

export function NodeContextmenu() {
  const nodes = useNodes()
  const { handleNodeContextmenuCancel } = usePanelInteractions()
  const nodeMenu = useStore(s => s.nodeMenu)
  const currentNode = nodes.find(node => node.id === nodeMenu?.nodeId) as Node

  const anchor = useMemo(() => {
    if (!nodeMenu || !currentNode)
      return undefined

    return {
      getBoundingClientRect: () => DOMRect.fromRect({
        width: 0,
        height: 0,
        x: nodeMenu.clientX,
        y: nodeMenu.clientY,
      }),
    }
  }, [currentNode, nodeMenu])

  if (!nodeMenu || !currentNode || !anchor)
    return null

  return (
    <ContextMenu
      open
      onOpenChange={open => !open && handleNodeContextmenuCancel()}
    >
      <ContextMenuContent
        positionerProps={{ anchor }}
        popupClassName={NODE_ACTIONS_MENU_WIDTH_CLASS_NAME}
      >
        <NodeActionsContextMenuContent
          id={currentNode.id}
          data={currentNode.data}
          onClose={handleNodeContextmenuCancel}
          showHelpLink
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}
