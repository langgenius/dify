import type { NodeRendererProps } from 'react-arborist'
import type { FileAppearanceType } from '@/app/components/base/file-uploader/types'
import type { TreeNodeData } from '@/app/components/workflow/skill/type'
import { useSize } from 'ahooks'
import * as React from 'react'
import { useCallback, useMemo, useRef } from 'react'
import { Tree } from 'react-arborist'
import { useTranslation } from 'react-i18next'
import FileTypeIcon from '@/app/components/base/file-uploader/file-type-icon'
import Loading from '@/app/components/base/loading'
import TreeGuideLines from '@/app/components/workflow/skill/file-tree/tree/tree-guide-lines'
import { useSkillAssetTreeData } from '@/app/components/workflow/skill/hooks/file-tree/data/use-skill-asset-tree'
import { getFileIconType } from '@/app/components/workflow/skill/utils/file-utils'
import { findNodeById, getAncestorIds } from '@/app/components/workflow/skill/utils/tree-utils'
import { cn } from '@/utils/classnames'

type FilePickerTreeNodeProps = NodeRendererProps<TreeNodeData> & {
  onSelectNode: (node: TreeNodeData) => void
}

const FilePickerTreeNode = ({ node, style, dragHandle, onSelectNode }: FilePickerTreeNodeProps) => {
  const { t } = useTranslation('workflow')
  const isFolder = node.data.node_type === 'folder'
  const isSelected = node.isSelected
  const fileIconType = !isFolder ? getFileIconType(node.data.name, node.data.extension) : null

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    node.select()
    onSelectNode(node.data)
  }, [node, onSelectNode])

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    node.toggle()
  }, [node])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelectNode(node.data)
    }
  }, [node, onSelectNode])

  return (
    <div
      ref={dragHandle}
      style={style}
      role="treeitem"
      tabIndex={0}
      aria-selected={isSelected}
      aria-expanded={isFolder ? node.isOpen : undefined}
      className={cn(
        'group relative flex h-6 cursor-pointer items-center gap-0 overflow-hidden rounded-md',
        'hover:bg-state-base-hover',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-components-input-border-active',
        isSelected && 'bg-state-base-active',
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <TreeGuideLines level={node.level} lineOffset={0} />
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
        <div className="flex size-4 shrink-0 items-center justify-center">
          {isFolder
            ? (
                node.isOpen
                  ? <span className="i-ri-folder-open-line size-4 text-text-accent" aria-hidden="true" />
                  : <span className="i-ri-folder-line size-4 text-text-secondary" aria-hidden="true" />
              )
            : (
                <FileTypeIcon type={fileIconType as FileAppearanceType} size="sm" />
              )}
        </div>
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[13px] font-normal leading-4',
            isSelected ? 'text-text-primary' : 'text-text-secondary',
          )}
        >
          {node.data.name}
        </span>
      </div>
      {isFolder && (
        <span
          aria-hidden="true"
          className="h-full w-px shrink-0 bg-transparent group-hover:bg-components-panel-bg"
        />
      )}
      {isFolder && (
        <button
          type="button"
          tabIndex={-1}
          onClick={handleToggle}
          aria-label={t('skillSidebar.toggleFolder')}
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-r-md',
            'bg-transparent text-text-tertiary',
            'group-hover:bg-state-base-hover-subtle',
            'hover:bg-state-base-hover-subtle',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-components-input-border-active',
          )}
        >
          {node.isOpen
            ? <span className="i-ri-arrow-down-s-line size-4" aria-hidden="true" />
            : <span className="i-ri-arrow-right-s-line size-4" aria-hidden="true" />}
        </button>
      )}
    </div>
  )
}

FilePickerTreeNode.displayName = 'FilePickerTreeNode'

type FilePickerPanelProps = {
  onSelectNode: (node: TreeNodeData) => void
  focusNodeId?: string
  className?: string
  contentClassName?: string
  showHeader?: boolean
  showAddFiles?: boolean
  onAddFiles?: () => void
}

const FilePickerPanel = ({
  onSelectNode,
  focusNodeId,
  className,
  contentClassName,
  showHeader = true,
  showAddFiles = false,
  onAddFiles,
}: FilePickerPanelProps) => {
  const { t } = useTranslation('workflow')
  const { data: treeData, isLoading, error } = useSkillAssetTreeData()
  const containerRef = useRef<HTMLDivElement>(null)
  const containerSize = useSize(containerRef)

  const treeNodes = useMemo(() => treeData?.children || [], [treeData?.children])

  const initialOpenState = useMemo(() => {
    const nextState: Record<string, boolean> = {}
    if (!focusNodeId || treeNodes.length === 0)
      return nextState

    const focusNode = findNodeById(treeNodes, focusNodeId)
    const ancestorIds = getAncestorIds(focusNodeId, treeNodes)
    ancestorIds.forEach(id => (nextState[id] = true))
    if (focusNode?.node_type === 'folder')
      nextState[focusNode.id] = true

    return nextState
  }, [focusNodeId, treeNodes])

  const renderNode = useCallback((props: NodeRendererProps<TreeNodeData>) => (
    <FilePickerTreeNode {...props} onSelectNode={onSelectNode} />
  ), [onSelectNode])

  return (
    <div
      className={cn(
        'w-[280px] overflow-hidden rounded-xl border-[0.5px] border-components-panel-border backdrop-blur-sm',
        className,
      )}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement
        if (target.closest('input, textarea, select'))
          return
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {showHeader && (
        <div className="flex items-center gap-1 px-4 pb-1 pt-1.5">
          <span className="flex-1 text-[12px] font-medium uppercase leading-4 text-text-tertiary">
            {t('skillEditor.referenceFiles')}
          </span>
        </div>
      )}
      <div
        ref={containerRef}
        className={cn(
          'max-h-[320px] min-h-[120px] px-2 pb-2',
          !showHeader && 'pt-2',
          contentClassName,
        )}
      >
        {isLoading && (
          <div className="flex h-full items-center justify-center py-6">
            <Loading type="area" />
          </div>
        )}
        {!isLoading && error && (
          <div className="flex items-center justify-center py-6 text-[12px] text-text-tertiary">
            {t('skillSidebar.loadError')}
          </div>
        )}
        {!isLoading && !error && treeNodes.length === 0 && (
          <div className="flex items-center justify-center py-6 text-[12px] text-text-tertiary">
            {t('skillSidebar.empty')}
          </div>
        )}
        {!isLoading && !error && treeNodes.length > 0 && (
          <Tree<TreeNodeData>
            data={treeNodes}
            idAccessor="id"
            childrenAccessor="children"
            width="100%"
            className="pb-2"
            height={containerSize?.height}
            rowHeight={24}
            indent={20}
            overscanCount={5}
            openByDefault={false}
            initialOpenState={initialOpenState}
            disableDrag
            disableDrop
          >
            {renderNode}
          </Tree>
        )}
      </div>
      {showAddFiles && (
        <>
          <div className="h-px bg-divider-subtle" />
          <button
            type="button"
            className={cn(
              'flex h-9 w-full items-center gap-2 px-3 text-left hover:bg-state-base-hover',
              !onAddFiles && 'cursor-not-allowed opacity-50',
            )}
            onClick={onAddFiles}
            disabled={!onAddFiles}
          >
            <span className="i-ri-file-add-line size-4 text-text-secondary" aria-hidden="true" />
            <span className="text-[13px] font-medium leading-4 text-text-secondary">{t('skillEditor.addFiles')}</span>
          </button>
        </>
      )}
    </div>
  )
}

export { FilePickerPanel }
