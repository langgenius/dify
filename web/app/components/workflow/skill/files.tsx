'use client'

import type { NodeApi, TreeApi } from 'react-arborist'
import type { TreeNodeData } from './type'
import { RiDragDropLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Tree } from 'react-arborist'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'
import Toast from '@/app/components/base/toast'
import { useGetAppAssetTree, useRenameAppAssetNode } from '@/service/use-app-asset'
import { cn } from '@/utils/classnames'
import FileTreeContextMenu from './file-tree-context-menu'
import FileTreeNode from './file-tree-node'
import { useSkillEditorStore, useSkillEditorStoreApi } from './store'
import { getAncestorIds, toOpensObject } from './type'

/**
 * Files - File tree component using react-arborist
 *
 * Key features:
 * - Controlled open state via TreeApi (synced with SkillEditorStore)
 * - Click to select, double-click to open in tab
 * - Auto-expand when tab is activated
 * - Virtual scrolling for large trees
 *
 * Design specs from Figma:
 * - Row height: 24px
 * - Indent: 20px
 * - Container padding: 4px
 */

type FilesProps = {
  className?: string
}

const DropTip = () => {
  const { t } = useTranslation('workflow')
  return (
    <div className="flex shrink-0 items-center justify-center gap-2 py-4 text-text-quaternary">
      <RiDragDropLine className="size-4" />
      <span className="system-xs-regular">
        {t('skillSidebar.dropTip')}
      </span>
    </div>
  )
}

const Files: React.FC<FilesProps> = ({ className }) => {
  const { t } = useTranslation('workflow')
  const treeRef = useRef<TreeApi<TreeNodeData>>(null)

  // Get appId from app store
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''

  // Fetch tree data from API
  const { data: treeData, isLoading, error } = useGetAppAssetTree(appId)

  // Store state and actions
  const expandedFolderIds = useSkillEditorStore(s => s.expandedFolderIds)
  const activeTabId = useSkillEditorStore(s => s.activeTabId)
  const storeApi = useSkillEditorStoreApi()

  // Rename mutation for inline editing
  const renameNode = useRenameAppAssetNode()

  // Convert Set to react-arborist OpenMap for initial state
  const initialOpenState = useMemo(() => toOpensObject(expandedFolderIds), [expandedFolderIds])

  // Handle toggle event from react-arborist
  const handleToggle = useCallback((id: string) => {
    storeApi.getState().toggleFolder(id)
  }, [storeApi])

  // Handle node activation (double-click or Enter)
  const handleActivate = useCallback((node: NodeApi<TreeNodeData>) => {
    if (node.data.node_type === 'file') {
      // Open file in tab
      storeApi.getState().openTab(node.data.id)
    }
    else {
      // For folders, toggle open state
      node.toggle()
    }
  }, [storeApi])

  // Handle rename from react-arborist inline editing
  const handleRename = useCallback(({ id, name }: { id: string, name: string }) => {
    renameNode.mutateAsync({
      appId,
      nodeId: id,
      payload: { name },
    }).catch(() => {
      Toast.notify({
        type: 'error',
        message: t('skillSidebar.menu.renameError'),
      })
    })
  }, [appId, renameNode, t])

  // Auto-reveal when activeTabId changes (sync from tab click to tree)
  useEffect(() => {
    if (!activeTabId || !treeData?.children || !treeRef.current)
      return

    const ancestors = getAncestorIds(activeTabId, treeData.children)

    // Update store for state persistence
    if (ancestors.length > 0)
      storeApi.getState().revealFile(ancestors)

    // Use Tree API for immediate UI update (initialOpenState only applies on first render)
    const timeoutId = setTimeout(() => {
      const tree = treeRef.current
      if (!tree)
        return

      // Open all ancestor folders
      for (const ancestorId of ancestors) {
        const ancestorNode = tree.get(ancestorId)
        if (ancestorNode && !ancestorNode.isOpen)
          ancestorNode.open()
      }

      // Select the target node
      const node = tree.get(activeTabId)
      if (node)
        node.select()
    }, 0)

    return () => clearTimeout(timeoutId)
  }, [activeTabId, treeData?.children, storeApi])

  // Loading state
  if (isLoading) {
    return (
      <div className={cn('flex min-h-0 flex-1 items-center justify-center', className)}>
        <Loading type="area" />
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-text-tertiary', className)}>
        <span className="system-xs-regular">
          {t('skillSidebar.loadError')}
        </span>
      </div>
    )
  }

  // Empty state
  if (!treeData?.children || treeData.children.length === 0) {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <span className="system-xs-regular text-text-tertiary">
            {t('skillSidebar.empty')}
          </span>
        </div>
        <DropTip />
      </div>
    )
  }

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-1 pt-1">
        <Tree<TreeNodeData>
          ref={treeRef}
          data={treeData.children}
          // Structure accessors
          idAccessor="id"
          childrenAccessor="children"
          // Layout
          width="100%"
          height={1000}
          rowHeight={24}
          indent={20}
          overscanCount={5}
          // Initial open state
          initialOpenState={initialOpenState}
          // Selection (controlled by activeTabId)
          selection={activeTabId ?? undefined}
          // Events
          onToggle={handleToggle}
          onActivate={handleActivate}
          onRename={handleRename}
          // Disable features not in MVP
          disableDrag
          disableDrop
        >
          {FileTreeNode}
        </Tree>
      </div>
      <DropTip />
      {/* Right-click context menu */}
      <FileTreeContextMenu treeRef={treeRef} />
    </div>
  )
}

export default React.memo(Files)
