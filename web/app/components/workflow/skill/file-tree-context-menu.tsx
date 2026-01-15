'use client'

import type { FC } from 'react'
import { useClickAway } from 'ahooks'
import * as React from 'react'
import { useCallback, useRef } from 'react'
import FileOperationsMenu from './file-operations-menu'
import { useSkillEditorStore, useSkillEditorStoreApi } from './store'

/**
 * FileTreeContextMenu - Right-click context menu for file tree
 *
 * Renders at absolute position when contextMenu state is set.
 * Uses useClickAway to close when clicking outside.
 */
const FileTreeContextMenu: FC = () => {
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
      />
    </div>
  )
}

export default React.memo(FileTreeContextMenu)
