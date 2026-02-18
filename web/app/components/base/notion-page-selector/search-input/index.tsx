import type { ChangeEvent } from 'react'
import { RiCloseCircleFill, RiSearchLine } from '@remixicon/react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

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

  return (
    <div className={cn('flex h-8 w-[200px] items-center rounded-lg bg-components-input-bg-normal p-2')}>
      <RiSearchLine className="mr-0.5 h-4 w-4 shrink-0 text-components-input-text-placeholder" />
      <input
        className="min-w-0 grow appearance-none border-0 bg-transparent px-1 text-[13px] leading-[16px] text-components-input-text-filled outline-0 placeholder:text-components-input-text-placeholder"
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        placeholder={t('dataSource.notion.selector.searchPages', { ns: 'common' }) || ''}
      />
      {
        value && (
          <RiCloseCircleFill
            className="h-4 w-4 shrink-0 cursor-pointer text-components-input-text-placeholder"
            onClick={handleClear}
          />
        )
      }
    </div>
  )
}

export default SearchInput
