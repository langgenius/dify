'use client'

import type { ReactNode, RefObject } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState } from 'react'

type GridLayout = {
  columnCount: number
  rowGap: number
}

const initialLayout: GridLayout = { columnCount: 1, rowGap: 0 }

const readGridLayout = (grid: Element): GridLayout => {
  const style = window.getComputedStyle(grid)
  const template = style.gridTemplateColumns

  return {
    columnCount:
      !template || template === 'none'
        ? 1
        : Math.max(1, template.split(' ').filter(Boolean).length),
    rowGap: Number.parseFloat(style.rowGap) || 0,
  }
}

type VirtualizedCardGridProps<TItem> = Readonly<{
  /**
   * Grid classes only — column tracks and gap. Keep padding on a wrapper, because
   * these classes are applied to every rendered row as well as the container.
   */
  className?: string
  getItemKey: (item: TItem, index: number) => string
  items: readonly TItem[]
  overscan?: number
  renderItem: (item: TItem, index: number) => ReactNode
  /** Height of a single card, mirroring the height class the card renders at. */
  rowHeight: number
  scrollContainerRef: RefObject<Element | null>
}>

/**
 * Renders a responsive card grid one row at a time, so a list that has grown to
 * hundreds of cards only mounts and paints the rows near the viewport.
 *
 * The column count and row gap are read back from the resolved grid styles rather
 * than passed in, so callers keep owning their own track sizing in CSS and the two
 * cannot drift apart.
 */
export function VirtualizedCardGrid<TItem>({
  className,
  getItemKey,
  items,
  overscan = 2,
  renderItem,
  rowHeight,
  scrollContainerRef,
}: VirtualizedCardGridProps<TItem>) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<GridLayout>(initialLayout)

  useEffect(() => {
    const grid = gridRef.current
    if (!grid || typeof ResizeObserver === 'undefined') return

    const measure = () => {
      const next = readGridLayout(grid)
      setLayout((current) =>
        current.columnCount === next.columnCount && current.rowGap === next.rowGap ? current : next,
      )
    }

    // `observe` already delivers an initial callback, so nothing is measured
    // synchronously here.
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [])

  const rows = useMemo(() => {
    const chunked: TItem[][] = []
    for (let index = 0; index < items.length; index += layout.columnCount)
      chunked.push(items.slice(index, index + layout.columnCount) as TItem[])

    return chunked
  }, [items, layout.columnCount])

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => rowHeight,
    gap: layout.rowGap,
    getItemKey: (index) => {
      const firstItem = rows[index]?.[0]

      return firstItem === undefined ? index : getItemKey(firstItem, index * layout.columnCount)
    },
    getScrollElement: () => scrollContainerRef.current as HTMLElement | null,
    overscan,
  })

  return (
    <div
      ref={gridRef}
      className={cn('relative', className)}
      style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
    >
      {rowVirtualizer.getVirtualItems().map((virtualRow) => (
        <div
          key={virtualRow.key}
          className={cn('absolute top-0 left-0 w-full', className)}
          style={{
            height: `${virtualRow.size}px`,
            transform: `translateY(${virtualRow.start}px)`,
          }}
        >
          {rows[virtualRow.index]?.map((item, columnIndex) =>
            renderItem(item, virtualRow.index * layout.columnCount + columnIndex),
          )}
        </div>
      ))}
    </div>
  )
}
