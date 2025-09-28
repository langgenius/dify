'use client'
import Badge from '@/app/components/base/badge'
import Checkbox from '@/app/components/base/checkbox'
import cn from '@/utils/classnames'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export type CheckboxListOption = {
  label: string
  value: string
  disabled?: boolean
}

export type CheckboxListProps = {
  title?: string
  label?: string
  description?: string
  options: CheckboxListOption[]
  value?: string[]
  onChange?: (value: string[]) => void
  disabled?: boolean
  containerClassName?: string
  showSelectAll?: boolean
  showCount?: boolean
  maxHeight?: string | number
}

const CheckboxList: FC<CheckboxListProps> = ({
  title = '',
  label,
  description,
  options,
  value = [],
  onChange,
  disabled = false,
  containerClassName,
  showSelectAll = true,
  showCount = true,
  maxHeight,
}) => {
  const { t } = useTranslation()

  const selectedCount = value.length

  const isAllSelected = useMemo(() => {
    const selectableOptions = options.filter(option => !option.disabled)
    return selectableOptions.length > 0 && selectableOptions.every(option => value.includes(option.value))
  }, [options, value])

  const isIndeterminate = useMemo(() => {
    const selectableOptions = options.filter(option => !option.disabled)
    const selectedCount = selectableOptions.filter(option => value.includes(option.value)).length
    return selectedCount > 0 && selectedCount < selectableOptions.length
  }, [options, value])

  const handleSelectAll = useCallback(() => {
    if (disabled)
      return

    if (isAllSelected) {
      // Deselect all
      onChange?.([])
    }
    else {
      // Select all non-disabled options
      const allValues = options
        .filter(option => !option.disabled)
        .map(option => option.value)
      onChange?.(allValues)
    }
  }, [isAllSelected, options, onChange, disabled])

  const handleToggleOption = useCallback((optionValue: string) => {
    if (disabled)
      return

    const newValue = value.includes(optionValue)
      ? value.filter(v => v !== optionValue)
      : [...value, optionValue]
    onChange?.(newValue)
  }, [value, onChange, disabled])

  return (
    <div className={cn('flex flex-col gap-1', containerClassName)}>
      {label && (
        <div className='system-sm-medium text-text-secondary'>
          {label}
        </div>
      )}
      {description && (
        <div className='body-xs-regular text-text-tertiary'>
          {description}
        </div>
      )}

      <div className='rounded-lg border border-components-panel-border bg-components-panel-bg'>
        {(showSelectAll || title) && (
          <div className='relative flex items-center gap-2 border-b border-divider-subtle px-3 py-2'>
            {showSelectAll && (
              <Checkbox
                checked={isAllSelected}
                indeterminate={isIndeterminate}
                onCheck={handleSelectAll}
                disabled={disabled}
              />
            )}
            <div className='flex flex-1 items-center gap-1'>
              {title && (
                <span className='system-xs-semibold-uppercase leading-5 text-text-secondary'>
                  {title}
                </span>
              )}
              {showCount && selectedCount > 0 && (
                <Badge uppercase>
                  {t('common.operation.selectCount', { count: selectedCount })}
                </Badge>
              )}
            </div>
          </div>
        )}

        <div
          className='p-1'
          style={maxHeight ? { maxHeight, overflowY: 'auto' } : {}}
        >
          {!options.length ? (
            <div className='px-3 py-6 text-center text-sm text-text-tertiary'>
              {t('common.noData')}
            </div>
          ) : (
            options.map((option) => {
              const selected = value.includes(option.value)

              return (
                <div
                  key={option.value}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-state-base-hover',
                    option.disabled && 'cursor-not-allowed opacity-50',
                  )}
                  onClick={() => {
                    if (!option.disabled && !disabled)
                      handleToggleOption(option.value)
                  }}
                >
                  <Checkbox
                    checked={selected}
                    onCheck={() => {
                      if (!option.disabled && !disabled)
                        handleToggleOption(option.value)
                    }}
                    disabled={option.disabled || disabled}
                  />
                  <div
                    className='system-sm-medium flex-1 truncate text-text-secondary'
                    title={option.label}
                  >
                    {option.label}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

export default CheckboxList
