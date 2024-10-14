'use client'

import {
  useCallback,
  useState,
} from 'react'
import { RiCloseLine } from '@remixicon/react'
import { useMarketplaceContext } from '../context'
import TagsFilter from './tags-filter'
import ActionButton from '@/app/components/base/action-button'
import cn from '@/utils/classnames'

type SearchBoxProps = {
  onChange?: (searchText: string, tags: string[]) => void
}
const SearchBox = ({
  onChange,
}: SearchBoxProps) => {
  const intersected = useMarketplaceContext(v => v.intersected)
  const [searchText, setSearchText] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  const handleTagsChange = useCallback((tags: string[]) => {
    setSelectedTags(tags)
    onChange?.(searchText, tags)
  }, [searchText, onChange])

  return (
    <div
      className={cn(
        'sticky top-3 flex items-center m-auto p-1.5 w-[640px] h-11 border border-components-chat-input-border bg-components-panel-bg-blur rounded-xl shadow-md z-[11]',
        !intersected && 'w-[508px] transition-[width] duration-300',
      )}
    >
      <TagsFilter
        value={selectedTags}
        onChange={handleTagsChange}
      />
      <div className='mx-1 w-[1px] h-3.5 bg-divider-regular'></div>
      <div className='grow flex items-center p-1 pl-2'>
        <div className='flex items-center mr-2 py-0.5 w-full'>
          <input
            className='grow block outline-none appearance-none body-md-medium text-text-secondary'
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value)
              onChange?.(e.target.value, selectedTags)
            }}
          />
          {
            searchText && (
              <ActionButton onClick={() => setSearchText('')}>
                <RiCloseLine className='w-4 h-4' />
              </ActionButton>
            )
          }
        </div>
      </div>
    </div>
  )
}

export default SearchBox
