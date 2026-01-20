'use client'

import type { NodeApi, TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../type'
import type { OpensObject } from '@/app/components/workflow/store/workflow/skill-editor/file-tree-slice'
import { RiDragDropLine } from '@remixicon/react'
import { useIsMutating } from '@tanstack/react-query'
import { useSize } from 'ahooks'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Tree } from 'react-arborist'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import SearchMenu from '@/app/components/base/icons/src/vender/knowledge/SearchMenu'
import Loading from '@/app/components/base/loading'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { cn } from '@/utils/classnames'
import { CONTEXT_MENU_TYPE, ROOT_ID } from '../constants'
import { useInlineCreateNode } from '../hooks/use-inline-create-node'
import { usePasteOperation } from '../hooks/use-paste-operation'
import { useRootFileDrop } from '../hooks/use-root-file-drop'
import { useSkillAssetTreeData } from '../hooks/use-skill-asset-tree'
import { useSkillShortcuts } from '../hooks/use-skill-shortcuts'
import { useSyncTreeWithActiveTab } from '../hooks/use-sync-tree-with-active-tab'
import ArtifactsSection from './artifacts-section'
import DragActionTooltip from './drag-action-tooltip'
import TreeContextMenu from './tree-context-menu'
import TreeNode from './tree-node'

type FileTreeProps = {
  className?: string
}

const emptyTreeNodes: TreeNodeData[] = []

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

