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
import NodeDeleteConfirmDialog from './node-delete-confirm-dialog'
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

type MenuTarget = {
  nodeId: string
  type: typeof NODE_MENU_TYPE.ROOT | typeof NODE_MENU_TYPE.FOLDER | typeof NODE_MENU_TYPE.FILE
  fileName?: string
  actionNodeIds: string[]
}

const defaultMenuTarget: MenuTarget = {
  nodeId: ROOT_ID,
  type: NODE_MENU_TYPE.ROOT,
  actionNodeIds: [],
}

const TreeContextMenu = ({
  treeRef,
  triggerRef,
  children,
  ...props
}: TreeContextMenuProps) => {
  const storeApi = useWorkflowStore()
  const [menuTarget, setMenuTarget] = useState<MenuTarget>(defaultMenuTarget)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)

  const handleContextMenu = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    const nodeElement = target.closest<HTMLElement>('[data-skill-tree-node-id]')

    if (!nodeElement) {
      setMenuTarget(defaultMenuTarget)
      treeRef.current?.deselectAll()
      storeApi.getState().clearSelection()
      return
    }

    const nodeId = nodeElement.dataset.skillTreeNodeId
    const nodeType = nodeElement.dataset.skillTreeNodeType

    if (!nodeId || (nodeType !== NODE_MENU_TYPE.FILE && nodeType !== NODE_MENU_TYPE.FOLDER))
      return

    const targetNode = treeRef.current?.get(nodeId)
    const selectedNodeIds = storeApi.getState().selectedNodeIds
    const targetIsInSelection = selectedNodeIds.has(nodeId)
    const actionNodeIds = targetIsInSelection && selectedNodeIds.size > 0
      ? [...selectedNodeIds]
      : [nodeId]

    if (!targetIsInSelection) {
      treeRef.current?.deselectAll?.()
      targetNode?.select()
      storeApi.getState().setSelectedNodeIds([nodeId])
    }

    setMenuTarget({
      nodeId,
      type: nodeType,
      fileName: targetNode?.data.name,
      actionNodeIds,
    })
  }, [storeApi, treeRef])

  const handleMenuClose = React.useCallback(() => {}, [])
  const fileOperations = useFileOperations({
    nodeId: menuTarget.nodeId,
    treeRef,
    onClose: handleMenuClose,
    nodeType: menuTarget.type === NODE_MENU_TYPE.ROOT ? undefined : menuTarget.type,
    fileName: menuTarget.fileName,
  })
  const handleOpenImportSkills = React.useCallback(() => {
    setIsImportModalOpen(true)
  }, [])
  const isRootTarget = menuTarget.type === NODE_MENU_TYPE.ROOT
  const deleteNodeType = menuTarget.type === NODE_MENU_TYPE.FOLDER ? 'folder' : 'file'

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
            type={menuTarget.type}
            nodeId={menuTarget.nodeId}
            actionNodeIds={menuTarget.actionNodeIds}
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
            onImportSkills={isRootTarget ? handleOpenImportSkills : undefined}
          />
        </ContextMenuContent>
      </ContextMenu>
      {!isRootTarget && (
        <NodeDeleteConfirmDialog
          nodeType={deleteNodeType}
          open={fileOperations.showDeleteConfirm}
          isDeleting={fileOperations.isDeleting}
          onConfirm={() => {
            void fileOperations.handleDeleteConfirm()
          }}
          onCancel={fileOperations.handleDeleteCancel}
        />
      )}
      <ImportSkillModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      />
    </>
  )
}

export default React.memo(TreeContextMenu)
