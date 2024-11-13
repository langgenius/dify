'use client'

import Input from '@/app/components/base/input'
import { useTranslation } from 'react-i18next'
type SearchBoxProps = {
  searchQuery: string
  onChange: (query: string) => void
}

const SearchBox: React.FC<SearchBoxProps> = ({
  searchQuery,
  onChange,
}) => {
  const { t } = useTranslation()

  return (
    <Input
      wrapperClassName='flex w-[200px] items-center rounded-lg'
      className='bg-components-input-bg-normal'
      showLeftIcon
      value={searchQuery}
      placeholder={t('plugin.search')}
      onChange={(e) => {
        onChange(e.target.value)
      }}
    />
  )
}

export default SearchBox
