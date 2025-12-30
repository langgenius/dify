'use client'
import type { FC } from 'react'
import Image from 'next/image'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import Checkbox from '@/app/components/base/checkbox'
import SearchInput from '@/app/components/base/search-input'
import SearchMenu from '@/assets/search-menu.svg'
import { cn } from '@/utils/classnames'
import Button from '../button'

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
  showSearch?: boolean
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
  showSearch = true,
  maxHeight,
}) => {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')

  const filteredOptions = useMemo(() => {
    if (!searchQuery?.trim())
      return options

    const query = searchQuery.toLowerCase()
    return options.filter(option =>
      option.label.toLowerCase().includes(query) || option.value.toLowerCase().includes(query),
    )
  }, [options, searchQuery])

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
    <div className={cn('flex w-full flex-col gap-1', containerClassName)}>
      {label && (
        <div className="system-sm-medium text-text-secondary">
          {label}
        </div>
      )}
      {description && (
        <div className="body-xs-regular text-text-tertiary">
          {description}
        </div>
      )}

      <div className="rounded-lg border border-components-panel-border bg-components-panel-bg">
        {(showSelectAll || title || showSearch) && (
          <div className="relative flex items-center gap-2 border-b border-divider-subtle px-3 py-2">
            {!searchQuery && showSelectAll && (
              <Checkbox
                checked={isAllSelected}
                indeterminate={isIndeterminate}
                onCheck={handleSelectAll}
                disabled={disabled}
              />
            )}
            {!searchQuery
              ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1">
                    {title && (
                      <span className="system-xs-semibold-uppercase truncate leading-5 text-text-secondary">
                        {title}
                      </span>
                    )}
                    {showCount && selectedCount > 0 && (
                      <Badge uppercase>
                        {t('operation.selectCount', { ns: 'common', count: selectedCount })}
                      </Badge>
                    )}
                  </div>
                )
              : (
                  <div className="system-sm-medium-uppercase flex-1 leading-6 text-text-secondary">
                    {
                      filteredOptions.length > 0
                        ? t('operation.searchCount', { ns: 'common', count: filteredOptions.length, content: title })
                        : t('operation.noSearchCount', { ns: 'common', content: title })
                    }
                  </div>
                )}
            {showSearch && (
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder={t('placeholder.search', { ns: 'common' })}
                className="w-40"
              />
            )}
          </div>
        )}

        <div
          className="p-1"
          style={maxHeight ? { maxHeight, overflowY: 'auto' } : {}}
        >
          {!filteredOptions.length
            ? (
                <div className="px-3 py-6 text-center text-sm text-text-tertiary">
                  {searchQuery
                    ? (
                        <div className="flex flex-col items-center justify-center gap-2">
                          <Image alt="search menu" src={SearchMenu} width={32} />
                          <span className="system-sm-regular text-text-secondary">{t('operation.noSearchResults', { ns: 'common', content: title })}</span>
                          <Button variant="secondary-accent" size="small" onClick={() => setSearchQuery('')}>{t('operation.resetKeywords', { ns: 'common' })}</Button>
                        </div>
                      )
                    : t('noData', { ns: 'common' })}
                </div>
              )
            : (
                filteredOptions.map((option) => {
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
                        className="system-sm-medium flex-1 truncate text-text-secondary"
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
