'use client'

import type { TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../type'
import { FloatingPortal } from '@floating-ui/react'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { useContextMenuFloating } from '@/app/components/base/portal-to-follow-elem/use-context-menu-floating'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { getMenuNodeId, getNodeMenuType } from '../utils/tree-utils'
import NodeMenu from './node-menu'

type TreeContextMenuProps = {
  treeRef: React.RefObject<TreeApi<TreeNodeData> | null>
}

const TreeContextMenu = ({ treeRef }: TreeContextMenuProps) => {
  const contextMenu = useStore(s => s.contextMenu)
  const storeApi = useWorkflowStore()

  const handleClose = useCallback(() => {
    storeApi.getState().setContextMenu(null)
  }, [storeApi])

  const position = useMemo(() => ({
    x: contextMenu?.left ?? 0,
    y: contextMenu?.top ?? 0,
  }), [contextMenu?.left, contextMenu?.top])

  const { refs, floatingStyles, getFloatingProps, isPositioned } = useContextMenuFloating({
    open: !!contextMenu,
    onOpenChange: (open) => {
      if (!open)
        handleClose()
    },
    position,
  })

  if (!contextMenu)
    return null

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        className="z-[100]"
        style={{
          ...floatingStyles,
          visibility: isPositioned ? 'visible' : 'hidden',
        }}
        {...getFloatingProps()}
      >
        <NodeMenu
          type={getNodeMenuType(contextMenu.type, contextMenu.isFolder)}
          nodeId={getMenuNodeId(contextMenu.type, contextMenu.nodeId)}
          onClose={handleClose}
          treeRef={treeRef}
        />
      </div>
    </FloatingPortal>
  )
}

export default React.memo(TreeContextMenu)
