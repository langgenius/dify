import type { NotionPageSelectionMode } from './types'
import type { DataSourceNotionPage, DataSourceNotionPageMap } from '@/models/common'
import { startTransition, useCallback, useDeferredValue, useMemo, useState } from 'react'
import { buildNotionPageTree, getNextSelectedPageIds, getRootPageIds, getVisiblePageRows } from './utils'

type UsePageSelectorModelProps = {
  checkedIds: Set<string>
  searchValue: string
  pagesMap: DataSourceNotionPageMap
  list: DataSourceNotionPage[]
  onSelect: (selectedPagesId: Set<string>) => void
  previewPageId?: string
  onPreview?: (selectedPageId: string) => void
  selectionMode: NotionPageSelectionMode
}

export const usePageSelectorModel = ({
  checkedIds,
  searchValue,
  pagesMap,
  list,
  onSelect,
  previewPageId,
  onPreview,
  selectionMode,
}: UsePageSelectorModelProps) => {
  const deferredSearchValue = useDeferredValue(searchValue)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [localPreviewPageId, setLocalPreviewPageId] = useState('')

  const treeMap = useMemo(() => buildNotionPageTree(list, pagesMap), [list, pagesMap])
  const rootPageIds = useMemo(() => getRootPageIds(list, pagesMap), [list, pagesMap])

  const rows = useMemo(() => {
    return getVisiblePageRows({
      list,
      pagesMap,
      searchValue: deferredSearchValue,
      treeMap,
      rootPageIds,
      expandedIds,
    })
  }, [deferredSearchValue, expandedIds, list, pagesMap, rootPageIds, treeMap])

  const currentPreviewPageId = previewPageId ?? localPreviewPageId

  const handleToggle = useCallback((pageId: string) => {
    startTransition(() => {
      setExpandedIds((currentExpandedIds) => {
        const nextExpandedIds = new Set(currentExpandedIds)

        if (nextExpandedIds.has(pageId)) {
          nextExpandedIds.delete(pageId)
          treeMap[pageId]?.descendants.forEach(descendantId => nextExpandedIds.delete(descendantId))
        }
        else {
          nextExpandedIds.add(pageId)
        }

        return nextExpandedIds
      })
    })
  }, [treeMap])

  const handleSelect = useCallback((pageId: string) => {
    onSelect(getNextSelectedPageIds({
      checkedIds,
      pageId,
      searchValue: deferredSearchValue,
      selectionMode,
      treeMap,
    }))
  }, [checkedIds, deferredSearchValue, onSelect, selectionMode, treeMap])

  const handlePreview = useCallback((pageId: string) => {
    setLocalPreviewPageId(pageId)
    onPreview?.(pageId)
  }, [onPreview])

  return {
    currentPreviewPageId,
    effectiveSearchValue: deferredSearchValue,
    rows,
    handlePreview,
    handleSelect,
    handleToggle,
  }
}
