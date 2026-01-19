'use client'

import type { FC } from 'react'
import type { TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../type'
import { useClickAway } from 'ahooks'
import * as React from 'react'
import { useCallback, useMemo, useRef } from 'react'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { useSkillAssetTreeData } from '../hooks/use-skill-asset-tree'
import { findNodeById } from '../utils/tree-utils'
import BlankAreaMenu from './blank-area-menu'
import NodeMenu from './node-menu'

type TreeContextMenuProps = {
  treeRef: React.RefObject<TreeApi<TreeNodeData> | null>
}

const TreeContextMenu: FC<TreeContextMenuProps> = ({ treeRef }) => {
  const ref = useRef<HTMLDivElement>(null)
  const contextMenu = useStore(s => s.contextMenu)
  const storeApi = useWorkflowStore()
  const { data: treeData } = useSkillAssetTreeData()

  const handleClose = useCallback(() => {
    storeApi.getState().setContextMenu(null)
  }, [storeApi])

  useClickAway(() => {
    handleClose()
  }, ref)

  const nodeId = contextMenu?.nodeId
  const treeChildren = treeData?.children

  const targetNode = useMemo(() => {
    if (!nodeId || !treeChildren)
      return null
    return findNodeById(treeChildren, nodeId)
  }, [nodeId, treeChildren])

  const isFolder = targetNode?.node_type === 'folder'
  const isBlankArea = contextMenu?.type === 'blank'

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
      {isBlankArea
        ? (
            <BlankAreaMenu onClose={handleClose} />
          )
        : (
            <NodeMenu
              type={isFolder ? 'folder' : 'file'}
              nodeId={contextMenu.nodeId}
              onClose={handleClose}
              treeRef={treeRef}
            />
          )}
    </div>
  )
}

export default React.memo(TreeContextMenu)
