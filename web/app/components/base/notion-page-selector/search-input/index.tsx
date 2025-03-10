import { useCallback } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseCircleFill, RiSearchLine } from '@remixicon/react'
import cn from '@/utils/classnames'

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
    <div className={cn('w-[200px] flex items-center p-2 h-8 rounded-lg bg-components-input-bg-normal')}>
      <RiSearchLine className={'w-4 h-4 mr-0.5 shrink-0 text-components-input-text-placeholder'} />
      <input
        className='min-w-0 grow px-1 text-[13px] leading-[16px] bg-transparent text-components-input-text-filled placeholder:text-components-input-text-placeholder border-0 outline-0 appearance-none'
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        placeholder={t('common.dataSource.notion.selector.searchPages') || ''}
      />
      {
        value && (
          <RiCloseCircleFill
            className={'w-4 h-4 shrink-0 cursor-pointer text-components-input-text-placeholder'}
            onClick={handleClear}
          />
        )
      }
    </div>
  )
}

export default SearchInput
