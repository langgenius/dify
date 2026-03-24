'use client'

import type { NodeApi, TreeApi } from 'react-arborist'
import type { NodeMenuType } from '../../constants'
import type { TreeNodeData } from '../../type'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { FileAdd, FolderAdd } from '@/app/components/base/icons/src/vender/line/files'
import { UploadCloud02 } from '@/app/components/base/icons/src/vender/line/general'
import { Download02 } from '@/app/components/base/icons/src/vender/solid/general'
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
  ContextMenuSeparator,
} from '@/app/components/base/ui/context-menu'
import {
  DropdownMenuSeparator,
} from '@/app/components/base/ui/dropdown-menu'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { NODE_MENU_TYPE } from '../../constants'
import { useFileOperations } from '../../hooks/file-tree/operations/use-file-operations'
import MenuItem from './menu-item'

const KBD_CUT = ['ctrl', 'x'] as const
const KBD_PASTE = ['ctrl', 'v'] as const

type NodeMenuProps = {
  type: NodeMenuType
  menuType: 'dropdown' | 'context'
  nodeId?: string
  onClose: () => void
  treeRef?: React.RefObject<TreeApi<TreeNodeData> | null>
  node?: NodeApi<TreeNodeData>
  onImportSkills?: () => void
}

const NodeMenu = ({
  type,
  menuType,
  nodeId,
  onClose,
  treeRef,
  node,
  onImportSkills,
}: NodeMenuProps) => {
  const { t } = useTranslation('workflow')
  const storeApi = useWorkflowStore()
  const selectedNodeIds = useStore(s => s.selectedNodeIds)
  const hasClipboard = useStore(s => s.hasClipboard())
  const isRoot = type === NODE_MENU_TYPE.ROOT
  const isFolder = type === NODE_MENU_TYPE.FOLDER || isRoot

  const {
    fileInputRef,
    folderInputRef,
    showDeleteConfirm,
    isLoading,
    isDeleting,
    handleDownload,
    handleNewFile,
    handleNewFolder,
    handleFileChange,
    handleFolderChange,
    handleRename,
    handleDeleteClick,
    handleDeleteConfirm,
    handleDeleteCancel,
  } = useFileOperations({ nodeId, onClose, treeRef, node })

  const currentNodeId = node?.data.id ?? nodeId

  const handleCut = useCallback(() => {
    const ids = selectedNodeIds.size > 0 ? [...selectedNodeIds] : (currentNodeId ? [currentNodeId] : [])
    if (ids.length > 0) {
      storeApi.getState().cutNodes(ids)
      onClose()
    }
  }, [currentNodeId, onClose, selectedNodeIds, storeApi])

  const handlePaste = useCallback(() => {
    window.dispatchEvent(new CustomEvent('skill:paste'))
    onClose()
  }, [onClose])

  const showRenameDelete = isFolder ? !isRoot : true
  const deleteConfirmTitle = isFolder
    ? t('skillSidebar.menu.deleteConfirmTitle')
    : t('skillSidebar.menu.fileDeleteConfirmTitle')
  const deleteConfirmContent = isFolder
    ? t('skillSidebar.menu.deleteConfirmContent')
    : t('skillSidebar.menu.fileDeleteConfirmContent')
  const Separator = menuType === 'dropdown' ? DropdownMenuSeparator : ContextMenuSeparator

  return (
    <>
      {isFolder && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            aria-label={t('skillSidebar.menu.uploadFile')}
            onChange={handleFileChange}
          />
          <input
            ref={folderInputRef}
            type="file"
            // @ts-expect-error webkitdirectory is a non-standard attribute
            webkitdirectory=""
            className="hidden"
            aria-label={t('skillSidebar.menu.uploadFolder')}
            onChange={handleFolderChange}
          />

          <MenuItem
            menuType={menuType}
            icon={FileAdd}
            label={t('skillSidebar.menu.newFile')}
            onClick={() => handleNewFile()}
            disabled={isLoading}
          />
          <MenuItem
            menuType={menuType}
            icon={FolderAdd}
            label={t('skillSidebar.menu.newFolder')}
            onClick={() => handleNewFolder()}
            disabled={isLoading}
          />

          <Separator />

          <MenuItem
            menuType={menuType}
            icon={UploadCloud02}
            label={t('skillSidebar.menu.uploadFile')}
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
          />
          <MenuItem
            menuType={menuType}
            icon="i-ri-folder-upload-line"
            label={t('skillSidebar.menu.uploadFolder')}
            onClick={() => folderInputRef.current?.click()}
            disabled={isLoading}
          />

          {isRoot && (
            <>
              <Separator />
              <MenuItem
                menuType={menuType}
                icon="i-ri-upload-line"
                label={t('skillSidebar.menu.importSkills')}
                onClick={() => onImportSkills?.()}
                disabled={isLoading}
                tooltip={t('skill.startTab.importSkillDesc')}
              />
            </>
          )}

          {(showRenameDelete || hasClipboard) && <Separator />}
        </>
      )}

      {!isFolder && (
        <>
          <MenuItem
            menuType={menuType}
            icon={Download02}
            label={t('skillSidebar.menu.download')}
            onClick={handleDownload}
            disabled={isLoading}
          />
          <Separator />
        </>
      )}

      {!isRoot && (
        <>
          <MenuItem
            menuType={menuType}
            icon="i-ri-scissors-line"
            label={t('skillSidebar.menu.cut')}
            kbd={KBD_CUT}
            onClick={handleCut}
            disabled={isLoading}
          />
        </>
      )}

      {isFolder && hasClipboard && (
        <MenuItem
          menuType={menuType}
          icon="i-ri-clipboard-line"
          label={t('skillSidebar.menu.paste')}
          kbd={KBD_PASTE}
          onClick={handlePaste}
          disabled={isLoading}
        />
      )}

      {showRenameDelete && (
        <>
          <Separator />
          <MenuItem
            menuType={menuType}
            icon="i-ri-edit-2-line"
            label={t('skillSidebar.menu.rename')}
            onClick={() => handleRename()}
            disabled={isLoading}
          />
          <MenuItem
            menuType={menuType}
            icon="i-ri-delete-bin-line"
            label={t('skillSidebar.menu.delete')}
            onClick={() => handleDeleteClick()}
            disabled={isLoading}
            variant="destructive"
          />
        </>
      )}

      <AlertDialog
        open={showDeleteConfirm}
        onOpenChange={(open) => {
          if (!open)
            handleDeleteCancel()
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
              disabled={isDeleting}
              onClick={() => {
                void handleDeleteConfirm()
              }}
            >
              {t('operation.confirm', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default React.memo(NodeMenu)
