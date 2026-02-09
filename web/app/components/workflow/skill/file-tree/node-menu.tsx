'use client'

import type { FC } from 'react'
import type { NodeApi, TreeApi } from 'react-arborist'
import type { NodeMenuType } from '../constants'
import type { TreeNodeData } from '../type'
import {
  RiClipboardLine,
  RiDeleteBinLine,
  RiEdit2Line,
  RiFileAddLine,
  RiFileCopyLine,
  RiFolderAddLine,
  RiFolderUploadLine,
  RiScissorsLine,
  RiUploadLine,
} from '@remixicon/react'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Confirm from '@/app/components/base/confirm'
import { Download02 } from '@/app/components/base/icons/src/vender/solid/general'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { cn } from '@/utils/classnames'
import { NODE_MENU_TYPE } from '../constants'
import { useFileOperations } from '../hooks/use-file-operations'
import MenuItem from './menu-item'

export const MENU_CONTAINER_STYLES = [
  'min-w-[180px] rounded-xl border-[0.5px] border-components-panel-border',
  'bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]',
] as const

const KBD_COPY = ['ctrl', 'c'] as const
const KBD_CUT = ['ctrl', 'x'] as const
const KBD_PASTE = ['ctrl', 'v'] as const

type NodeMenuProps = {
  type: NodeMenuType
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

  const handleCopy = useCallback(() => {
    const ids = selectedNodeIds.size > 0 ? [...selectedNodeIds] : (currentNodeId ? [currentNodeId] : [])
    if (ids.length > 0) {
      storeApi.getState().copyNodes(ids)
      onClose()
    }
  }, [currentNodeId, onClose, selectedNodeIds, storeApi])

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

  return (
    <div className={cn(MENU_CONTAINER_STYLES, className)}>
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
          {!isRoot && (
            <input
              ref={folderInputRef}
              type="file"
              // @ts-expect-error webkitdirectory is a non-standard attribute
              webkitdirectory=""
              className="hidden"
              aria-label={t('skillSidebar.menu.uploadFolder')}
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

      {!isFolder && (
        <>
          <MenuItem
            icon={Download02}
            label={t('skillSidebar.menu.download')}
            onClick={handleDownload}
            disabled={isLoading}
          />
          <div className="my-1 h-px bg-divider-subtle" />
        </>
      )}

      {!isRoot && (
        <>
          <MenuItem
            icon={RiFileCopyLine}
            label={t('skillSidebar.menu.copy')}
            kbd={KBD_COPY}
            onClick={handleCopy}
            disabled={isLoading}
          />
          <MenuItem
            icon={RiScissorsLine}
            label={t('skillSidebar.menu.cut')}
            kbd={KBD_CUT}
            onClick={handleCut}
            disabled={isLoading}
          />
        </>
      )}

      {isFolder && (
        <MenuItem
          icon={RiClipboardLine}
          label={t('skillSidebar.menu.paste')}
          kbd={KBD_PASTE}
          onClick={handlePaste}
          disabled={isLoading || !hasClipboard}
        />
      )}

      {showRenameDelete && (
        <>
          <div className="my-1 h-px bg-divider-subtle" />
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
