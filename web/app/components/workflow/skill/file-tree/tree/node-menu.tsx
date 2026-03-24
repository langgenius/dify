'use client'

import type { NodeMenuType } from '../../constants'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { FileAdd, FolderAdd } from '@/app/components/base/icons/src/vender/line/files'
import { UploadCloud02 } from '@/app/components/base/icons/src/vender/line/general'
import { Download02 } from '@/app/components/base/icons/src/vender/solid/general'
import {
  ContextMenuSeparator,
} from '@/app/components/base/ui/context-menu'
import {
  DropdownMenuSeparator,
} from '@/app/components/base/ui/dropdown-menu'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { NODE_MENU_TYPE } from '../../constants'
import MenuItem from './menu-item'

const KBD_CUT = ['ctrl', 'x'] as const
const KBD_PASTE = ['ctrl', 'v'] as const

type NodeMenuProps = {
  type: NodeMenuType
  menuType: 'dropdown' | 'context'
  nodeId?: string
  onClose: () => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  folderInputRef: React.RefObject<HTMLInputElement | null>
  isLoading: boolean
  onDownload: () => void
  onNewFile: () => void
  onNewFolder: () => void
  onFileChange: React.ChangeEventHandler<HTMLInputElement>
  onFolderChange: React.ChangeEventHandler<HTMLInputElement>
  onRename: () => void
  onDeleteClick: () => void
  onImportSkills?: () => void
}

const NodeMenu = ({
  type,
  menuType,
  nodeId,
  onClose,
  fileInputRef,
  folderInputRef,
  isLoading,
  onDownload,
  onNewFile,
  onNewFolder,
  onFileChange,
  onFolderChange,
  onRename,
  onDeleteClick,
  onImportSkills,
}: NodeMenuProps) => {
  const { t } = useTranslation('workflow')
  const storeApi = useWorkflowStore()
  const selectedNodeIds = useStore(s => s.selectedNodeIds)
  const hasClipboard = useStore(s => s.hasClipboard())
  const isRoot = type === NODE_MENU_TYPE.ROOT
  const isFolder = type === NODE_MENU_TYPE.FOLDER || isRoot

  const currentNodeId = nodeId

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
            onChange={onFileChange}
          />
          <input
            ref={folderInputRef}
            type="file"
            // @ts-expect-error webkitdirectory is a non-standard attribute
            webkitdirectory=""
            className="hidden"
            aria-label={t('skillSidebar.menu.uploadFolder')}
            onChange={onFolderChange}
          />

          <MenuItem
            menuType={menuType}
            icon={FileAdd}
            label={t('skillSidebar.menu.newFile')}
            onClick={onNewFile}
            disabled={isLoading}
          />
          <MenuItem
            menuType={menuType}
            icon={FolderAdd}
            label={t('skillSidebar.menu.newFolder')}
            onClick={onNewFolder}
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
            onClick={onDownload}
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
            onClick={onRename}
            disabled={isLoading}
          />
          <MenuItem
            menuType={menuType}
            icon="i-ri-delete-bin-line"
            label={t('skillSidebar.menu.delete')}
            onClick={onDeleteClick}
            disabled={isLoading}
            variant="destructive"
          />
        </>
      )}
    </>
  )
}

export default React.memo(NodeMenu)
