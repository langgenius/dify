'use client'

import type { DocumentChunkTree } from './document-detail-model'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { chunkTreeLabel, visibleDocumentChunkNodes } from './document-detail-model'

const VIRTUALIZATION_THRESHOLD = 80
const TREE_ROW_SIZE = 30
const TREE_ROW_INLINE_PADDING = 8
const TREE_DEPTH_INDENT = 16

function AutomaticChunkPageLoader({
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
}: {
  fetchNextPage: () => Promise<unknown>
  hasNextPage: boolean
  isFetchingNextPage: boolean
}) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const handleIntersection = useEffectEvent((entry: IntersectionObserverEntry) => {
    if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage()
  })

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (
      !hasNextPage ||
      isFetchingNextPage ||
      !sentinel ||
      typeof IntersectionObserver === 'undefined'
    )
      return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) handleIntersection(entry)
      },
      { rootMargin: '0px 0px 200px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage])

  return <div ref={sentinelRef} aria-hidden className="h-px" />
}

export function DocumentChunkTreePanel({
  chunkCount,
  error,
  fetchNextPage,
  hasNextPage,
  isFetchNextPageError,
  isFetchingNextPage,
  isPending,
  onRetry,
  onSelectChunk,
  selectedChunkId,
  tree,
}: {
  chunkCount: number
  error: boolean
  fetchNextPage: () => Promise<unknown>
  hasNextPage: boolean
  isFetchNextPageError: boolean
  isFetchingNextPage: boolean
  isPending: boolean
  onRetry: () => void
  onSelectChunk: (chunkId: string) => void
  selectedChunkId?: string
  tree: DocumentChunkTree
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const [expansionOverrides, setExpansionOverrides] = useState<{
    collapsed: Set<string>
    expanded: Set<string>
  }>(() => ({ collapsed: new Set(), expanded: new Set() }))
  const [focusedNodeId, setFocusedNodeId] = useState<string>()
  const [selectedNodeId, setSelectedNodeId] = useState<string>()
  const [treeHasFocus, setTreeHasFocus] = useState(false)
  const treeScrollRef = useRef<HTMLDivElement>(null)
  const selectedBranchNodeIds = useMemo(() => {
    const selectedNode =
      (selectedNodeId ? tree.byId.get(selectedNodeId) : undefined) ??
      [...tree.byId.values()].find((node) => node.targetChunkId === selectedChunkId)
    const branch = new Set<string>()
    let node = selectedNode
    while (node) {
      branch.add(node.id)
      node = node.parentId ? tree.byId.get(node.parentId) : undefined
    }
    return branch
  }, [selectedChunkId, selectedNodeId, tree.byId])
  const expandedNodeIds = useMemo(() => {
    const expanded = new Set([...selectedBranchNodeIds, ...expansionOverrides.expanded])
    for (const nodeId of expansionOverrides.collapsed) expanded.delete(nodeId)
    return expanded
  }, [expansionOverrides, selectedBranchNodeIds])
  const visibleNodes = useMemo(
    () => visibleDocumentChunkNodes(tree.roots, expandedNodeIds),
    [expandedNodeIds, tree.roots],
  )
  const shouldVirtualize = visibleNodes.length > VIRTUALIZATION_THRESHOLD
  const currentFocusedNodeId = focusedNodeId ?? visibleNodes[0]?.node.id
  const activeSelectedNodeId =
    selectedNodeId && tree.byId.has(selectedNodeId)
      ? selectedNodeId
      : visibleNodes.find((item) => item.node.targetChunkId === selectedChunkId)?.node.id
  const focusedIndex = visibleNodes.findIndex((item) => item.node.id === currentFocusedNodeId)
  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? visibleNodes.length : 0,
    estimateSize: () => TREE_ROW_SIZE,
    getItemKey: (index) => visibleNodes[index]?.node.id ?? index,
    getScrollElement: () => treeScrollRef.current,
    overscan: 8,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range)
      if (focusedIndex >= 0 && !indexes.includes(focusedIndex)) indexes.push(focusedIndex)
      return indexes.sort((left, right) => left - right)
    },
  })
  const virtualRows = rowVirtualizer.getVirtualItems()

  const toggleExpanded = (nodeId: string) => {
    const expanded = expandedNodeIds.has(nodeId)
    setExpansionOverrides((current) => {
      const next = {
        collapsed: new Set(current.collapsed),
        expanded: new Set(current.expanded),
      }
      if (expanded) {
        next.expanded.delete(nodeId)
        next.collapsed.add(nodeId)
      } else {
        next.collapsed.delete(nodeId)
        next.expanded.add(nodeId)
      }
      return next
    })
  }

  const focusNode = (nodeId: string) => {
    const index = visibleNodes.findIndex((item) => item.node.id === nodeId)
    if (index < 0) return
    setFocusedNodeId(nodeId)
    if (shouldVirtualize) rowVirtualizer.scrollToIndex(index, { align: 'auto' })
    treeScrollRef.current?.focus()
  }

  const selectNode = (node: (typeof visibleNodes)[number]['node']) => {
    setSelectedNodeId(node.id)
    onSelectChunk(node.targetChunkId)
  }

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const nodeId = currentFocusedNodeId
    if (!nodeId) return
    const index = visibleNodes.findIndex((item) => item.node.id === nodeId)
    const current = visibleNodes[index]
    if (!current) return
    const parentId = current.node.parentId
    let nextId: string | undefined
    if (event.key === 'ArrowDown') nextId = visibleNodes[index + 1]?.node.id
    else if (event.key === 'ArrowUp') nextId = visibleNodes[index - 1]?.node.id
    else if (event.key === 'Home') nextId = visibleNodes[0]?.node.id
    else if (event.key === 'End') nextId = visibleNodes.at(-1)?.node.id
    else if (event.key === 'ArrowRight' && current.node.children.length) {
      if (!expandedNodeIds.has(nodeId)) toggleExpanded(nodeId)
      else nextId = current.node.children[0]?.id
    } else if (event.key === 'ArrowLeft') {
      if (current.node.children.length && expandedNodeIds.has(nodeId)) toggleExpanded(nodeId)
      else if (parentId && tree.byId.has(parentId)) nextId = parentId
    } else if (event.key === 'Enter' || event.key === ' ') selectNode(current.node)
    else return
    event.preventDefault()
    if (nextId) focusNode(nextId)
  }

  const renderTreeItem = (item: (typeof visibleNodes)[number], style?: React.CSSProperties) => {
    const { depth, node, positionInSet, setSize } = item
    const hasChildren = node.children.length > 0
    const expanded = expandedNodeIds.has(node.id)
    const label = chunkTreeLabel(node.label)
    return (
      <button
        key={node.id}
        id={`document-chunk-treeitem-${node.id}`}
        aria-expanded={hasChildren ? expanded : undefined}
        aria-label={label}
        aria-level={depth + 1}
        aria-posinset={positionInSet}
        aria-selected={activeSelectedNodeId === node.id}
        aria-setsize={hasNextPage ? -1 : setSize}
        className={cn(
          'flex h-7 w-full items-center gap-1.5 rounded-lg px-2 text-left system-xs-regular outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset',
          activeSelectedNodeId === node.id && 'bg-state-accent-hover text-text-accent',
          treeHasFocus &&
            currentFocusedNodeId === node.id &&
            'bg-state-base-hover ring-1 ring-state-accent-solid ring-inset',
        )}
        role="treeitem"
        style={{
          ...style,
          paddingInlineStart: TREE_ROW_INLINE_PADDING + depth * TREE_DEPTH_INDENT,
        }}
        tabIndex={-1}
        onClick={() => {
          setFocusedNodeId(node.id)
          treeScrollRef.current?.focus()
          selectNode(node)
          if (hasChildren) toggleExpanded(node.id)
        }}
      >
        <span
          aria-hidden
          className={cn(
            'mt-0.5 size-3.5 shrink-0 rtl:-scale-x-100',
            hasChildren ? (expanded ? 'i-ri-arrow-down-s-line' : 'i-ri-arrow-right-s-line') : '',
          )}
        />
        <span className="min-w-0 truncate">{label}</span>
      </button>
    )
  }

  return (
    <aside className="min-h-52 overflow-hidden xl:flex xl:min-h-0 xl:flex-col">
      <h2 className="px-2 pb-2 system-xs-regular text-text-tertiary">
        {t(($) => $['newKnowledge.documentContents'])}
      </h2>
      {error && !isFetchNextPageError && chunkCount > 0 && (
        <div
          className="flex items-center justify-between gap-2 border-b border-divider-subtle bg-state-warning-hover px-3 py-2 system-xs-regular text-text-warning"
          role="alert"
        >
          <span>{t(($) => $['newKnowledge.documentChunksLoadError'])}</span>
          <Button onClick={onRetry}>{tCommon(($) => $['operation.retry'])}</Button>
        </div>
      )}
      {isPending ? (
        <div className="flex min-h-40 items-center justify-center" role="status">
          <Loading />
          <span className="sr-only">{tCommon(($) => $.loading)}</span>
        </div>
      ) : error && !isFetchNextPageError && !chunkCount ? (
        <div className="p-4 text-center">
          <p className="system-xs-regular text-text-destructive">
            {t(($) => $['newKnowledge.documentChunksLoadError'])}
          </p>
          <Button className="mt-3" onClick={onRetry}>
            {tCommon(($) => $['operation.retry'])}
          </Button>
        </div>
      ) : !chunkCount ? (
        <p className="p-6 text-center system-xs-regular text-text-tertiary">
          {t(($) => $['newKnowledge.documentChunksEmpty'])}
        </p>
      ) : (
        <div
          ref={treeScrollRef}
          aria-activedescendant={
            currentFocusedNodeId ? `document-chunk-treeitem-${currentFocusedNodeId}` : undefined
          }
          aria-label={t(($) => $['newKnowledge.documentContents'])}
          className="max-h-[70vh] space-y-0.5 overflow-auto py-1 pr-5 outline-hidden xl:max-h-none xl:min-h-0 xl:flex-1"
          role="tree"
          tabIndex={0}
          onBlur={() => setTreeHasFocus(false)}
          onFocus={() => setTreeHasFocus(true)}
          onKeyDown={handleTreeKeyDown}
        >
          {shouldVirtualize ? (
            <div className="relative" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
              {virtualRows.map((virtualRow) =>
                renderTreeItem(visibleNodes[virtualRow.index]!, {
                  left: 0,
                  position: 'absolute',
                  top: 0,
                  transform: `translateY(${virtualRow.start}px)`,
                }),
              )}
            </div>
          ) : (
            visibleNodes.map((item) => renderTreeItem(item))
          )}
        </div>
      )}
      {isFetchNextPageError ? (
        <div className="border-t border-divider-subtle p-3 text-center">
          <p className="mb-2 system-xs-regular text-text-destructive" role="alert">
            {t(($) => $['newKnowledge.documentChunksLoadMoreError'])}
          </p>
          <Button
            disabled={isFetchingNextPage}
            loading={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {tCommon(($) => $['operation.retry'])}
          </Button>
        </div>
      ) : (
        (hasNextPage || isFetchingNextPage) && (
          <div className="border-t border-divider-subtle p-3">
            {isFetchingNextPage ? (
              <div aria-hidden>
                <Loading />
              </div>
            ) : (
              <AutomaticChunkPageLoader
                fetchNextPage={fetchNextPage}
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
              />
            )}
          </div>
        )
      )}
    </aside>
  )
}
