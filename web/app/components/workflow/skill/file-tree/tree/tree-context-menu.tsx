'use client'

import type { TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../../type'
import * as React from 'react'
import { useState } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/app/components/base/ui/context-menu'
import { useWorkflowStore } from '@/app/components/workflow/store'
import dynamic from '@/next/dynamic'
import { NODE_MENU_TYPE, ROOT_ID } from '../../constants'
import { useFileOperations } from '../../hooks/file-tree/operations/use-file-operations'
import NodeMenu from './node-menu'

const ImportSkillModal = dynamic(() => import('../../start-tab/import-skill-modal'), {
  ssr: false,
})

type TreeContextMenuProps = Omit<
  React.ComponentPropsWithoutRef<typeof ContextMenuTrigger>,
  'children' | 'onContextMenu'
> & {
  treeRef: React.RefObject<TreeApi<TreeNodeData> | null>
  triggerRef?: React.Ref<HTMLDivElement>
  children: React.ReactNode
}

const TreeContextMenu = ({
  treeRef,
  triggerRef,
  children,
  ...props
}: TreeContextMenuProps) => {
  const storeApi = useWorkflowStore()
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)

  const handleContextMenu = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('[role="treeitem"]'))
      return

    treeRef.current?.deselectAll()
    storeApi.getState().clearSelection()
  }, [storeApi, treeRef])

  const handleMenuClose = React.useCallback(() => {}, [])
  const fileOperations = useFileOperations({
    nodeId: ROOT_ID,
    treeRef,
    onClose: handleMenuClose,
  })
  const handleOpenImportSkills = React.useCallback(() => {
    setIsImportModalOpen(true)
  }, [])

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          ref={triggerRef}
          onContextMenu={handleContextMenu}
          {...props}
        >
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent popupClassName="min-w-[180px]">
          <NodeMenu
            menuType="context"
            type={NODE_MENU_TYPE.ROOT}
            nodeId={ROOT_ID}
            onClose={handleMenuClose}
            fileInputRef={fileOperations.fileInputRef}
            folderInputRef={fileOperations.folderInputRef}
            isLoading={fileOperations.isLoading}
            onDownload={fileOperations.handleDownload}
            onNewFile={fileOperations.handleNewFile}
            onNewFolder={fileOperations.handleNewFolder}
            onFileChange={fileOperations.handleFileChange}
            onFolderChange={fileOperations.handleFolderChange}
            onRename={fileOperations.handleRename}
            onDeleteClick={fileOperations.handleDeleteClick}
            onImportSkills={handleOpenImportSkills}
          />
        </ContextMenuContent>
      </ContextMenu>
      <ImportSkillModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      />
    </>
  )
}

export default React.memo(TreeContextMenu)
