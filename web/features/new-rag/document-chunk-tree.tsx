'use client'

import type { DocumentChunkTree } from './document-detail-model'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { chunkTreeLabel, visibleDocumentChunkNodes } from './document-detail-model'

const VIRTUALIZATION_THRESHOLD = 80
const TREE_ROW_HEIGHT = 56

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
  const [collapsedChunkIds, setCollapsedChunkIds] = useState<Set<string>>(() => new Set())
  const [focusedChunkId, setFocusedChunkId] = useState<string>()
  const [treeHasFocus, setTreeHasFocus] = useState(false)
  const treeScrollRef = useRef<HTMLDivElement>(null)
  const loadMoreRequestedRef = useRef(false)
  const chunkIdsBeforeLoadRef = useRef<Set<string>>(new Set())
  const wasFetchingNextPageRef = useRef(false)
  const expandedChunkIds = useMemo(
    () => new Set([...tree.byId.keys()].filter((id) => !collapsedChunkIds.has(id))),
    [collapsedChunkIds, tree.byId],
  )
  const visibleNodes = useMemo(
    () => visibleDocumentChunkNodes(tree.roots, expandedChunkIds),
    [expandedChunkIds, tree.roots],
  )
  const shouldVirtualize = visibleNodes.length > VIRTUALIZATION_THRESHOLD
  const currentFocusedChunkId = focusedChunkId ?? visibleNodes[0]?.node.chunk.id
  const focusedIndex = visibleNodes.findIndex(
    (item) => item.node.chunk.id === currentFocusedChunkId,
  )
  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? visibleNodes.length : 0,
    estimateSize: () => TREE_ROW_HEIGHT,
    getItemKey: (index) => visibleNodes[index]?.node.chunk.id ?? index,
    getScrollElement: () => treeScrollRef.current,
    overscan: 8,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range)
      if (focusedIndex >= 0 && !indexes.includes(focusedIndex)) indexes.push(focusedIndex)
      return indexes.sort((left, right) => left - right)
    },
  })
  const rowVirtualizerRef = useRef(rowVirtualizer)
  rowVirtualizerRef.current = rowVirtualizer
  const virtualRows = rowVirtualizer.getVirtualItems()

  const toggleExpanded = (chunkId: string) => {
    setCollapsedChunkIds((current) => {
      const next = new Set(current)
      if (next.has(chunkId)) next.delete(chunkId)
      else next.add(chunkId)
      return next
    })
  }

  const focusChunk = (chunkId: string) => {
    const index = visibleNodes.findIndex((item) => item.node.chunk.id === chunkId)
    if (index < 0) return
    setFocusedChunkId(chunkId)
    if (shouldVirtualize) rowVirtualizer.scrollToIndex(index, { align: 'auto' })
    treeScrollRef.current?.focus()
  }

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const chunkId = currentFocusedChunkId
    if (!chunkId) return
    const index = visibleNodes.findIndex((item) => item.node.chunk.id === chunkId)
    const current = visibleNodes[index]
    if (!current) return
    const parentId = current.node.chunk.parentChunkId
    let nextId: string | undefined
    if (event.key === 'ArrowDown') nextId = visibleNodes[index + 1]?.node.chunk.id
    else if (event.key === 'ArrowUp') nextId = visibleNodes[index - 1]?.node.chunk.id
    else if (event.key === 'Home') nextId = visibleNodes[0]?.node.chunk.id
    else if (event.key === 'End') nextId = visibleNodes.at(-1)?.node.chunk.id
    else if (event.key === 'ArrowRight' && current.node.children.length) {
      if (collapsedChunkIds.has(chunkId)) toggleExpanded(chunkId)
      else nextId = current.node.children[0]?.chunk.id
    } else if (event.key === 'ArrowLeft') {
      if (current.node.children.length && !collapsedChunkIds.has(chunkId)) toggleExpanded(chunkId)
      else if (parentId && tree.byId.has(parentId)) nextId = parentId
    } else if (event.key === 'Enter' || event.key === ' ') onSelectChunk(chunkId)
    else return
    event.preventDefault()
    if (nextId) focusChunk(nextId)
  }

  const handleLoadMore = () => {
    if (isFetchingNextPage) return
    chunkIdsBeforeLoadRef.current = new Set(tree.byId.keys())
    loadMoreRequestedRef.current = true
    void fetchNextPage()
  }

  useEffect(() => {
    if (isFetchingNextPage) wasFetchingNextPageRef.current = true
    if (isFetchingNextPage || !wasFetchingNextPageRef.current || !loadMoreRequestedRef.current)
      return
    wasFetchingNextPageRef.current = false
    loadMoreRequestedRef.current = false
    if (isFetchNextPageError) return
    const firstNewNode = visibleNodes.find(
      (item) => !chunkIdsBeforeLoadRef.current.has(item.node.chunk.id),
    )
    requestAnimationFrame(() => {
      if (!firstNewNode) {
        treeScrollRef.current?.focus()
        return
      }
      const chunkId = firstNewNode.node.chunk.id
      const index = visibleNodes.findIndex((item) => item.node.chunk.id === chunkId)
      setFocusedChunkId(chunkId)
      if (shouldVirtualize) rowVirtualizerRef.current.scrollToIndex(index, { align: 'auto' })
      treeScrollRef.current?.focus()
    })
  }, [isFetchNextPageError, isFetchingNextPage, shouldVirtualize, visibleNodes])

  const renderTreeItem = (item: (typeof visibleNodes)[number], style?: React.CSSProperties) => {
    const { depth, node, positionInSet, setSize } = item
    const { chunk } = node
    const hasChildren = node.children.length > 0
    const expanded = !collapsedChunkIds.has(chunk.id)
    const label = chunkTreeLabel(chunk.text, chunk.ordinal)
    return (
      <button
        key={chunk.id}
        id={`document-chunk-treeitem-${chunk.id}`}
        aria-expanded={hasChildren ? expanded : undefined}
        aria-label={label}
        aria-level={depth + 1}
        aria-posinset={positionInSet}
        aria-selected={selectedChunkId === chunk.id}
        aria-setsize={hasNextPage ? -1 : setSize}
        className={cn(
          'flex w-full items-start gap-1.5 rounded-lg py-2 pr-2 text-left system-xs-regular outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset',
          selectedChunkId === chunk.id && 'bg-state-accent-hover text-text-accent',
          treeHasFocus &&
            currentFocusedChunkId === chunk.id &&
            'bg-state-base-hover ring-1 ring-state-accent-solid ring-inset',
        )}
        role="treeitem"
        style={{ ...style, paddingInlineStart: `${8 + depth * 16}px` }}
        tabIndex={-1}
        onClick={() => {
          setFocusedChunkId(chunk.id)
          treeScrollRef.current?.focus()
          onSelectChunk(chunk.id)
          if (hasChildren) toggleExpanded(chunk.id)
        }}
      >
        <span
          aria-hidden
          className={cn(
            'mt-0.5 size-4 shrink-0 rtl:-scale-x-100',
            hasChildren
              ? expanded
                ? 'i-ri-arrow-down-s-line'
                : 'i-ri-arrow-right-s-line'
              : 'i-ri-file-text-line text-text-tertiary',
          )}
        />
        <span className="line-clamp-2 min-w-0 break-words">{label}</span>
      </button>
    )
  }

  return (
    <aside className="min-h-52 overflow-hidden rounded-xl border border-divider-subtle bg-background-default-subtle">
      <h2 className="border-b border-divider-subtle px-4 py-3 system-sm-semibold text-text-primary">
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
            currentFocusedChunkId ? `document-chunk-treeitem-${currentFocusedChunkId}` : undefined
          }
          aria-label={t(($) => $['newKnowledge.documentContents'])}
          className="max-h-[58vh] overflow-auto p-2 outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset"
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
                  height: `${virtualRow.size}px`,
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
      {(hasNextPage || isFetchNextPageError) && (
        <div className="border-t border-divider-subtle p-3 text-center">
          {isFetchNextPageError && (
            <p className="mb-2 system-xs-regular text-text-destructive" role="alert">
              {t(($) => $['newKnowledge.documentChunksLoadMoreError'])}
            </p>
          )}
          <Button
            disabled={isFetchingNextPage}
            loading={isFetchingNextPage}
            onClick={handleLoadMore}
          >
            {isFetchNextPageError
              ? tCommon(($) => $['operation.retry'])
              : t(($) => $['newKnowledge.loadMore'])}
          </Button>
        </div>
      )}
    </aside>
  )
}
