import type { ChangeEvent } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

type SearchInputProps = {
  value: string
  onChange: (v: string) => void
}
const SearchInput = ({
  value,
  onChange,
}: SearchInputProps) => {
  const { t } = useTranslation()

  const handleClear = useCallback(() => {
    onChange('')
  }, [onChange])

  const placeholderText = t('dataSource.notion.selector.searchPages', { ns: 'common' })
  /* v8 ignore next -- i18n test mock always returns a non-empty string; runtime fallback is defensive. -- @preserve */
  const safePlaceholderText = placeholderText || ''

  return (
    <div
      className={cn('flex h-8 w-[200px] items-center rounded-lg bg-components-input-bg-normal p-2')}
      data-testid="notion-search-input-container"
    >
      <div className="mr-0.5 i-ri-search-line h-4 w-4 shrink-0 text-components-input-text-placeholder" />
      <input
        className="min-w-0 grow appearance-none border-0 bg-transparent px-1 text-[13px] leading-[16px] text-components-input-text-filled outline-0 placeholder:text-components-input-text-placeholder"
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        placeholder={safePlaceholderText}
        data-testid="notion-search-input"
      />
      {
        value
          ? (
              <button
                type="button"
                aria-label={t('operation.clear', { ns: 'common' })}
                className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-components-input-border-active"
                onClick={handleClear}
              >
                <span className="i-ri-close-circle-fill h-4 w-4 text-components-input-text-placeholder" aria-hidden="true" />
              </button>
            )
          : null
      }
    </div>
  )
}

export default SearchInput
