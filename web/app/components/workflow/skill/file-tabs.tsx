'use client'

import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Confirm from '@/app/components/base/confirm'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { cn } from '@/utils/classnames'
import { getArtifactPath, isArtifactTab, START_TAB_ID } from './constants'
import FileTabItem from './file-tab-item'
import { useSkillAssetNodeMap } from './hooks/use-skill-asset-tree'
import StartTabItem from './start-tab-item'
import { getFileExtension } from './utils/file-utils'

const FileTabs = () => {
  const { t } = useTranslation('workflow')
  const openTabIds = useStore(s => s.openTabIds)
  const activeTabId = useStore(s => s.activeTabId)
  const previewTabId = useStore(s => s.previewTabId)
  const dirtyContents = useStore(s => s.dirtyContents)
  const dirtyMetadataIds = useStore(s => s.dirtyMetadataIds)
  const storeApi = useWorkflowStore()
  const { data: nodeMap } = useSkillAssetNodeMap()

  const isStartTabActive = activeTabId === START_TAB_ID

  const handleStartTabClick = useCallback(() => {
    storeApi.getState().activateTab(START_TAB_ID)
  }, [storeApi])

  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null)

  const handleTabClick = useCallback((fileId: string) => {
    storeApi.getState().activateTab(fileId)
  }, [storeApi])

  const handleTabDoubleClick = useCallback((fileId: string) => {
    storeApi.getState().pinTab(fileId)
  }, [storeApi])

  const closeTab = useCallback((fileId: string) => {
    if (isArtifactTab(fileId))
      storeApi.getState().clearArtifactSelection()
    storeApi.getState().closeTab(fileId)
    storeApi.getState().clearDraftContent(fileId)
    storeApi.getState().clearFileMetadata(fileId)
  }, [storeApi])

  const handleTabClose = useCallback((fileId: string) => {
    if (dirtyContents.has(fileId) || dirtyMetadataIds.has(fileId)) {
      setPendingCloseId(fileId)
      return
    }
    closeTab(fileId)
  }, [dirtyContents, dirtyMetadataIds, closeTab])

  const handleConfirmClose = useCallback(() => {
    if (pendingCloseId) {
      closeTab(pendingCloseId)
      setPendingCloseId(null)
    }
  }, [pendingCloseId, closeTab])

  const handleCancelClose = useCallback(() => {
    setPendingCloseId(null)
  }, [])

  return (
    <>
      <div
        className={cn(
          'flex items-center overflow-hidden rounded-t-lg border-b border-components-panel-border-subtle bg-components-panel-bg-alt',
        )}
      >
        <StartTabItem
          isActive={isStartTabActive}
          onClick={handleStartTabClick}
        />
        {openTabIds.map((fileId) => {
          const isArtifact = isArtifactTab(fileId)
          const node = isArtifact ? undefined : nodeMap?.get(fileId)
          const artifactFileName = isArtifact ? getArtifactPath(fileId).split('/').pop() ?? fileId : undefined
          const name = isArtifact ? artifactFileName! : (node?.name ?? fileId)
          const extension = isArtifact ? getFileExtension(artifactFileName!) : node?.extension
          const isActive = activeTabId === fileId
          const isDirty = dirtyContents.has(fileId) || dirtyMetadataIds.has(fileId)
          const isPreview = previewTabId === fileId

          return (
            <FileTabItem
              key={fileId}
              fileId={fileId}
              name={name}
              extension={extension}
              isActive={isActive}
              isDirty={isDirty}
              isPreview={isPreview}
              onClick={handleTabClick}
              onClose={handleTabClose}
              onDoubleClick={handleTabDoubleClick}
            />
          )
        })}
      </div>
      <Confirm
        isShow={pendingCloseId !== null}
        type="warning"
        title={t('skillSidebar.unsavedChanges.title')}
        content={t('skillSidebar.unsavedChanges.content')}
        confirmText={t('skillSidebar.unsavedChanges.confirmClose')}
        onConfirm={handleConfirmClose}
        onCancel={handleCancelClose}
      />
    </>
  )
}

export default React.memo(FileTabs)
