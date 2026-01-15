'use client'

import type { FC } from 'react'
import { RiFileAddLine, RiFolderAddLine, RiFolderUploadLine, RiUploadLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Toast from '@/app/components/base/toast'
import { useCreateAppAssetFile, useCreateAppAssetFolder } from '@/service/use-app-asset'
import { cn } from '@/utils/classnames'

/**
 * FileOperationsMenu - Menu content for file operations
 *
 * Shared by both context menu (right-click) and dropdown menu (... button)
 *
 * Features:
 * - New File: Create empty file (via empty Blob upload)
 * - New Folder: Create folder in target location
 * - Upload File: Upload file(s) to target folder
 * - Upload Folder: Upload entire folder structure (webkitdirectory)
 */

type MenuItemProps = {
  icon: React.ElementType
  label: string
  onClick: () => void
  disabled?: boolean
}

const MenuItem: React.FC<MenuItemProps> = ({ icon: Icon, label, onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'flex w-full items-center gap-2 rounded-lg px-3 py-2',
      'hover:bg-state-base-hover disabled:cursor-not-allowed disabled:opacity-50',
    )}
  >
    <Icon className="size-4 text-text-tertiary" />
    <span className="system-sm-regular text-text-secondary">
      {label}
    </span>
  </button>
)

type FileOperationsMenuProps = {
  /** Target folder ID, or 'root' for root level */
  nodeId: string
  /** Callback to close menu after action */
  onClose: () => void
  /** Optional className */
  className?: string
}

const FileOperationsMenu: FC<FileOperationsMenuProps> = ({
  nodeId,
  onClose,
  className,
}) => {
  const { t } = useTranslation('workflow')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  // Get appId from app store
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''

  // Mutations
  const createFolder = useCreateAppAssetFolder()
  const createFile = useCreateAppAssetFile()

  // Determine parent_id (null for root)
  const parentId = nodeId === 'root' ? null : nodeId

  // Handle New File
  const handleNewFile = useCallback(async () => {
    // eslint-disable-next-line no-alert -- MVP: Using prompt for simplicity, will be replaced with modal later
    const fileName = window.prompt(t('skillSidebar.menu.newFilePrompt'))
    if (!fileName || !fileName.trim()) {
      onClose()
      return
    }

    try {
      // Create empty Blob and upload as file
      const emptyBlob = new Blob([''], { type: 'text/plain' })
      const file = new File([emptyBlob], fileName.trim())

      await createFile.mutateAsync({
        appId,
        name: fileName.trim(),
        file,
        parentId,
      })

      Toast.notify({
        type: 'success',
        message: t('skillSidebar.menu.fileCreated'),
      })
    }
    catch {
      Toast.notify({
        type: 'error',
        message: t('skillSidebar.menu.createError'),
      })
    }
    finally {
      onClose()
    }
  }, [appId, createFile, onClose, parentId, t])

  // Handle New Folder
  const handleNewFolder = useCallback(async () => {
    // eslint-disable-next-line no-alert -- MVP: Using prompt for simplicity, will be replaced with modal later
    const folderName = window.prompt(t('skillSidebar.menu.newFolderPrompt'))
    if (!folderName || !folderName.trim()) {
      onClose()
      return
    }

    try {
      await createFolder.mutateAsync({
        appId,
        payload: {
          name: folderName.trim(),
          parent_id: parentId,
        },
      })

      Toast.notify({
        type: 'success',
        message: t('skillSidebar.menu.folderCreated'),
      })
    }
    catch {
      Toast.notify({
        type: 'error',
        message: t('skillSidebar.menu.createError'),
      })
    }
    finally {
      onClose()
    }
  }, [appId, createFolder, onClose, parentId, t])

  // Handle file input change (single or multiple files)
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) {
      onClose()
      return
    }

    try {
      // Upload files sequentially to avoid overwhelming the server
      for (const file of files) {
        await createFile.mutateAsync({
          appId,
          name: file.name,
          file,
          parentId,
        })
      }

      Toast.notify({
        type: 'success',
        message: t('skillSidebar.menu.filesUploaded', { count: files.length }),
      })
    }
    catch {
      Toast.notify({
        type: 'error',
        message: t('skillSidebar.menu.uploadError'),
      })
    }
    finally {
      // Reset input to allow re-uploading same file
      e.target.value = ''
      onClose()
    }
  }, [appId, createFile, onClose, parentId, t])

  // Handle folder input change (webkitdirectory)
  const handleFolderChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) {
      onClose()
      return
    }

    try {
      // Collect all unique folder paths from file paths
      const folders = new Set<string>()

      for (const file of files) {
        const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
        const parts = relativePath.split('/')

        // Collect all folder paths (parent directories)
        if (parts.length > 1) {
          let folderPath = ''
          for (let i = 0; i < parts.length - 1; i++) {
            folderPath = folderPath ? `${folderPath}/${parts[i]}` : parts[i]
            folders.add(folderPath)
          }
        }
      }

      // Sort folders by depth (parent before child)
      const sortedFolders = Array.from(folders).sort((a, b) => {
        return a.split('/').length - b.split('/').length
      })

      // Create folders and track their IDs
      const folderIdMap = new Map<string, string | null>()
      folderIdMap.set('', parentId) // Root maps to target parent

      for (const folderPath of sortedFolders) {
        const parts = folderPath.split('/')
        const folderName = parts[parts.length - 1]
        const parentPath = parts.slice(0, -1).join('/')
        const parentFolderId = folderIdMap.get(parentPath) ?? parentId

        const result = await createFolder.mutateAsync({
          appId,
          payload: {
            name: folderName,
            parent_id: parentFolderId,
          },
        })

        folderIdMap.set(folderPath, result.id)
      }

      // Upload files to their respective folders
      for (const file of files) {
        const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
        const parts = relativePath.split('/')
        const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : ''
        const targetParentId = folderIdMap.get(parentPath) ?? parentId

        await createFile.mutateAsync({
          appId,
          name: file.name,
          file,
          parentId: targetParentId,
        })
      }

      Toast.notify({
        type: 'success',
        message: t('skillSidebar.menu.folderUploaded'),
      })
    }
    catch {
      Toast.notify({
        type: 'error',
        message: t('skillSidebar.menu.uploadError'),
      })
    }
    finally {
      // Reset input
      e.target.value = ''
      onClose()
    }
  }, [appId, createFile, createFolder, onClose, parentId, t])

  const isLoading = createFile.isPending || createFolder.isPending

  return (
    <div className={cn(
      'min-w-[180px] rounded-xl border-[0.5px] border-components-panel-border',
      'bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]',
      className,
    )}
    >
      {/* Hidden file inputs */}
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

      {/* Divider */}
      <div className="my-1 h-px bg-divider-subtle" />

      <MenuItem
        icon={RiUploadLine}
        label={t('skillSidebar.menu.uploadFile')}
        onClick={() => fileInputRef.current?.click()}
        disabled={isLoading}
      />
      <MenuItem
        icon={RiFolderUploadLine}
        label={t('skillSidebar.menu.uploadFolder')}
        onClick={() => folderInputRef.current?.click()}
        disabled={isLoading}
      />
    </div>
  )
}

export default React.memo(FileOperationsMenu)
