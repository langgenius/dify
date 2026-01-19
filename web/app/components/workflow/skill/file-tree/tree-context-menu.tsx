'use client'

import type { FC } from 'react'
import type { TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../type'
import { useClickAway } from 'ahooks'
import * as React from 'react'
import { useCallback, useRef } from 'react'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import NodeMenu from './node-menu'

type TreeContextMenuProps = {
  treeRef: React.RefObject<TreeApi<TreeNodeData> | null>
}

function getMenuType(contextMenu: { type: string, isFolder?: boolean }): 'root' | 'folder' | 'file' {
  if (contextMenu.type === 'blank')
    return 'root'
  return contextMenu.isFolder ? 'folder' : 'file'
}

const TreeContextMenu: FC<TreeContextMenuProps> = ({ treeRef }) => {
  const ref = useRef<HTMLDivElement>(null)
  const contextMenu = useStore(s => s.contextMenu)
  const storeApi = useWorkflowStore()

  const handleClose = useCallback(() => {
    storeApi.getState().setContextMenu(null)
  }, [storeApi])

  useClickAway(() => {
    handleClose()
  }, ref)

  if (!contextMenu)
    return null

  return (
    <div
      ref={ref}
      className="fixed z-[100]"
      style={{
        top: contextMenu.top,
        left: contextMenu.left,
      }}
    >
      <NodeMenu
        type={getMenuType(contextMenu)}
        nodeId={contextMenu.type === 'blank' ? 'root' : contextMenu.nodeId}
        onClose={handleClose}
        treeRef={treeRef}
      />
    </div>
  )
}

export default React.memo(TreeContextMenu)
