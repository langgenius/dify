'use client'

import type { FC } from 'react'
import type { AppAssetTreeView } from './type'
import * as React from 'react'
import { useMemo } from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useGetAppAssetTree } from '@/service/use-app-asset'
import { cn } from '@/utils/classnames'
import EditorTabItem from './editor-tab-item'
import { useSkillEditorStore, useSkillEditorStoreApi } from './store'
import { buildNodeMap } from './type'

/**
 * EditorTabs - Tab bar for open files
 *
 * Features:
 * - Displays open tabs from store
 * - Click to activate, close button to remove
 * - Shows dirty indicator for unsaved files
 * - Derives tab names from tree data (fileId -> file.name)
 */

const EditorTabs: FC = () => {
  // Get appId
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''

  // Get tree data for deriving file names
  const { data: treeData } = useGetAppAssetTree(appId)

  // Store state
  const openTabIds = useSkillEditorStore(s => s.openTabIds)
  const activeTabId = useSkillEditorStore(s => s.activeTabId)
  const dirtyContents = useSkillEditorStore(s => s.dirtyContents)
  const storeApi = useSkillEditorStoreApi()

  // Build node map for quick lookup
  const nodeMap = useMemo(() => {
    if (!treeData?.children)
      return new Map<string, AppAssetTreeView>()
    return buildNodeMap(treeData.children)
  }, [treeData?.children])

  // Handle tab click
  const handleTabClick = (fileId: string) => {
    storeApi.getState().activateTab(fileId)
  }

  // Handle tab close
  const handleTabClose = (fileId: string) => {
    // MVP: No dirty confirmation, just close
    // TODO: Add confirmation dialog when file is dirty
    storeApi.getState().closeTab(fileId)
    // Clear dirty content if exists
    storeApi.getState().clearDraftContent(fileId)
  }

  // No tabs open - don't render
  if (openTabIds.length === 0)
    return null

  return (
    <div
      className={cn(
        'flex items-center overflow-hidden rounded-t-lg border-b border-components-panel-border-subtle bg-components-panel-bg-alt',
      )}
    >
      {openTabIds.map((fileId) => {
        const node = nodeMap.get(fileId)
        const name = node?.name ?? fileId
        const extension = node?.extension ?? ''
        const isActive = activeTabId === fileId
        const isDirty = dirtyContents.has(fileId)

        return (
          <EditorTabItem
            key={fileId}
            fileId={fileId}
            name={name}
            extension={extension}
            isActive={isActive}
            isDirty={isDirty}
            onClick={handleTabClick}
            onClose={handleTabClose}
          />
        )
      })}
    </div>
  )
}

export default React.memo(EditorTabs)
