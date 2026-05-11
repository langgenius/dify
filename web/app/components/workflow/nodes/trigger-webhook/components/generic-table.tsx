'use client'
import type { FC, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { RiDeleteBinLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import Checkbox from '@/app/components/base/checkbox'
import Input from '@/app/components/base/input'
import { replaceSpaceWithUnderscoreInVarNameInput } from '@/utils/var'

// Tiny utility to judge whether a cell value is effectively present
const isPresent = (v: unknown): boolean => {
  if (typeof v === 'string')
    return v.trim() !== ''
  return !(v === '' || v === null || v === undefined || v === false)
}
// Column configuration types for table components
type ColumnType = 'input' | 'select' | 'switch' | 'custom'

type SelectOption = {
  name: string
  value: string
}

export type ColumnConfig = {
  key: string
  title: string
  type: ColumnType
  width?: string // CSS class for width (e.g., 'w-1/2', 'w-[140px]')
  placeholder?: string
  options?: SelectOption[] // For select type
  render?: (value: unknown, row: GenericTableRow, index: number, onChange: (value: unknown) => void) => ReactNode
  required?: boolean
}

export type GenericTableRow = {
  [key: string]: unknown
}

type GenericTableProps = {
  title: string
  columns: ColumnConfig[]
  data: GenericTableRow[]
  onChange: (data: GenericTableRow[]) => void
  readonly?: boolean
  placeholder?: string
  emptyRowData: GenericTableRow // Template for new empty rows
  className?: string
  showHeader?: boolean // Whether to show column headers
}

// Internal type for stable mapping between rendered rows and data indices
type DisplayRow = {
  row: GenericTableRow
  dataIndex: number | null // null indicates the trailing UI-only row
  isVirtual: boolean // whether this row is the extra empty row for adding new items
}

const isEmptyRow = (row: GenericTableRow) => {
  return Object.values(row).every(v => v === '' || v === null || v === undefined || v === false)
}

const getDisplayRows = (
  data: GenericTableRow[],
  emptyRowData: GenericTableRow,
  readonly: boolean,
): DisplayRow[] => {
  if (readonly)
    return data.map((row, index) => ({ row, dataIndex: index, isVirtual: false }))

  if (!data.length)
    return [{ row: { ...emptyRowData }, dataIndex: null, isVirtual: true }]

  const rows = data.reduce<DisplayRow[]>((acc, row, index) => {
    if (isEmptyRow(row) && index < data.length - 1)
      return acc

    acc.push({ row, dataIndex: index, isVirtual: false })
    return acc
  }, [])

  const lastRow = data.at(-1)
  if (lastRow && !isEmptyRow(lastRow))
    rows.push({ row: { ...emptyRowData }, dataIndex: null, isVirtual: true })

  return rows
}

const getPrimaryKey = (columns: ColumnConfig[]) => {
  return columns.find(col => col.key === 'key' || col.key === 'name')?.key ?? 'key'
}

const renderInputCell = (
  column: ColumnConfig,
  value: unknown,
  readonly: boolean,
  handleChange: (value: unknown) => void,
) => {
  return (
    <Input
      value={(value as string) || ''}
      onChange={(e) => {
        if (column.key === 'key' || column.key === 'name')
          replaceSpaceWithUnderscoreInVarNameInput(e.target)
        handleChange(e.target.value)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      placeholder={column.placeholder}
      disabled={readonly}
      wrapperClassName="w-full min-w-0"
      className={cn(
        'h-6 rounded-none border-0 bg-transparent px-0 py-0 shadow-none',
        'hover:border-transparent hover:bg-transparent focus:border-transparent focus:bg-transparent',
        'system-sm-regular text-text-secondary placeholder:text-text-quaternary',
      )}
    />
  )
}

const renderSelectCell = (
  column: ColumnConfig,
  value: unknown,
  readonly: boolean,
  handleChange: (value: unknown) => void,
) => {
  const options = column.options || []
  const selectedOption = options.find(option => option.value === value) ?? null

  return (
    <Select
      value={selectedOption?.value ?? null}
      onValueChange={nextValue => nextValue && handleChange(nextValue)}
      disabled={readonly}
    >
      <SelectTrigger
        size="small"
        className={cn(
          'h-6 w-full min-w-0 rounded-none bg-transparent py-0 pr-6 pl-0 text-text-secondary',
          'hover:bg-transparent focus-visible:bg-transparent',
        )}
      >
        {selectedOption?.name ?? column.placeholder}
      </SelectTrigger>
      <SelectContent className="-translate-x-3" popupClassName="w-26 min-w-26">
        {options.map(option => (
          <SelectItem key={option.value} value={option.value}>
            <SelectItemText>{option.name}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const renderSwitchCell = (
  column: ColumnConfig,
  value: unknown,
  dataIndex: number | null,
  readonly: boolean,
  handleChange: (value: unknown) => void,
) => {
  return (
    <div className="flex h-7 items-center">
      <Checkbox
        id={`${column.key}-${String(dataIndex ?? 'v')}`}
        checked={Boolean(value)}
        onCheck={() => handleChange(!value)}
        disabled={readonly}
      />
    </div>
  )
}

const renderCustomCell = (
  column: ColumnConfig,
  value: unknown,
  row: GenericTableRow,
  dataIndex: number | null,
  handleChange: (value: unknown) => void,
) => {
  return column.render ? column.render(value, row, (dataIndex ?? -1), handleChange) : null
}

const GenericTable: FC<GenericTableProps> = ({
  title,
  columns,
  data,
  onChange,
  readonly = false,
  placeholder,
  emptyRowData,
  className,
  showHeader = false,
}) => {
  const displayRows = useMemo<DisplayRow[]>(() => {
    return getDisplayRows(data, emptyRowData, readonly)
  }, [data, emptyRowData, readonly])

  const removeRow = useCallback((dataIndex: number) => {
    if (readonly)
      return
    if (dataIndex < 0 || dataIndex >= data.length)
      return // ignore virtual rows
    const newData = data.filter((_, i) => i !== dataIndex)
    onChange(newData)
  }, [data, readonly, onChange])

  const updateRow = useCallback((dataIndex: number | null, key: string, value: unknown) => {
    if (readonly)
      return

    if (dataIndex !== null && dataIndex < data.length) {
      // Editing existing configured row
      const newData = [...data]
      newData[dataIndex] = { ...newData[dataIndex], [key]: value }
      onChange(newData)
      return
    }

    // Editing the trailing UI-only empty row: create a new configured row
    const newRow = { ...emptyRowData, [key]: value }
    const next = [...data, newRow]
    onChange(next)
  }, [data, emptyRowData, onChange, readonly])

  // Determine the primary identifier column just once
  const primaryKey = useMemo(() => getPrimaryKey(columns), [columns])

  const renderCell = (column: ColumnConfig, row: GenericTableRow, dataIndex: number | null) => {
    const value = row[column.key]
    const handleChange = (newValue: unknown) => updateRow(dataIndex, column.key, newValue)

    switch (column.type) {
      case 'input':
        return renderInputCell(column, value, readonly, handleChange)

      case 'select':
        return renderSelectCell(column, value, readonly, handleChange)

      case 'switch':
        return renderSwitchCell(column, value, dataIndex, readonly, handleChange)

      case 'custom':
        return renderCustomCell(column, value, row, dataIndex, handleChange)

      default:
        return null
    }
  }

  const renderTable = () => {
    return (
      <div className="rounded-lg border border-divider-regular">
        {showHeader && (
          <div className="flex h-7 items-center system-xs-medium-uppercase leading-7 text-text-tertiary">
            {columns.map((column, index) => (
              <div
                key={column.key}
                className={cn(
                  'flex h-full items-center pl-3',
                  column.width && column.width.startsWith('w-') ? 'shrink-0' : 'flex-1',
                  column.width,
                  // Add right border except for last column
                  index < columns.length - 1 && 'border-r border-divider-regular',
                )}
              >
                {column.title}
              </div>
            ))}
          </div>
        )}
        <div className="divide-y divide-divider-subtle">
          {displayRows.map(({ row, dataIndex, isVirtual: _isVirtual }, renderIndex) => {
            const rowKey = `row-${renderIndex}`

            // Check if primary identifier column has content
            const primaryValue = row[primaryKey]
            const hasContent = isPresent(primaryValue)

            return (
              <div
                key={rowKey}
                className={cn(
                  'group relative flex border-t border-divider-regular',
                  hasContent ? 'hover:bg-state-destructive-hover' : 'hover:bg-state-base-hover',
                )}
                style={{ minHeight: '28px' }}
              >
                {columns.map((column, columnIndex) => (
                  <div
                    key={column.key}
                    className={cn(
                      'shrink-0 pl-3',
                      column.width,
                      // Add right border except for last column
                      columnIndex < columns.length - 1 && 'border-r border-divider-regular',
                    )}
                  >
                    {renderCell(column, row, dataIndex)}
                  </div>
                ))}
                {!readonly && dataIndex !== null && hasContent && (
                  <div className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => removeRow(dataIndex)}
                      className="p-1"
                      aria-label="Delete row"
                    >
                      {/* eslint-disable-next-line hyoban/prefer-tailwind-icons */}
                      <RiDeleteBinLine className="h-3.5 w-3.5 text-text-destructive" />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Show placeholder only when readonly and there is no data configured
  const showPlaceholder = readonly && data.length === 0

  return (
    <div className={className}>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="system-sm-semibold-uppercase text-text-secondary">{title}</h4>
      </div>

      {showPlaceholder
        ? (
            <div className="flex h-7 items-center justify-center rounded-lg border border-divider-regular bg-components-panel-bg text-xs leading-[18px] font-normal text-text-quaternary">
              {placeholder}
            </div>
          )
        : (
            renderTable()
          )}
    </div>
  )
}

export default React.memo(GenericTable)
