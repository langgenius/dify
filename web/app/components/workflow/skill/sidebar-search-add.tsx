'use client'

import type { FC } from 'react'
import { RiAddLine, RiFile3Line, RiFolderAddLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Button from '@/app/components/base/button'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import SearchInput from '@/app/components/base/search-input'
import Toast from '@/app/components/base/toast'
import { useCreateAppAssetFile, useCreateAppAssetFolder } from '@/service/use-app-asset'
import { cn } from '@/utils/classnames'

/**
 * SidebarSearchAdd - Search input and add button for file operations
 *
 * Features:
 * - Search input for filtering files (TODO: implement filter logic)
 * - Add button with dropdown menu:
 *   - New folder: creates a folder at root level
 *   - Upload file: opens file picker to upload
 */
const SidebarSearchAdd: FC = () => {
  const { t } = useTranslation('workflow')
  const [searchValue, setSearchValue] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Get appId from app store
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''

  // Mutations
  const createFolder = useCreateAppAssetFolder()
  const createFile = useCreateAppAssetFile()

  // Handle new folder
  const handleNewFolder = useCallback(async () => {
    setShowMenu(false)
    if (!appId)
      return

    // For MVP, create folder with default name at root level
    // TODO: Add inline rename UI after creation
    const timestamp = Date.now()
    const folderName = `${t('skillSidebar.newFolder')}-${timestamp}`

    try {
      await createFolder.mutateAsync({
        appId,
        payload: {
          name: folderName,
          parent_id: null, // Root level
        },
      })
      Toast.notify({
        type: 'success',
        message: t('skillSidebar.addFolder'),
      })
    }
    catch (error) {
      Toast.notify({
        type: 'error',
        message: String(error),
      })
    }
  }, [appId, createFolder, t])

  // Handle upload file click
  const handleUploadClick = useCallback(() => {
    setShowMenu(false)
    fileInputRef.current?.click()
  }, [])

  // Handle file selection
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0 || !appId)
      return

    const file = files[0]

    try {
      await createFile.mutateAsync({
        appId,
        name: file.name,
        file,
        parentId: null, // Root level
      })
      Toast.notify({
        type: 'success',
        message: t('skillSidebar.addFile'),
      })
    }
    catch (error) {
      Toast.notify({
        type: 'error',
        message: String(error),
      })
    }

    // Reset input to allow re-uploading same file
    e.target.value = ''
  }, [appId, createFile, t])

  return (
    <div className="flex items-center gap-1 bg-components-panel-bg p-2">
      <SearchInput
        value={searchValue}
        onChange={setSearchValue}
        className="h-8 flex-1"
        placeholder={t('skillSidebar.searchPlaceholder')}
      />
      <PortalToFollowElem
        open={showMenu}
        onOpenChange={setShowMenu}
        placement="bottom-end"
        offset={{ mainAxis: 4 }}
      >
        <PortalToFollowElemTrigger onClick={() => setShowMenu(!showMenu)}>
          <Button
            variant="primary"
            size="medium"
            className={cn('!h-8 !w-8 !px-0')}
            aria-label={t('operation.add', { ns: 'common' })}
          >
            <RiAddLine className="h-4 w-4" />
          </Button>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className="z-[30]">
          <div className="flex min-w-[160px] flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]">
            {/* New Folder */}
            <div
              className="flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-state-base-hover"
              onClick={handleNewFolder}
            >
              <RiFolderAddLine className="h-4 w-4 text-text-tertiary" />
              <span className="system-sm-regular text-text-secondary">
                {t('skillSidebar.addFolder')}
              </span>
            </div>
            {/* Upload File */}
            <div
              className="flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-state-base-hover"
              onClick={handleUploadClick}
            >
              <RiFile3Line className="h-4 w-4 text-text-tertiary" />
              <span className="system-sm-regular text-text-secondary">
                {t('skillSidebar.addFile')}
              </span>
            </div>
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  )
}

export default React.memo(SidebarSearchAdd)
