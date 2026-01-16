'use client'

import type { NodeApi, TreeApi } from 'react-arborist'
import type { OpensObject } from '../store'
import type { TreeNodeData } from '../type'
import { RiDragDropLine } from '@remixicon/react'
import { useIsMutating } from '@tanstack/react-query'
import { useSize } from 'ahooks'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Tree } from 'react-arborist'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'
import Toast from '@/app/components/base/toast'
import { useRenameAppAssetNode } from '@/service/use-app-asset'
import { cn } from '@/utils/classnames'
import { useSkillAssetTreeData } from '../hooks/use-skill-asset-tree'
import { useSkillEditorStore, useSkillEditorStoreApi } from '../store'
import { getAncestorIds } from '../utils/tree-utils'
import TreeContextMenu from './tree-context-menu'
import TreeNode from './tree-node'

type FileTreeProps = {
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

const FileTree: React.FC<FileTreeProps> = ({ className }) => {
  const { t } = useTranslation('workflow')
  const treeRef = useRef<TreeApi<TreeNodeData>>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const containerSize = useSize(containerRef)

  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''

  const { data: treeData, isLoading, error } = useSkillAssetTreeData()
  const isMutating = useIsMutating() > 0

  const expandedFolderIds = useSkillEditorStore(s => s.expandedFolderIds)
  const activeTabId = useSkillEditorStore(s => s.activeTabId)
  const storeApi = useSkillEditorStoreApi()

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
    }).catch(() => {
      Toast.notify({
        type: 'error',
        message: t('skillSidebar.menu.renameError'),
      })
    })
  }, [appId, renameNode, t])

  useEffect(() => {
    if (!activeTabId || !treeData?.children)
      return

    const tree = treeRef.current
    if (!tree)
      return

    const ancestors = getAncestorIds(activeTabId, treeData.children)
    if (ancestors.length > 0)
      storeApi.getState().revealFile(ancestors)
    requestAnimationFrame(() => {
      const node = tree.get(activeTabId)
      if (node) {
        tree.openParents(node)
        tree.scrollTo(activeTabId)
      }
    })
  }, [activeTabId, treeData?.children, storeApi])

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
