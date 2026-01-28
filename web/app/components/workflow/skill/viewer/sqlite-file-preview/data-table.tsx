import type { TFunction } from 'i18next'
import type { RefObject } from 'react'
import type { SQLiteValue } from '../../hooks/use-sqlite-database'
import { useVirtualizer } from '@tanstack/react-virtual'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

type DataTableProps = {
  columns: string[]
  values: SQLiteValue[][]
  scrollRef: RefObject<HTMLDivElement | null>
  isTruncated?: boolean
}

const MAX_CELL_LENGTH = 120

const formatValue = (value: SQLiteValue, t: TFunction<'workflow'>): string => {
  if (value === null)
    return t('skillSidebar.sqlitePreview.nullValue')
  if (value instanceof Uint8Array)
    return t('skillSidebar.sqlitePreview.blobValue', { size: value.byteLength })
  if (typeof value === 'bigint')
    return value.toString()
  return String(value)
}

const truncateValue = (value: string): string => {
  if (value.length <= MAX_CELL_LENGTH)
    return value
  return `${value.slice(0, MAX_CELL_LENGTH)}…`
}

const DataTable = ({ columns, values, scrollRef, isTruncated = false }: DataTableProps) => {
  const { t } = useTranslation('workflow')
  const keyColumnIndex = useMemo(() => {
    const candidates = new Set(['id', 'rowid', 'uuid'])
    return columns.findIndex(column => candidates.has(column.toLowerCase()))
  }, [columns])

  const rowVirtualizer = useVirtualizer({
    count: values.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 32,
    overscan: 8,
  })

  const virtualRows = rowVirtualizer.getVirtualItems()
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0
  const paddingBottom = virtualRows.length > 0
    ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
    : 0

  return (
    <table className="w-max min-w-full table-auto border-separate border-spacing-0">
      <thead className="sticky top-0 z-10 text-text-secondary">
        <tr>
          {columns.map(column => (
            <th
              key={column}
              className={cn('border-b border-r border-t border-divider-subtle bg-background-section px-2 py-1.5 text-left align-middle first:rounded-tl-lg first:border-l last:rounded-tr-lg')}
            >
              <span className="system-xs-medium block truncate">{column}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="text-text-secondary">
        {paddingTop > 0 && (
          <tr aria-hidden="true">
            <td colSpan={columns.length} className="border-none p-0" style={{ height: paddingTop }} />
          </tr>
        )}
        {virtualRows.map((virtualRow) => {
          const row = values[virtualRow.index]
          const rowKey = keyColumnIndex >= 0
            ? String(row[keyColumnIndex] ?? virtualRow.index)
            : String(virtualRow.index)

          return (
            <tr key={rowKey}>
              {row.map((value, cellIndex) => {
                const rawValue = formatValue(value, t)
                const displayValue = truncateValue(rawValue)
                return (
                  <td
                    key={`${rowKey}-${columns[cellIndex]}`}
                    className={cn(
                      'px-2 py-1.5 align-middle',
                      'border-b border-r border-divider-subtle',
                      cellIndex === 0 && 'border-l',
                    )}
                  >
                    <div className={cn('system-xs-regular max-w-[240px] truncate', value === null && 'text-text-quaternary')} title={rawValue}>
                      {displayValue}
                    </div>
                  </td>
                )
              })}
            </tr>
          )
        })}
        {paddingBottom > 0 && (
          <tr aria-hidden="true">
            <td colSpan={columns.length} className="border-none p-0" style={{ height: paddingBottom }} />
          </tr>
        )}
      </tbody>
      {isTruncated && (
        <tfoot>
          <tr>
            <td
              colSpan={columns.length}
              className="border-b border-l border-r border-divider-subtle bg-background-section-burn px-2 py-1.5 text-center first:rounded-bl-lg last:rounded-br-lg"
            >
              <span className="system-xs-regular text-text-tertiary">
                {t('skillSidebar.sqlitePreview.rowsTruncated', { limit: values.length })}
              </span>
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  )
}

export default React.memo(DataTable)
