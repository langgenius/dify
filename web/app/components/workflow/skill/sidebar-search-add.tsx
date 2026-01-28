'use client'

import {
  RiAddLine,
  RiFileAddLine,
  RiFolderAddLine,
  RiFolderUploadLine,
  RiUploadLine,
} from '@remixicon/react'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import SearchInput from '@/app/components/base/search-input'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { cn } from '@/utils/classnames'
import { ROOT_ID } from './constants'
import { useFileOperations } from './hooks/use-file-operations'
import { useSkillAssetTreeData } from './hooks/use-skill-asset-tree'
import { getTargetFolderIdFromSelection } from './utils/tree-utils'

type MenuItemProps = {
  icon: React.ElementType
  label: string
  onClick: () => void
  disabled?: boolean
}

const MenuItem = ({ icon: Icon, label, onClick, disabled }: MenuItemProps) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'flex w-full items-center gap-2 rounded-lg px-3 py-2',
      'hover:bg-state-base-hover disabled:cursor-not-allowed disabled:opacity-50',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-components-input-border-active',
    )}
  >
    <Icon className="size-4 text-text-tertiary" aria-hidden="true" />
    <span className="system-sm-regular text-text-secondary">
      {label}
    </span>
  </button>
)

const SidebarSearchAdd = () => {
  const { t } = useTranslation('workflow')
  const searchValue = useStore(s => s.fileTreeSearchTerm)
  const storeApi = useWorkflowStore()
  const [showMenu, setShowMenu] = useState(false)

  const { data: treeData } = useSkillAssetTreeData()
  const selectedTreeNodeId = useStore(s => s.selectedTreeNodeId)
  const treeChildren = treeData?.children

  const targetFolderId = useMemo(() => {
    if (!treeChildren)
      return ROOT_ID
    return getTargetFolderIdFromSelection(selectedTreeNodeId, treeChildren)
  }, [selectedTreeNodeId, treeChildren])
  const menuOffset = useMemo(() => ({ mainAxis: 4 }), [])

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
    onClose: () => setShowMenu(false),
  })

  return (
    <div className="flex items-center gap-1 p-2">
      <SearchInput
        value={searchValue}
        onChange={v => storeApi.getState().setFileTreeSearchTerm(v)}
        className="!h-6 flex-1 !rounded-md"
        placeholder={t('skillSidebar.searchPlaceholder')}
      />
      <PortalToFollowElem
        open={showMenu}
        onOpenChange={setShowMenu}
        placement="bottom-end"
        offset={menuOffset}
      >
        <PortalToFollowElemTrigger onClick={() => setShowMenu(!showMenu)}>
          <Button
            variant="primary"
            size="small"
            className="!size-6 shrink-0 !p-1"
            aria-label={t('operation.add', { ns: 'common' })}
          >
            <RiAddLine className="size-4" aria-hidden="true" />
          </Button>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className="z-[30]">
          <div className="flex min-w-[180px] flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]">
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
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div>
  )
}

export default React.memo(SidebarSearchAdd)
