import type { DataSourceNotionPage, DataSourceNotionPageMap } from '@/models/common'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Item from './item'
import { recursivePushInParentDescendants } from './utils'

type PageSelectorProps = {
  checkedIds: Set<string>
  disabledValue: Set<string>
  searchValue: string
  pagesMap: DataSourceNotionPageMap
  list: DataSourceNotionPage[]
  onSelect: (selectedPagesId: Set<string>) => void
  canPreview?: boolean
  onPreview?: (selectedPageId: string) => void
  isMultipleChoice?: boolean
  currentCredentialId: string
}

export type NotionPageTreeItem = {
  children: Set<string>
  descendants: Set<string>
  depth: number
  ancestors: string[]
} & DataSourceNotionPage

export type NotionPageTreeMap = Record<string, NotionPageTreeItem>

type NotionPageItem = {
  expand: boolean
  depth: number
} & DataSourceNotionPage

const PageSelector = ({
  checkedIds,
  disabledValue,
  searchValue,
  pagesMap,
  list,
  onSelect,
  canPreview = true,
  onPreview,
  isMultipleChoice = true,
  currentCredentialId,
}: PageSelectorProps) => {
  const { t } = useTranslation()
  const parentRef = useRef<HTMLDivElement>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [currentPreviewPageId, setCurrentPreviewPageId] = useState('')
  const prevCredentialIdRef = useRef(currentCredentialId)

  // Reset expanded state when credential changes (render-time detection)
  if (prevCredentialIdRef.current !== currentCredentialId) {
    prevCredentialIdRef.current = currentCredentialId
    setExpandedIds(new Set())
  }

  const listMapWithChildrenAndDescendants = useMemo(() => {
    return list.reduce((prev: NotionPageTreeMap, next: DataSourceNotionPage) => {
      const pageId = next.page_id
      if (!prev[pageId])
        prev[pageId] = { ...next, children: new Set(), descendants: new Set(), depth: 0, ancestors: [] }

      recursivePushInParentDescendants(pagesMap, prev, prev[pageId], prev[pageId])
      return prev
    }, {})
  }, [list, pagesMap])

  // Compute visible data list based on expanded state
  const dataList = useMemo(() => {
    const result: NotionPageItem[] = []

    const buildVisibleList = (parentId: string | null, depth: number) => {
      const items = parentId === null
        ? list.filter(item => item.parent_id === 'root' || !pagesMap[item.parent_id])
        : list.filter(item => item.parent_id === parentId)

      for (const item of items) {
        const isExpanded = expandedIds.has(item.page_id)
        result.push({
          ...item,
          expand: isExpanded,
          depth,
        })
        if (isExpanded) {
          buildVisibleList(item.page_id, depth + 1)
        }
      }
    }

    buildVisibleList(null, 0)
    return result
  }, [list, pagesMap, expandedIds])

  const searchDataList = useMemo(() => list.filter((item) => {
    return item.page_name.includes(searchValue)
  }).map((item) => {
    return {
      ...item,
      expand: false,
      depth: 0,
    }
  }), [list, searchValue])

  const currentDataList = searchValue ? searchDataList : dataList

  const virtualizer = useVirtualizer({
    count: currentDataList.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 5,
    getItemKey: index => currentDataList[index].page_id,
  })

  const handleToggle = useCallback((index: number) => {
    const current = dataList[index]
    const pageId = current.page_id
    const currentWithChildrenAndDescendants = listMapWithChildrenAndDescendants[pageId]

    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (prev.has(pageId)) {
        // Collapse: remove current and all descendants
        next.delete(pageId)
        for (const descendantId of currentWithChildrenAndDescendants.descendants)
          next.delete(descendantId)
      }
      else {
        // Expand: add current
        next.add(pageId)
      }
      return next
    })
  }, [dataList, listMapWithChildrenAndDescendants])

  const handleCheck = useCallback((index: number) => {
    const copyValue = new Set(checkedIds)
    const current = currentDataList[index]
    const pageId = current.page_id
    const currentWithChildrenAndDescendants = listMapWithChildrenAndDescendants[pageId]

    if (copyValue.has(pageId)) {
      if (!searchValue && isMultipleChoice) {
        for (const item of currentWithChildrenAndDescendants.descendants)
          copyValue.delete(item)
      }

      copyValue.delete(pageId)
    }
    else {
      if (!searchValue && isMultipleChoice) {
        for (const item of currentWithChildrenAndDescendants.descendants)
          copyValue.add(item)
      }
      // Single choice mode, clear previous selection
      if (!isMultipleChoice && copyValue.size > 0) {
        copyValue.clear()
        copyValue.add(pageId)
      }
      else {
        copyValue.add(pageId)
      }
    }

    onSelect(new Set(copyValue))
  }, [currentDataList, isMultipleChoice, listMapWithChildrenAndDescendants, onSelect, searchValue, checkedIds])

  const handlePreview = useCallback((index: number) => {
    const current = currentDataList[index]
    const pageId = current.page_id

    setCurrentPreviewPageId(pageId)

    if (onPreview)
      onPreview(pageId)
  }, [currentDataList, onPreview])

  if (!currentDataList.length) {
    return (
      <div className="flex h-[296px] items-center justify-center text-[13px] text-text-tertiary">
        {t('dataSource.notion.selector.noSearchResult', { ns: 'common' })}
      </div>
    )
  }

  return (
    <div
      ref={parentRef}
      className="py-2"
      style={{ height: 296, width: '100%', overflow: 'auto' }}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const current = currentDataList[virtualRow.index]
          return (
            <Item
              key={virtualRow.key}
              index={virtualRow.index}
              virtualStart={virtualRow.start}
              virtualSize={virtualRow.size}
              current={current}
              handleToggle={handleToggle}
              checkedIds={checkedIds}
              disabledCheckedIds={disabledValue}
              handleCheck={handleCheck}
              canPreview={canPreview}
              handlePreview={handlePreview}
              listMapWithChildrenAndDescendants={listMapWithChildrenAndDescendants}
              searchValue={searchValue}
              previewPageId={currentPreviewPageId}
              pagesMap={pagesMap}
              isMultipleChoice={isMultipleChoice}
            />
          )
        })}
      </div>
    </div>
  )
}

export default PageSelector
