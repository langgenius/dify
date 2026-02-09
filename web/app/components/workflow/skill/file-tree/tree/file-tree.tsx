'use client'

import type { MoveHandler, NodeApi, NodeRendererProps, TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../../type'
import type { OpensObject } from '@/app/components/workflow/store/workflow/skill-editor/file-tree-slice'
import type { AppAssetTreeView } from '@/types/app-asset'
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
import { CONTEXT_MENU_TYPE, ROOT_ID } from '../../constants'
import { useSkillAssetTreeData } from '../../hooks/file-tree/data/use-skill-asset-tree'
import { useSkillTreeCollaboration } from '../../hooks/file-tree/data/use-skill-tree-collaboration'
import { useRootFileDrop } from '../../hooks/file-tree/dnd/use-root-file-drop'
import { useInlineCreateNode } from '../../hooks/file-tree/interaction/use-inline-create-node'
import { useSkillShortcuts } from '../../hooks/file-tree/interaction/use-skill-shortcuts'
import { useSyncTreeWithActiveTab } from '../../hooks/file-tree/interaction/use-sync-tree-with-active-tab'
import { useNodeMove } from '../../hooks/file-tree/operations/use-node-move'
import { useNodeReorder } from '../../hooks/file-tree/operations/use-node-reorder'
import { usePasteOperation } from '../../hooks/file-tree/operations/use-paste-operation'
import { isDescendantOf } from '../../utils/tree-utils'
import DragActionTooltip from './drag-action-tooltip'
import SearchResultList from './search-result-list'
import TreeContextMenu from './tree-context-menu'
import TreeNode from './tree-node'
import UploadStatusTooltip from './upload-status-tooltip'

type FileTreeProps = {
  className?: string
}

const emptyTreeNodes: TreeNodeData[] = []
type DragInsertTarget = {
  parentId: string | null
  index: number
}

const normalizeParentId = (node: NodeApi<TreeNodeData> | null | undefined) => {
  if (!node || node.isRoot)
    return null
  return node.id
}

const getSiblingIds = (
  parentNode: NodeApi<TreeNodeData> | null | undefined,
  tree: TreeApi<TreeNodeData> | null,
): string[] => {
  const children = parentNode?.children ?? tree?.root.children ?? []
  return children.map(child => child.id)
}

const getAfterNodeIdForReorder = (
  siblingIds: string[],
  draggedId: string,
  targetIndex: number,
): string | null | undefined => {
  const originalIndex = siblingIds.indexOf(draggedId)
  if (originalIndex === -1)
    return undefined

  let adjustedIndex = targetIndex
  if (targetIndex > originalIndex)
    adjustedIndex -= 1

  const siblingsWithoutDragged = siblingIds.filter(id => id !== draggedId)
  const insertIndex = Math.min(Math.max(adjustedIndex, 0), siblingsWithoutDragged.length)
  if (insertIndex === 0)
    return null

  return siblingsWithoutDragged[insertIndex - 1] ?? null
}

const DropTip = () => {
  const { t } = useTranslation('workflow')
  return (
    <div className="flex shrink-0 items-center justify-center gap-2 py-4 text-text-quaternary">
      <RiDragDropLine className="size-4" aria-hidden="true" />
      <span className="system-xs-regular">
        {t('skillSidebar.dropTip')}
      </span>
    </div>
  )
}

const FileTree = ({ className }: FileTreeProps) => {
  const { t } = useTranslation('workflow')
  const treeRef = useRef<TreeApi<TreeNodeData>>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const containerSize = useSize(containerRef)
  const dragInsertTargetRef = useRef<DragInsertTarget | null>(null)

  const { data: treeData, isLoading, error, dataUpdatedAt } = useSkillAssetTreeData()
  const isMutating = useIsMutating() > 0

  const expandedFolderIds = useStore(s => s.expandedFolderIds)
  const activeTabId = useStore(s => s.activeTabId)
  const dragOverFolderId = useStore(s => s.dragOverFolderId)
  const currentDragType = useStore(s => s.currentDragType)
  const searchTerm = useStore(s => s.fileTreeSearchTerm)
  const storeApi = useWorkflowStore()

  const treeChildren = treeData?.children ?? emptyTreeNodes

  useSkillTreeCollaboration()

  const {
    handleRootDragEnter,
    handleRootDragLeave,
    handleRootDragOver,
    handleRootDrop,
    resetRootDragCounter,
  } = useRootFileDrop({ treeChildren })

  // Root dropzone highlight (when dragging to root, not to a specific folder)
  const isRootDropzone = dragOverFolderId === ROOT_ID

  useEffect(() => {
    if (!dragOverFolderId)
      resetRootDragCounter()
  }, [dragOverFolderId, resetRootDragCounter])

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

  // Node move API (for internal drag-drop)
  const { executeMoveNode } = useNodeMove()
  const { executeReorderNode } = useNodeReorder()

  const syncDragInsertTarget = useCallback(() => {
    const tree = treeRef.current
    if (!tree)
      return

    const { id, destinationParentId, destinationIndex } = tree.state.nodes.drag
    if (!id || destinationIndex === null) {
      if (dragInsertTargetRef.current) {
        dragInsertTargetRef.current = null
        storeApi.getState().setDragInsertTarget(null)
      }
      return
    }

    const normalizedParentId = destinationParentId === tree.root.id ? null : destinationParentId
    const nextTarget = { parentId: normalizedParentId, index: destinationIndex }
    const prevTarget = dragInsertTargetRef.current
    if (prevTarget?.parentId === nextTarget.parentId && prevTarget?.index === nextTarget.index)
      return

    dragInsertTargetRef.current = nextTarget
    storeApi.getState().setDragInsertTarget(nextTarget)
  }, [storeApi])

  useEffect(() => {
    const tree = treeRef.current
    if (!tree)
      return

    syncDragInsertTarget()
    const unsubscribe = tree.store.subscribe(syncDragInsertTarget)
    return () => {
      unsubscribe()
      dragInsertTargetRef.current = null
      storeApi.getState().setDragInsertTarget(null)
    }
  }, [syncDragInsertTarget, storeApi, treeNodes.length])

  // react-arborist onMove callback - called when internal drag completes
  const handleMove = useCallback<MoveHandler<TreeNodeData>>(({ dragIds, parentId, index, dragNodes, parentNode }) => {
    // Only support single node drag for now
    const nodeId = dragIds[0]
    const draggedNode = dragNodes[0]
    if (!nodeId || !draggedNode)
      return

    const tree = treeRef.current
    const destinationIndex = tree?.dragDestinationIndex
    const isInsertLine = destinationIndex !== null && destinationIndex !== undefined
    const targetParentId = parentId ?? null
    const sourceParentId = normalizeParentId(draggedNode.parent)

    if (isInsertLine && sourceParentId === targetParentId) {
      const siblingIds = getSiblingIds(parentNode, tree)
      const afterNodeId = getAfterNodeIdForReorder(
        siblingIds,
        nodeId,
        destinationIndex ?? index,
      )
      if (afterNodeId !== undefined) {
        executeReorderNode(nodeId, afterNodeId)
        return
      }
    }

    // parentId from react-arborist is null for root, otherwise folder ID
    executeMoveNode(nodeId, targetParentId)
  }, [executeMoveNode, executeReorderNode, treeRef])

  // react-arborist disableDrop callback - returns true to prevent drop
  const handleDisableDrop = useCallback((args: {
    parentNode: NodeApi<TreeNodeData>
    dragNodes: NodeApi<TreeNodeData>[]
    index: number
  }) => {
    const { dragNodes, parentNode } = args

    // 1. Files cannot be drop targets - only folders can receive drops
    if (parentNode.data.node_type === 'file')
      return true

    // 2. Cannot drop node into itself
    const draggedNode = dragNodes[0]
    if (!draggedNode)
      return true
    if (draggedNode.id === parentNode.id)
      return true

    // 3. Prevent circular move (folder into its descendant)
    if (draggedNode.data.node_type === 'folder') {
      const treeChildrenTyped = treeChildren as AppAssetTreeView[]
      if (isDescendantOf(parentNode.id, draggedNode.id, treeChildrenTyped))
        return true
    }

    // Note: We don't prevent dropping to same parent (no-op move)
    // The API handles this gracefully

    return false
  }, [treeChildren])

  const renderTreeNode = useCallback((props: NodeRendererProps<TreeNodeData>) => {
    return <TreeNode {...props} treeChildren={treeChildren} />
  }, [treeChildren])

  useSyncTreeWithActiveTab({
    treeRef,
    activeTabId,
    syncSignal: dataUpdatedAt,
    isTreeLoading: isLoading,
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
      <div className={cn('flex min-h-[150px] flex-1 flex-col overflow-y-auto', className)}>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <span className="text-text-tertiary system-xs-regular">
            {t('skillSidebar.empty')}
          </span>
        </div>
        <UploadStatusTooltip fallback={<DropTip />} />
      </div>
    )
  }

  if (hasSearchNoResults) {
    return (
      <div className={cn('flex min-h-[150px] flex-1 flex-col overflow-y-auto', className)}>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 pb-20">
          <SearchMenu className="size-8 text-text-tertiary" aria-hidden="true" />
          <span className="text-text-secondary system-xs-regular">
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
    )
  }

  if (searchTerm) {
    return (
      <div className={cn('flex min-h-[150px] flex-1 flex-col overflow-y-auto', className)}>
        <SearchResultList
          searchTerm={searchTerm}
          treeChildren={treeChildren as AppAssetTreeView[]}
        />
      </div>
    )
  }

  return (
    <>
      <div
        data-skill-tree-container
        className={cn(
          'flex min-h-[150px] flex-1 flex-col overflow-y-auto',
          isMutating && 'pointer-events-none',
          className,
        )}
      >
        <div
          ref={containerRef}
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-hidden px-1 pt-1',
            isRootDropzone && 'relative rounded-lg bg-state-accent-hover after:pointer-events-none after:absolute after:inset-0 after:rounded-lg after:border-[1.5px] after:border-dashed after:border-state-accent-solid after:content-[""]',
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
            rowClassName="outline-none"
            onToggle={handleToggle}
            onSelect={handleSelect}
            onActivate={handleActivate}
            onRename={handleRename}
            onMove={handleMove}
            searchTerm={searchTerm}
            searchMatch={searchMatch}
            disableDrop={handleDisableDrop}
          >
            {renderTreeNode}
          </Tree>
        </div>
        {dragOverFolderId
          ? <DragActionTooltip action={currentDragType ?? 'upload'} />
          : <UploadStatusTooltip fallback={<DropTip />} />}
      </div>
      <TreeContextMenu treeRef={treeRef} />
    </>
  )
}

export default React.memo(FileTree)
