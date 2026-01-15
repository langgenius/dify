'use client'

import type { FC } from 'react'
import * as React from 'react'
import { cn } from '@/utils/classnames'
import EditorTabItem from './editor-tab-item'
import { useSkillAssetNodeMap } from './hooks/use-skill-asset-tree'
import { useSkillEditorStore, useSkillEditorStoreApi } from './store'

const EditorTabs: FC = () => {
  const openTabIds = useSkillEditorStore(s => s.openTabIds)
  const activeTabId = useSkillEditorStore(s => s.activeTabId)
  const dirtyContents = useSkillEditorStore(s => s.dirtyContents)
  const storeApi = useSkillEditorStoreApi()
  const { data: nodeMap } = useSkillAssetNodeMap()

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
        const node = nodeMap?.get(fileId)
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
