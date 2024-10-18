'use client'

import Input from '@/app/components/base/input'
type SearchBoxProps = {
  searchQuery: string
  onChange: (query: string) => void
}

const SearchBox: React.FC<SearchBoxProps> = ({
  searchQuery,
  onChange,
}) => {
  return (
    <Input
      wrapperClassName='flex w-[200px] items-center rounded-lg bg-components-input-bg-normal'
      showLeftIcon
      value={searchQuery}
      placeholder='Search'
      onChange={(e) => {
        onChange(e.target.value)
      }}
    />
  )
}

export default SearchBox
