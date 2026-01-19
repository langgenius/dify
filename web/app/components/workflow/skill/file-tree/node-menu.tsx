'use client'

import type { FC } from 'react'
import type { NodeApi, TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../type'
import {
  RiDeleteBinLine,
  RiEdit2Line,
  RiFileAddLine,
  RiFolderAddLine,
  RiFolderUploadLine,
  RiUploadLine,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Confirm from '@/app/components/base/confirm'
import { cn } from '@/utils/classnames'
import { useFileOperations } from '../hooks/use-file-operations'
import MenuItem from './menu-item'

export const MENU_CONTAINER_STYLES = [
  'min-w-[180px] rounded-xl border-[0.5px] border-components-panel-border',
  'bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]',
] as const

type NodeMenuProps = {
  type: 'file' | 'folder' | 'root'
  nodeId?: string
  onClose: () => void
  className?: string
  treeRef?: React.RefObject<TreeApi<TreeNodeData> | null>
  node?: NodeApi<TreeNodeData>
}

const NodeMenu: FC<NodeMenuProps> = ({
  type,
  nodeId,
  onClose,
  className,
  treeRef,
  node,
}) => {
  const { t } = useTranslation('workflow')
  const isRoot = type === 'root'
  const isFolder = type === 'folder' || isRoot

  const {
    fileInputRef,
    folderInputRef,
    showDeleteConfirm,
    isLoading,
    isDeleting,
    handleNewFile,
    handleNewFolder,
    handleFileChange,
    handleFolderChange,
    handleRename,
    handleDeleteClick,
    handleDeleteConfirm,
    handleDeleteCancel,
  } = useFileOperations({ nodeId, onClose, treeRef, node })

  const showRenameDelete = isFolder ? !isRoot : true
  const deleteConfirmTitle = isFolder
    ? t('skillSidebar.menu.deleteConfirmTitle')
    : t('skillSidebar.menu.fileDeleteConfirmTitle')
  const deleteConfirmContent = isFolder
    ? t('skillSidebar.menu.deleteConfirmContent')
    : t('skillSidebar.menu.fileDeleteConfirmContent')

  return (
    <div className={cn(MENU_CONTAINER_STYLES, className)}>
      {isFolder && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
          {!isRoot && (
            <input
              ref={folderInputRef}
              type="file"
              // @ts-expect-error webkitdirectory is a non-standard attribute
              webkitdirectory=""
              className="hidden"
              onChange={handleFolderChange}
            />
          )}

          <MenuItem
            icon={RiFileAddLine}
            label={t('skillSidebar.menu.newFile')}
            onClick={handleNewFile}
            disabled={isLoading}
          />
          <MenuItem
            icon={RiFolderAddLine}
            label={t('skillSidebar.menu.newFolder')}
            onClick={handleNewFolder}
            disabled={isLoading}
          />

          <div className="my-1 h-px bg-divider-subtle" />

          <MenuItem
            icon={RiUploadLine}
            label={t('skillSidebar.menu.uploadFile')}
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
          />
          {!isRoot && (
            <MenuItem
              icon={RiFolderUploadLine}
              label={t('skillSidebar.menu.uploadFolder')}
              onClick={() => folderInputRef.current?.click()}
              disabled={isLoading}
            />
          )}

          {showRenameDelete && <div className="my-1 h-px bg-divider-subtle" />}
        </>
      )}

      {showRenameDelete && (
        <>
          <MenuItem
            icon={RiEdit2Line}
            label={t('skillSidebar.menu.rename')}
            onClick={handleRename}
            disabled={isLoading}
          />
          <MenuItem
            icon={RiDeleteBinLine}
            label={t('skillSidebar.menu.delete')}
            onClick={handleDeleteClick}
            disabled={isLoading}
            variant="destructive"
          />
        </>
      )}

      <Confirm
        isShow={showDeleteConfirm}
        type="danger"
        title={deleteConfirmTitle}
        content={deleteConfirmContent}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
        isLoading={isDeleting}
      />
    </div>
  )
}

export default React.memo(NodeMenu)
