'use client'

import {
  RiAddLine,
  RiFolderUploadLine,
  RiUploadLine,
} from '@remixicon/react'
import dynamic from 'next/dynamic'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { FileAdd, FolderAdd } from '@/app/components/base/icons/src/vender/line/files'
import { UploadCloud02 } from '@/app/components/base/icons/src/vender/line/general'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import SearchInput from '@/app/components/base/search-input'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
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
  const [showMenu, setShowMenu] = useState(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)

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
              icon={FileAdd}
              label={t('skillSidebar.menu.newFile')}
              onClick={handleNewFile}
              disabled={isLoading}
            />
            <MenuItem
              icon={FolderAdd}
              label={t('skillSidebar.menu.newFolder')}
              onClick={handleNewFolder}
              disabled={isLoading}
            />

            <div className="my-1 h-px bg-divider-subtle" />

            <MenuItem
              icon={UploadCloud02}
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

            <div className="my-1 h-px bg-divider-subtle" />

            <MenuItem
              icon={RiUploadLine}
              label={t('skillSidebar.menu.importSkills')}
              onClick={() => setIsImportModalOpen(true)}
              disabled={isLoading}
              tooltip={t('skill.startTab.importSkillDesc')}
            />
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
      <ImportSkillModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      />
    </div>
  )
}

export default React.memo(SidebarSearchAdd)
