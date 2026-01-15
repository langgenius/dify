'use client'

import type { FC } from 'react'
import type { TreeApi } from 'react-arborist'
import type { TreeNodeData } from './type'
import { useClickAway } from 'ahooks'
import * as React from 'react'
import { useCallback, useRef } from 'react'
import FileOperationsMenu from './file-operations-menu'
import { useSkillEditorStore, useSkillEditorStoreApi } from './store'

type FileTreeContextMenuProps = {
  treeRef: React.RefObject<TreeApi<TreeNodeData> | null>
}

const FileTreeContextMenu: FC<FileTreeContextMenuProps> = ({ treeRef }) => {
  const ref = useRef<HTMLDivElement>(null)
  const contextMenu = useSkillEditorStore(s => s.contextMenu)
  const storeApi = useSkillEditorStoreApi()

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
      <FileOperationsMenu
        nodeId={contextMenu.nodeId}
        onClose={handleClose}
        treeRef={treeRef}
      />
    </div>
  )
}

export default React.memo(FileTreeContextMenu)
