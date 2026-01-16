'use client'

import type { FC } from 'react'
import type { TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../type'
import { useClickAway } from 'ahooks'
import * as React from 'react'
import { useCallback, useMemo, useRef } from 'react'
import { useSkillAssetTreeData } from '../hooks/use-skill-asset-tree'
import { useSkillEditorStore, useSkillEditorStoreApi } from '../store'
import { findNodeById } from '../utils/tree-utils'
import NodeMenu from './node-menu'

type TreeContextMenuProps = {
  treeRef: React.RefObject<TreeApi<TreeNodeData> | null>
}

const TreeContextMenu: FC<TreeContextMenuProps> = ({ treeRef }) => {
  const ref = useRef<HTMLDivElement>(null)
  const contextMenu = useSkillEditorStore(s => s.contextMenu)
  const storeApi = useSkillEditorStoreApi()
  const { data: treeData } = useSkillAssetTreeData()

  const handleClose = useCallback(() => {
    storeApi.getState().setContextMenu(null)
  }, [storeApi])

  useClickAway(() => {
    handleClose()
  }, ref)

  const targetNode = useMemo(() => {
    if (!contextMenu?.nodeId || !treeData?.children)
      return null
    return findNodeById(treeData.children, contextMenu.nodeId)
  }, [contextMenu?.nodeId, treeData?.children])

  const isFolder = targetNode?.node_type === 'folder'

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
        type={isFolder ? 'folder' : 'file'}
        nodeId={contextMenu.nodeId}
        onClose={handleClose}
        treeRef={treeRef}
      />
    </div>
  )
}

export default React.memo(TreeContextMenu)
