import type { TFunction } from 'i18next'
import type { FC } from 'react'
import type { SQLiteValue } from '../../hooks/use-sqlite-database'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

type DataTableProps = {
  columns: string[]
  values: SQLiteValue[][]
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
  return `${value.slice(0, MAX_CELL_LENGTH)}...`
}

const DataTable: FC<DataTableProps> = ({ columns, values }) => {
  const { t } = useTranslation('workflow')
  const keyColumnIndex = useMemo(() => {
    const candidates = new Set(['id', 'rowid', 'uuid'])
    return columns.findIndex(column => candidates.has(column.toLowerCase()))
  }, [columns])

  const rows = useMemo(() => {
    return values.map((row) => {
      const rowKey = keyColumnIndex >= 0
        ? String(row[keyColumnIndex] ?? '')
        : row.map((value) => {
            if (value instanceof Uint8Array)
              return `blob:${value.byteLength}`
            return String(value ?? '')
          }).join('|')

      const cells = row.map((value) => {
        const rawValue = formatValue(value, t)
        return {
          rawValue,
          displayValue: truncateValue(rawValue),
          isNull: value === null,
        }
      })

      return {
        key: rowKey,
        cells,
      }
    })
  }, [keyColumnIndex, t, values])

  return (
    <table className="min-w-full table-auto border-separate border-spacing-0">
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
        {rows.map(row => (
          <tr key={row.key}>
            {row.cells.map((cell, cellIndex) => (
              <td
                key={`${row.key}-${columns[cellIndex]}`}
                className={cn(
                  'px-2 py-1.5 align-middle',
                  'border-b border-r border-divider-subtle',
                  cellIndex === 0 && 'border-l',
                )}
              >
                <div className={cn('system-xs-regular max-w-[240px] truncate', cell.isNull && 'text-text-quaternary')} title={cell.rawValue}>
                  {cell.displayValue}
                </div>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default React.memo(DataTable)
