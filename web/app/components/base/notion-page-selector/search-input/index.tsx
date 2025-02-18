import { useCallback } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import s from './index.module.css'
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
    <div className={cn(s['input-wrapper'], 'flex h-7 items-center rounded-md px-2', `${value ? 'bg-white' : 'bg-gray-100'}`)}>
      <div className={cn(s['search-icon'], 'mr-[6px] h-4 w-4')} />
      <input
        className='grow appearance-none border-0 bg-inherit text-[13px] outline-0'
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        placeholder={t('common.dataSource.notion.selector.searchPages') || ''}
      />
      {
        value && (
          <div
            className={cn(s['clear-icon'], 'ml-1 h-4 w-4 cursor-pointer')}
            onClick={handleClear}
          />
        )
      }
    </div>
  )
}

export default SearchInput
