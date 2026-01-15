'use client'

import type { FC } from 'react'
import type { TreeApi } from 'react-arborist'
import type { TreeNodeData } from './type'
import { useClickAway } from 'ahooks'
import * as React from 'react'
import { useCallback, useMemo, useRef } from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useGetAppAssetTree } from '@/service/use-app-asset'
import FileNodeMenu from './file-node-menu'
import FolderNodeMenu from './folder-node-menu'
import { useSkillEditorStore, useSkillEditorStoreApi } from './store'
import { findNodeById } from './utils/tree-utils'

type TreeContextMenuProps = {
  treeRef: React.RefObject<TreeApi<TreeNodeData> | null>
}

const TreeContextMenu: FC<TreeContextMenuProps> = ({ treeRef }) => {
  const ref = useRef<HTMLDivElement>(null)
  const contextMenu = useSkillEditorStore(s => s.contextMenu)
  const storeApi = useSkillEditorStoreApi()

  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''
  const { data: treeData } = useGetAppAssetTree(appId)

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
      {isFolder
        ? (
            <FolderNodeMenu
              nodeId={contextMenu.nodeId}
              onClose={handleClose}
              treeRef={treeRef}
            />
          )
        : (
            <FileNodeMenu
              nodeId={contextMenu.nodeId}
              onClose={handleClose}
              treeRef={treeRef}
            />
          )}
    </div>
  )
}

export default React.memo(TreeContextMenu)
