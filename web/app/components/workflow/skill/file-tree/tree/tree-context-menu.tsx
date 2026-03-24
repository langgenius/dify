'use client'

import type { TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../../type'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'
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

type MenuTarget = {
  nodeId: string
  type: typeof NODE_MENU_TYPE.ROOT | typeof NODE_MENU_TYPE.FOLDER | typeof NODE_MENU_TYPE.FILE
}

const defaultMenuTarget: MenuTarget = {
  nodeId: ROOT_ID,
  type: NODE_MENU_TYPE.ROOT,
}

const TreeContextMenu = ({
  treeRef,
  triggerRef,
  children,
  ...props
}: TreeContextMenuProps) => {
  const { t } = useTranslation('workflow')
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

    treeRef.current?.get(nodeId)?.select()
    setMenuTarget({
      nodeId,
      type: nodeType,
    })
  }, [storeApi, treeRef])

  const handleMenuClose = React.useCallback(() => {}, [])
  const fileOperations = useFileOperations({
    nodeId: menuTarget.nodeId,
    treeRef,
    onClose: handleMenuClose,
  })
  const handleOpenImportSkills = React.useCallback(() => {
    setIsImportModalOpen(true)
  }, [])
  const isRootTarget = menuTarget.type === NODE_MENU_TYPE.ROOT
  const isFolderTarget = menuTarget.type === NODE_MENU_TYPE.FOLDER
  const deleteConfirmTitle = isFolderTarget
    ? t('skillSidebar.menu.deleteConfirmTitle')
    : t('skillSidebar.menu.fileDeleteConfirmTitle')
  const deleteConfirmContent = isFolderTarget
    ? t('skillSidebar.menu.deleteConfirmContent')
    : t('skillSidebar.menu.fileDeleteConfirmContent')

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
        <AlertDialog
          open={fileOperations.showDeleteConfirm}
          onOpenChange={(open) => {
            if (!open)
              fileOperations.handleDeleteCancel()
          }}
        >
          <AlertDialogContent>
            <div className="flex flex-col gap-2 p-6 pb-4">
              <AlertDialogTitle className="text-text-primary title-2xl-semi-bold">
                {deleteConfirmTitle}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-text-secondary system-sm-regular">
                {deleteConfirmContent}
              </AlertDialogDescription>
            </div>
            <AlertDialogActions>
              <AlertDialogCancelButton>
                {t('operation.cancel', { ns: 'common' })}
              </AlertDialogCancelButton>
              <AlertDialogConfirmButton
                disabled={fileOperations.isDeleting}
                onClick={() => {
                  void fileOperations.handleDeleteConfirm()
                }}
              >
                {t('operation.confirm', { ns: 'common' })}
              </AlertDialogConfirmButton>
            </AlertDialogActions>
          </AlertDialogContent>
        </AlertDialog>
      )}
      <ImportSkillModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      />
    </>
  )
}

export default React.memo(TreeContextMenu)
