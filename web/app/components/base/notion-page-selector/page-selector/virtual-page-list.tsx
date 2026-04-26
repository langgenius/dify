'use client'

import type { NotionPageRow, NotionPageSelectionMode } from './types'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
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
        {virtualRows.map((virtualRow) => {
          const row = rows[virtualRow.index]!
          const pageId = row!.page.page_id

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
        })}
      </div>
    </div>
  )
}

export default VirtualPageList
