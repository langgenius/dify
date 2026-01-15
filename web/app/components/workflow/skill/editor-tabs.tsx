'use client'

import type { FC } from 'react'
import type { AppAssetTreeView } from '@/types/app-asset'
import * as React from 'react'
import { useMemo } from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useGetAppAssetTree } from '@/service/use-app-asset'
import { cn } from '@/utils/classnames'
import EditorTabItem from './editor-tab-item'
import { useSkillEditorStore, useSkillEditorStoreApi } from './store'
import { buildNodeMap } from './utils/tree-utils'

const EditorTabs: FC = () => {
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''

  const { data: treeData } = useGetAppAssetTree(appId)

  const openTabIds = useSkillEditorStore(s => s.openTabIds)
  const activeTabId = useSkillEditorStore(s => s.activeTabId)
  const dirtyContents = useSkillEditorStore(s => s.dirtyContents)
  const storeApi = useSkillEditorStoreApi()

  const nodeMap = useMemo(() => {
    if (!treeData?.children)
      return new Map<string, AppAssetTreeView>()
    return buildNodeMap(treeData.children)
  }, [treeData?.children])

  const handleTabClick = (fileId: string) => {
    storeApi.getState().activateTab(fileId)
  }

  const handleTabClose = (fileId: string) => {
    storeApi.getState().closeTab(fileId)
    storeApi.getState().clearDraftContent(fileId)
  }

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
        const isActive = activeTabId === fileId
        const isDirty = dirtyContents.has(fileId)

        return (
          <EditorTabItem
            key={fileId}
            fileId={fileId}
            name={name}
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
