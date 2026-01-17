'use client'

import type { NodeApi, TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../type'
import type { OpensObject } from '@/app/components/workflow/store/workflow/skill-editor/file-tree-slice'
import { RiDragDropLine } from '@remixicon/react'
import { useIsMutating } from '@tanstack/react-query'
import { useSize } from 'ahooks'
import * as React from 'react'
import { useCallback, useMemo, useRef } from 'react'
import { Tree } from 'react-arborist'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'
import Toast from '@/app/components/base/toast'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { useRenameAppAssetNode } from '@/service/use-app-asset'
import { cn } from '@/utils/classnames'
import { useSkillAssetTreeData } from '../hooks/use-skill-asset-tree'
import { useSyncTreeWithActiveTab } from '../hooks/use-sync-tree-with-active-tab'
import TreeContextMenu from './tree-context-menu'
import TreeNode from './tree-node'

type FileTreeProps = {
  className?: string
  searchTerm?: string
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

const FileTree: React.FC<FileTreeProps> = ({ className, searchTerm = '' }) => {
  const { t } = useTranslation('workflow')
  const treeRef = useRef<TreeApi<TreeNodeData>>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const containerSize = useSize(containerRef)

  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''

  const { data: treeData, isLoading, error } = useSkillAssetTreeData()
  const isMutating = useIsMutating() > 0

  const expandedFolderIds = useStore(s => s.expandedFolderIds)
  const activeTabId = useStore(s => s.activeTabId)
  const storeApi = useWorkflowStore()

  const renameNode = useRenameAppAssetNode()

  const initialOpensObject = useMemo<OpensObject>(() => {
    return Object.fromEntries(
      [...expandedFolderIds].map(id => [id, true]),
    )
  }, [expandedFolderIds])

  const handleToggle = useCallback((id: string) => {
    storeApi.getState().toggleFolder(id)
  }, [storeApi])

  const handleActivate = useCallback((node: NodeApi<TreeNodeData>) => {
    if (node.data.node_type === 'file')
      storeApi.getState().openTab(node.data.id, { pinned: true })
    else
      node.toggle()
  }, [storeApi])

  const handleRename = useCallback(({ id, name }: { id: string, name: string }) => {
    renameNode.mutateAsync({
      appId,
      nodeId: id,
      payload: { name },
    }).then(() => {
      Toast.notify({
        type: 'success',
        message: t('skillSidebar.menu.renamed'),
      })
    }).catch(() => {
      Toast.notify({
        type: 'error',
        message: t('skillSidebar.menu.renameError'),
      })
    })
  }, [appId, renameNode, t])

  const searchMatch = useCallback(
    (node: NodeApi<TreeNodeData>, term: string) => {
      return node.data.name.toLowerCase().includes(term.toLowerCase())
    },
    [],
  )

  useSyncTreeWithActiveTab({
    treeRef,
    activeTabId,
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
    <>
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          isMutating && 'pointer-events-none opacity-50',
          className,
        )}
      >
        <div
          ref={containerRef}
          className="flex min-h-0 flex-1 flex-col overflow-hidden px-1 pt-1"
        >
          <Tree<TreeNodeData>
            ref={treeRef}
            data={treeData.children}
            idAccessor="id"
            childrenAccessor="children"
            width="100%"
            height={containerSize?.height ?? 400}
            rowHeight={24}
            indent={20}
            overscanCount={5}
            openByDefault={false}
            selection={activeTabId ?? undefined}
            initialOpenState={initialOpensObject}
            onToggle={handleToggle}
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
      <DropTip />
      <TreeContextMenu treeRef={treeRef} />
    </>
  )
}

export default React.memo(FileTree)
