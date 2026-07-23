import type { ContextMenuActions } from '@langgenius/dify-ui/context-menu'
import type { ReactNode } from 'react'
import { ContextMenu, ContextMenuTrigger } from '@langgenius/dify-ui/context-menu'
import { useCallback, useRef } from 'react'
import { EdgeContextmenu } from './edge-contextmenu'
import { NodeContextmenu } from './node-contextmenu'
import { PanelContextmenu } from './panel-contextmenu'
import { SelectionContextmenu } from './selection-contextmenu'
import { useWorkflowStore } from './store'

export function WorkflowContextmenu({ children }: { children: ReactNode }) {
  const workflowStore = useWorkflowStore()
  const actionsRef = useRef<ContextMenuActions | null>(null)

  const clearContextMenuTarget = useCallback(() => {
    workflowStore.setState({ contextMenuTarget: undefined })
  }, [workflowStore])

  const closeContextMenu = useCallback(() => {
    actionsRef.current?.close()
  }, [])

  return (
    <ContextMenu
      actionsRef={actionsRef}
      onOpenChangeComplete={(open) => {
        if (!open) clearContextMenuTarget()
      }}
    >
      <ContextMenuTrigger render={<div className="h-full w-full" />}>{children}</ContextMenuTrigger>
      <PanelContextmenu onClose={closeContextMenu} />
      <NodeContextmenu onClose={closeContextMenu} />
      <EdgeContextmenu onClose={closeContextMenu} />
      <SelectionContextmenu onClose={closeContextMenu} />
    </ContextMenu>
  )
}
