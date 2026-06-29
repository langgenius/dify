'use client'

import type { NotionPageRow, NotionPageSelectionMode } from './types'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import { useTranslation } from '#i18n'
import PageRow from './page-row'

type VirtualPageListProps = {
  checkedIds: Set<string>
  disabledValue: Set<string>
  onPreview: (pageId: string) => void
  onSelect: (pageId: string) => void
  onToggle: (pageId: string) => void
  previewPageId: string
  rows: NotionPageRow[]
  searchValue: string
  selectionMode: NotionPageSelectionMode
  showPreview: boolean
}

const rowHeight = 28

const VirtualPageList = ({
  checkedIds,
  disabledValue,
  onPreview,
  onSelect,
  onToggle,
  previewPageId,
  rows,
  searchValue,
  selectionMode,
  showPreview,
}: VirtualPageListProps) => {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => rowHeight,
    getScrollElement: () => scrollRef.current,
    overscan: 6,
    paddingEnd: 8,
    paddingStart: 8,
  })

  const virtualRows = rowVirtualizer.getVirtualItems()
  const selectedPageId = checkedIds.values().next().value
  const rowNodes = virtualRows.map((virtualRow) => {
    const row = rows[virtualRow.index]!
    const pageId = row.page.page_id

    return (
      <PageRow
        key={pageId}
        checked={checkedIds.has(pageId)}
        disabled={disabledValue.has(pageId)}
        isPreviewed={previewPageId === pageId}
        onPreview={onPreview}
        onSelect={onSelect}
        onToggle={onToggle}
        row={row}
        searchValue={searchValue}
        selectionMode={selectionMode}
        showPreview={showPreview}
        style={{
          height: `${virtualRow.size}px`,
          left: 8,
          position: 'absolute',
          top: 0,
          transform: `translateY(${virtualRow.start}px)`,
          width: 'calc(100% - 16px)',
        }}
      />
    )
  })

  return (
    <div
      ref={scrollRef}
      className="h-[296px] overflow-auto"
      data-testid="virtual-list"
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {selectionMode === 'single'
          ? (
              <RadioGroup
                aria-label={t('dataSource.notion.selector.headerTitle', { ns: 'common' })}
                value={selectedPageId}
                onValueChange={onSelect}
                className="contents"
              >
                {rowNodes}
              </RadioGroup>
            )
          : rowNodes}
      </div>
    </div>
  )
}

export default VirtualPageList
