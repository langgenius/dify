'use client'
import type { FC, ReactNode } from 'react'
import React, { useCallback, useEffect, useRef } from 'react'
import { RiDeleteBinLine } from '@remixicon/react'
import Input from '@/app/components/base/input'
import Checkbox from '@/app/components/base/checkbox'
import Select from '@/app/components/base/select'
import cn from '@/utils/classnames'

// Column configuration types for table components
export type ColumnType = 'input' | 'select' | 'switch' | 'custom'

export type SelectOption = {
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
  render?: (value: any, row: any, index: number, onChange: (value: any) => void) => ReactNode // For custom type
  required?: boolean
}

export type GenericTableRow = {
  [key: string]: any
}

type GenericTableProps = {
  title: string
  columns: ColumnConfig[]
  data: GenericTableRow[]
  onChange: (data: GenericTableRow[]) => void
  readonly?: boolean
  placeholder?: string
  defaultRowData?: GenericTableRow // Default data for the first row
  emptyRowData: GenericTableRow // Template for new empty rows
  className?: string
  showHeader?: boolean // Whether to show column headers
}

const GenericTable: FC<GenericTableProps> = ({
  title,
  columns,
  data,
  onChange,
  readonly = false,
  placeholder,
  defaultRowData,
  emptyRowData,
  className,
  showHeader = false,
}) => {
  // no translation needed

  const isInitialized = useRef(false)

  // Initialize with default data if provided and data is empty
  useEffect(() => {
    if (!isInitialized.current && data.length === 0 && defaultRowData) {
      onChange([defaultRowData, { ...emptyRowData }])
      isInitialized.current = true
    }
  }, [data.length, defaultRowData, emptyRowData, onChange])

  // addRow removed: rows are added automatically when editing the last row

  const removeRow = useCallback((index: number) => {
    if (readonly) return
    const newData = data.filter((_, i) => i !== index)
    onChange(newData)
  }, [data, readonly, onChange])

  const updateRow = useCallback((index: number, key: string, value: any) => {
    const newData = [...data]
    newData[index] = { ...newData[index], [key]: value }

    // If user is editing the last row and it now has content, append an empty row once
    let nextData = newData
    if (!readonly && index === data.length - 1) {
      const lastRow = newData[newData.length - 1]
      const hasContent = Object.values(lastRow).some(v => v !== '' && v !== null && v !== undefined && v !== false)
      const lastRowIsEmpty = Object.values(lastRow).every(v => v === '' || v === null || v === undefined || v === false)
      if (hasContent && !lastRowIsEmpty)
        nextData = [...newData, { ...emptyRowData }]
    }

    onChange(nextData)
  }, [data, readonly, emptyRowData, onChange])

  const renderCell = (column: ColumnConfig, row: GenericTableRow, rowIndex: number) => {
    const value = row[column.key]
    const handleChange = (newValue: any) => updateRow(rowIndex, column.key, newValue)

    switch (column.type) {
      case 'input':
        return (
          <Input
            value={value || ''}
            onChange={e => handleChange(e.target.value)}
            placeholder={column.placeholder}
            disabled={readonly}
          />
        )

      case 'select':
        return (
          <Select
            items={column.options || []}
            defaultValue={value}
            onSelect={item => handleChange(item.value)}
            disabled={readonly}
            allowSearch={false}
          />
        )

      case 'switch':
        return (
          <Checkbox
            id={`${column.key}-${rowIndex}`}
            checked={!!value}
            onCheck={() => handleChange(!value)}
            disabled={readonly}
            className="!h-4 !w-4"
          />
        )

      case 'custom':
        return column.render ? column.render(value, row, rowIndex, handleChange) : null

      default:
        return null
    }
  }

  // Render table layout matching the prototype design
  const renderTable = () => {
    return (
      <div>
        {showHeader && (
          <div className="mb-1 flex items-center gap-2 px-1">
            {columns.map(column => (
              <div key={column.key} className={cn('text-xs uppercase text-text-tertiary', column.width || 'flex-1')}>
                {column.title}
              </div>
            ))}
          </div>
        )}
        <div className="">
          {data.map((row, rowIndex) => {
            // Don't show empty rows except the last one
            const isEmpty = Object.values(row).every(value =>
              value === '' || value === null || value === undefined || value === false,
            )
            if (isEmpty && rowIndex < data.length - 1)
              return null

            // Create a stable key using row content or index
            const rowKey = row.key || row.name || `row-${rowIndex}`
            return (
              <div
                key={rowKey}
                className="group relative flex items-center gap-2 border-b border-divider-subtle py-1.5"
              >
                {columns.map(column => (
                  <div key={column.key} className={cn('relative shrink-0', column.width || 'flex-1')}>
                    {renderCell(column, row, rowIndex)}
                  </div>
                ))}
                {/* Row-level delete button: only show when row has content and on hover */}
                {!readonly && data.length > 1 && !isEmpty && (
                  <button
                    type="button"
                    onClick={() => removeRow(rowIndex)}
                    className="absolute right-1.5 top-1/2 z-10 -translate-y-1/2 text-text-tertiary opacity-0 transition-opacity hover:text-text-destructive group-hover:opacity-100"
                    aria-label="Delete row"
                  >
                    <RiDeleteBinLine className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-medium text-text-secondary">{title}</h4>
      </div>

      {data.length === 0 ? (
        <div className="py-8 text-center text-sm text-text-tertiary">
          {placeholder}
        </div>
      ) : (
        renderTable()
      )}
    </div>
  )
}

export default React.memo(GenericTable)
