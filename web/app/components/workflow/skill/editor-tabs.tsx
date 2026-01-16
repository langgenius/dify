'use client'

import type { FC } from 'react'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Confirm from '@/app/components/base/confirm'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { cn } from '@/utils/classnames'
import EditorTabItem from './editor-tab-item'
import { useSkillAssetNodeMap } from './hooks/use-skill-asset-tree'

const EditorTabs: FC = () => {
  const { t } = useTranslation('workflow')
  const openTabIds = useStore(s => s.openTabIds)
  const activeTabId = useStore(s => s.activeTabId)
  const previewTabId = useStore(s => s.previewTabId)
  const dirtyContents = useStore(s => s.dirtyContents)
  const storeApi = useWorkflowStore()
  const { data: nodeMap } = useSkillAssetNodeMap()

  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null)

  const handleTabClick = useCallback((fileId: string) => {
    storeApi.getState().activateTab(fileId)
  }, [storeApi])

  const handleTabDoubleClick = useCallback((fileId: string) => {
    storeApi.getState().pinTab(fileId)
  }, [storeApi])

  const closeTab = useCallback((fileId: string) => {
    storeApi.getState().closeTab(fileId)
    storeApi.getState().clearDraftContent(fileId)
  }, [storeApi])

  const handleTabClose = useCallback((fileId: string) => {
    if (dirtyContents.has(fileId)) {
      setPendingCloseId(fileId)
      return
    }
    closeTab(fileId)
  }, [dirtyContents, closeTab])

  const handleConfirmClose = useCallback(() => {
    if (pendingCloseId) {
      closeTab(pendingCloseId)
      setPendingCloseId(null)
    }
  }, [pendingCloseId, closeTab])

  const handleCancelClose = useCallback(() => {
    setPendingCloseId(null)
  }, [])

  if (openTabIds.length === 0)
    return null

  return (
    <>
      <div
        className={cn(
          'flex items-center overflow-hidden rounded-t-lg border-b border-components-panel-border-subtle bg-components-panel-bg-alt',
        )}
      >
        {openTabIds.map((fileId) => {
          const node = nodeMap?.get(fileId)
          const name = node?.name ?? fileId
          const isActive = activeTabId === fileId
          const isDirty = dirtyContents.has(fileId)
          const isPreview = previewTabId === fileId

          return (
            <EditorTabItem
              key={fileId}
              fileId={fileId}
              name={name}
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

export default React.memo(EditorTabs)
