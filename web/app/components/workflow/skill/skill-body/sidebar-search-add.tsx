'use client'

import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { buttonVariants } from '@/app/components/base/button'
import { FileAdd, FolderAdd } from '@/app/components/base/icons/src/vender/line/files'
import { UploadCloud02 } from '@/app/components/base/icons/src/vender/line/general'
import SearchInput from '@/app/components/base/search-input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import dynamic from '@/next/dynamic'
import { cn } from '@/utils/classnames'
import { ROOT_ID } from '../constants'
import MenuItem from '../file-tree/tree/menu-item'
import { useSkillAssetTreeData } from '../hooks/file-tree/data/use-skill-asset-tree'
import { useFileOperations } from '../hooks/file-tree/operations/use-file-operations'
import { getTargetFolderIdFromSelection } from '../utils/tree-utils'

const ImportSkillModal = dynamic(() => import('../start-tab/import-skill-modal'), {
  ssr: false,
})

const SidebarSearchAdd = () => {
  const { t } = useTranslation('workflow')
  const searchValue = useStore(s => s.fileTreeSearchTerm)
  const storeApi = useWorkflowStore()
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)

  const { data: treeData } = useSkillAssetTreeData()
  const selectedTreeNodeId = useStore(s => s.selectedTreeNodeId)
  const treeChildren = treeData?.children

  const targetFolderId = useMemo(() => {
    if (!treeChildren)
      return ROOT_ID
    return getTargetFolderIdFromSelection(selectedTreeNodeId, treeChildren)
  }, [selectedTreeNodeId, treeChildren])
  const isRootTarget = targetFolderId === ROOT_ID
  const handleMenuClose = useCallback(() => {}, [])

  const {
    fileInputRef,
    folderInputRef,
    isLoading,
    handleNewFile,
    handleNewFolder,
    handleFileChange,
    handleFolderChange,
  } = useFileOperations({
    nodeId: targetFolderId,
    onClose: handleMenuClose,
  })

  const handleCreateFile = useCallback(() => {
    storeApi.getState().setFileTreeSearchTerm('')
    handleNewFile()
  }, [handleNewFile, storeApi])

  const handleCreateFolder = useCallback(() => {
    storeApi.getState().setFileTreeSearchTerm('')
    handleNewFolder()
  }, [handleNewFolder, storeApi])

  return (
    <div className="flex items-center gap-1 p-2">
      <SearchInput
        value={searchValue}
        onChange={v => storeApi.getState().setFileTreeSearchTerm(v)}
        className="!h-6 flex-1 !rounded-md"
        placeholder={t('skillSidebar.searchPlaceholder')}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          type="button"
          aria-label={t('operation.add', { ns: 'common' })}
          className={cn(
            buttonVariants({ variant: 'primary', size: 'small' }),
            '!size-6 shrink-0 !p-1',
          )}
        >
          <span className="i-ri-add-line size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="bottom-end"
          sideOffset={4}
          popupClassName="min-w-[180px]"
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
          <input
            ref={folderInputRef}
            type="file"
            // @ts-expect-error webkitdirectory is a non-standard attribute
            webkitdirectory=""
            className="hidden"
            onChange={handleFolderChange}
          />

          <MenuItem
            menuType="dropdown"
            icon={FileAdd}
            label={t('skillSidebar.menu.newFile')}
            onClick={handleCreateFile}
            disabled={isLoading}
          />
          <MenuItem
            menuType="dropdown"
            icon={FolderAdd}
            label={t('skillSidebar.menu.newFolder')}
            onClick={handleCreateFolder}
            disabled={isLoading}
          />

          <DropdownMenuSeparator />

          <MenuItem
            menuType="dropdown"
            icon={UploadCloud02}
            label={t('skillSidebar.menu.uploadFile')}
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
          />
          <MenuItem
            menuType="dropdown"
            icon="i-ri-folder-upload-line"
            label={t('skillSidebar.menu.uploadFolder')}
            onClick={() => folderInputRef.current?.click()}
            disabled={isLoading}
          />

          {isRootTarget
            ? (
                <>
                  <DropdownMenuSeparator />

                  <MenuItem
                    menuType="dropdown"
                    icon="i-ri-upload-line"
                    label={t('skillSidebar.menu.importSkills')}
                    onClick={() => setIsImportModalOpen(true)}
                    disabled={isLoading}
                    tooltip={t('skill.startTab.importSkillDesc')}
                  />
                </>
              )
            : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ImportSkillModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      />
    </div>
  )
}

export default React.memo(SidebarSearchAdd)
