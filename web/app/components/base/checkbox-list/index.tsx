'use client'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import { cn } from '@langgenius/dify-ui/cn'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import SearchInput from '@/app/components/base/search-input'
import SearchMenu from '@/assets/search-menu.svg'

type CheckboxListOption = {
  label: string
  value: string
  disabled?: boolean
}

type CheckboxListProps = {
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

export const CheckboxList = ({
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
}: CheckboxListProps) => {
  const { t } = useTranslation()
  const groupLabelId = useId()
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

  const selectableOptionValues = useMemo(
    () => options.filter(option => !option.disabled).map(option => option.value),
    [options],
  )

  return (
    <div className={cn('flex w-full flex-col gap-1', containerClassName)}>
      {label && (
        <div id={groupLabelId} className="system-sm-medium text-text-secondary">
          {label}
        </div>
      )}
      {description && (
        <div className="body-xs-regular text-text-tertiary">
          {description}
        </div>
      )}

      <CheckboxGroup
        aria-labelledby={label ? groupLabelId : undefined}
        value={value}
        onValueChange={nextValue => onChange?.(nextValue)}
        allValues={selectableOptionValues}
        disabled={disabled}
        className="rounded-lg border border-components-panel-border bg-components-panel-bg"
      >
        {(showSelectAll || title || showSearch) && (
          <div className="relative flex items-center gap-2 border-b border-divider-subtle px-3 py-2">
            {!searchQuery && showSelectAll && (
              <label className={cn('flex shrink-0 items-center', !disabled && 'cursor-pointer')}>
                <Checkbox
                  parent
                  disabled={disabled}
                />
                <span className="sr-only">{t('operation.selectAll', { ns: 'common' })}</span>
              </label>
            )}
            {!searchQuery
              ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1">
                    {title && (
                      <span className="truncate system-xs-semibold-uppercase leading-5 text-text-secondary">
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
                  <div className="flex-1 system-sm-medium-uppercase leading-6 text-text-secondary">
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
          data-testid="options-container"
        >
          {!filteredOptions.length
            ? (
                <div className="px-3 py-6 text-center text-sm text-text-tertiary">
                  {searchQuery
                    ? (
                        <div className="flex flex-col items-center justify-center gap-2">
                          <img alt="search menu" src={SearchMenu.src} width={32} />
                          <span className="system-sm-regular text-text-secondary">{t('operation.noSearchResults', { ns: 'common', content: title })}</span>
                          <Button variant="secondary-accent" size="small" onClick={() => setSearchQuery('')}>{t('operation.resetKeywords', { ns: 'common' })}</Button>
                        </div>
                      )
                    : t('noData', { ns: 'common' })}
                </div>
              )
            : (
                filteredOptions.map(option => (
                  <label
                    key={option.value}
                    data-testid="option-item"
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-state-base-hover',
                      (option.disabled || disabled) && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <Checkbox
                      value={option.value}
                      disabled={option.disabled || disabled}
                    />
                    <span
                      className="flex-1 truncate system-sm-medium text-text-secondary"
                      title={option.label}
                    >
                      {option.label}
                    </span>
                  </label>
                ))
              )}
        </div>
      </CheckboxGroup>
    </div>
  )
}
