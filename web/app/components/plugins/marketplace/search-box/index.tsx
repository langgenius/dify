'use client'
import type { Ref } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useImperativeHandle, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import TagsFilter from './tags-filter'

type SearchBoxProps = {
  ref?: Ref<HTMLInputElement>
  search: string
  onSearchChange: (search: string) => void
  wrapperClassName?: string
  inputClassName?: string
  inputElementClassName?: string
  searchIconClassName?: string
  tags: string[]
  onTagsChange: (tags: string[]) => void
  placeholder?: string
  supportAddCustomTool?: boolean
  usedInMarketplace?: boolean
  onShowAddCustomCollectionModal?: () => void
  autoFocus?: boolean
  showTags?: boolean
}
function SearchBox({
  ref,
  search,
  onSearchChange,
  wrapperClassName,
  inputClassName,
  inputElementClassName,
  searchIconClassName,
  tags,
  onTagsChange,
  placeholder = '',
  usedInMarketplace = false,
  supportAddCustomTool,
  onShowAddCustomCollectionModal,
  autoFocus = false,
  showTags = true,
}: SearchBoxProps) {
  const { t } = useTranslation()
  const accessibleLabel = placeholder || t(($) => $.searchTools, { ns: 'plugin' })!
  const inputRef = useRef<HTMLInputElement>(null)
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, [])

  const handleClear = () => {
    onSearchChange('')
    inputRef.current?.focus()
  }

  return (
    <div className={cn('z-11 flex items-center', wrapperClassName)}>
      <div
        className={cn(
          'flex items-center',
          usedInMarketplace &&
            'rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur p-1.5 shadow-md',
          !usedInMarketplace &&
            'rounded-lg border border-transparent bg-components-input-bg-normal focus-within:border-components-input-border-active hover:border-components-input-border-hover',
          inputClassName,
        )}
      >
        {usedInMarketplace && (
          <>
            {showTags && (
              <>
                <TagsFilter tags={tags} onTagsChange={onTagsChange} usedInMarketplace />
                <Divider type="vertical" className="mx-1 h-3.5" />
              </>
            )}
            <div className="flex grow items-center gap-x-2 p-1">
              <input
                ref={inputRef}
                type="search"
                name="query"
                autoComplete="off"
                aria-label={accessibleLabel}
                className={cn(
                  'inline-block grow appearance-none bg-transparent body-md-medium text-text-secondary outline-hidden [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none',
                  inputElementClassName,
                )}
                value={search}
                onChange={(e) => {
                  onSearchChange(e.target.value)
                }}
                placeholder={placeholder}
              />
              {search && (
                <Button
                  variant="ghost"
                  size="small"
                  aria-label={t(($) => $.clearSearch, {
                    ns: 'plugin',
                    label: accessibleLabel,
                  })}
                  onClick={handleClear}
                  className="size-6 min-h-0 shrink-0 p-0 focus-visible:ring-inset"
                >
                  <span className="i-ri-close-line size-4" aria-hidden />
                </Button>
              )}
            </div>
          </>
        )}
        {!usedInMarketplace && (
          <>
            <div className="flex h-8 min-w-0 grow items-center pr-2 pl-2">
              <span
                aria-hidden
                className={cn(
                  'i-ri-search-line',
                  'size-4 text-components-input-text-placeholder',
                  searchIconClassName,
                )}
              />
              <input
                ref={inputRef}
                type="search"
                name="query"
                autoComplete="off"
                aria-label={accessibleLabel}
                // oxlint-disable-next-line jsx-a11y/no-autofocus
                autoFocus={autoFocus}
                className={cn(
                  'mr-1 ml-1.5 inline-block min-w-0 grow appearance-none truncate bg-transparent system-sm-regular text-components-input-text-filled caret-primary-600 outline-hidden placeholder:text-components-input-text-placeholder [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none',
                  search && 'mr-2',
                  inputElementClassName,
                )}
                value={search}
                onChange={(e) => {
                  onSearchChange(e.target.value)
                }}
                placeholder={placeholder}
              />
              {search && (
                <Button
                  variant="ghost"
                  size="small"
                  aria-label={t(($) => $.clearSearch, {
                    ns: 'plugin',
                    label: accessibleLabel,
                  })}
                  onClick={handleClear}
                  className="size-6 min-h-0 shrink-0 p-0 focus-visible:ring-inset"
                >
                  <span className="i-ri-close-line size-4" aria-hidden />
                </Button>
              )}
            </div>
            {showTags && (
              <>
                <Divider type="vertical" className="mx-0 mr-0.5 h-3.5" />
                <TagsFilter tags={tags} onTagsChange={onTagsChange} />
              </>
            )}
          </>
        )}
      </div>
      {supportAddCustomTool && (
        <div className="flex shrink-0 items-center">
          <Button
            variant="primary"
            size="small"
            aria-label={t(($) => $['addToolModal.custom.tip'], { ns: 'tools' })}
            className="ml-2 size-6 min-h-0 rounded-full p-0"
            onClick={onShowAddCustomCollectionModal}
          >
            <span className="i-ri-add-line size-4" aria-hidden />
          </Button>
        </div>
      )}
    </div>
  )
}

export default SearchBox