const FileTree: React.FC<FileTreeProps> = ({ className }) => {
  const { t } = useTranslation('workflow')
  const treeRef = useRef<TreeApi<TreeNodeData>>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const containerSize = useSize(containerRef)

  const { data: treeData, isLoading, error } = useSkillAssetTreeData()
  const isMutating = useIsMutating() > 0

  const {
    handleRootDragEnter,
    handleRootDragLeave,
    handleRootDragOver,
    handleRootDrop,
    resetRootDragCounter,
  } = useRootFileDrop()

  const expandedFolderIds = useStore(s => s.expandedFolderIds)
  const activeTabId = useStore(s => s.activeTabId)
  const dragOverFolderId = useStore(s => s.dragOverFolderId)
  const searchTerm = useStore(s => s.fileTreeSearchTerm)
  const storeApi = useWorkflowStore()

  // Root dropzone highlight (when dragging to root, not to a specific folder)
  const isRootDropzone = dragOverFolderId === ROOT_ID

  useEffect(() => {
    if (!dragOverFolderId)
      resetRootDragCounter()
  }, [dragOverFolderId, resetRootDragCounter])

  const treeChildren = treeData?.children ?? emptyTreeNodes
  const {
    treeNodes,
    handleRename,
    searchMatch,
    hasPendingCreate,
  } = useInlineCreateNode({
    treeRef,
    treeChildren,
  })

  const initialOpensObject = useMemo<OpensObject>(() => {
    return Object.fromEntries(
      [...expandedFolderIds].map(id => [id, true]),
    )
  }, [expandedFolderIds])

  // Check if search has no results (has search term but no matches)
  const hasSearchNoResults = useMemo(() => {
    if (!searchTerm || treeChildren.length === 0)
      return false

    const lowerSearchTerm = searchTerm.toLowerCase()

    const checkMatch = (nodes: TreeNodeData[]): boolean => {
      for (const node of nodes) {
        if (node.name.toLowerCase().includes(lowerSearchTerm))
          return true
        if (node.children && checkMatch(node.children))
          return true
      }
      return false
    }
    return !checkMatch(treeChildren)
  }, [searchTerm, treeChildren])

  const handleToggle = useCallback((id: string) => {
    storeApi.getState().toggleFolder(id)
  }, [storeApi])

  const handleActivate = useCallback((node: NodeApi<TreeNodeData>) => {
    if (node.data.node_type === 'file')
      storeApi.getState().openTab(node.data.id, { pinned: true })
    else
      node.toggle()
  }, [storeApi])

  const handleSelect = useCallback((nodes: NodeApi<TreeNodeData>[]) => {
    storeApi.getState().setSelectedNodeIds(nodes.map(n => n.id))
  }, [storeApi])

  const handleBlankAreaClick = useCallback(() => {
    treeRef.current?.deselectAll()
    storeApi.getState().clearSelection()
  }, [storeApi, treeRef])

  const handleBlankAreaContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    treeRef.current?.deselectAll()
    storeApi.getState().clearSelection()
    storeApi.getState().setContextMenu({
      top: e.clientY,
      left: e.clientX,
      type: CONTEXT_MENU_TYPE.BLANK,
    })
  }, [storeApi, treeRef])

  useSyncTreeWithActiveTab({
    treeRef,
    activeTabId,
  })

  useSkillShortcuts({ treeRef })

  usePasteOperation({
    treeRef,
    treeData: treeData ?? undefined,
  })

  if (isLoading) {
    return (
      <div className={cn('flex min-h-0 flex-1 items-center justify-center', className)}>
        <Loading type="area" />
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-text-tertiary', className)}>
        <span className="system-xs-regular">
          {t('skillSidebar.loadError')}
        </span>
      </div>
    )
  }

  if (treeChildren.length === 0 && !hasPendingCreate) {
    return (
      <>
        <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
            <span className="system-xs-regular text-text-tertiary">
              {t('skillSidebar.empty')}
            </span>
          </div>
          <DropTip />
        </div>
        <ArtifactsSection />
      </>
    )
  }

  // Search has no matching results
  if (hasSearchNoResults) {
    return (
      <>
        <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
          <div className="flex flex-1 flex-col items-center justify-center gap-2 pb-20">
            <SearchMenu className="size-8 text-text-tertiary" />
            <span className="system-xs-regular text-text-secondary">
              {t('skillSidebar.searchNoResults')}
            </span>
            <Button
              variant="secondary-accent"
              size="small"
              onClick={() => storeApi.getState().setFileTreeSearchTerm('')}
            >
              {t('skillSidebar.resetFilter')}
            </Button>
          </div>
        </div>
        <ArtifactsSection />
      </>
    )
  }

  return (
    <>
      <div
        data-skill-tree-container
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          isMutating && 'pointer-events-none opacity-50',
          className,
        )}
      >
        <div
          ref={containerRef}
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-hidden px-1 pt-1',
            // Root dropzone highlight - dashed border without layout shift
            isRootDropzone && 'relative rounded-lg bg-state-accent-hover after:pointer-events-none after:absolute after:inset-0 after:rounded-lg after:border-[1.5px] after:border-dashed after:border-state-accent-solid after:content-[\'\']',
          )}
          onClick={handleBlankAreaClick}
          onContextMenu={handleBlankAreaContextMenu}
          onDragEnter={handleRootDragEnter}
          onDragOver={handleRootDragOver}
          onDragLeave={handleRootDragLeave}
          onDrop={handleRootDrop}
        >
          <Tree<TreeNodeData>
            ref={treeRef}
            data={treeNodes}
            idAccessor="id"
            childrenAccessor="children"
            width="100%"
            height={containerSize?.height ?? 400}
            rowHeight={24}
            indent={20}
            overscanCount={5}
            openByDefault={false}
            initialOpenState={initialOpensObject}
            onToggle={handleToggle}
            onSelect={handleSelect}
            onActivate={handleActivate}
            onRename={handleRename}
            searchTerm={searchTerm}
            searchMatch={searchMatch}
            disableDrag
            disableDrop
          >
            {TreeNode}
          </Tree>
        </div>
      </div>
      {dragOverFolderId
        ? <DragActionTooltip action="upload" />
        : <DropTip />}
      <ArtifactsSection />
      <TreeContextMenu treeRef={treeRef} />
    </>
  )
}

export default React.memo(FileTree)
