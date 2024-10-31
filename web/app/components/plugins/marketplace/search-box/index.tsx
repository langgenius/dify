'use client'
import { RiCloseLine } from '@remixicon/react'
import { useMarketplaceContext } from '../context'
import TagsFilter from './tags-filter'
import ActionButton from '@/app/components/base/action-button'
import cn from '@/utils/classnames'

type SearchBoxProps = {
  search: string
  onSearchChange: (search: string) => void
  inputClassName?: string
  tags: string[]
  onTagsChange: (tags: string[]) => void
}
const SearchBox = ({
  search,
  onSearchChange,
  inputClassName,
  tags,
  onTagsChange,
}: SearchBoxProps) => {
  const intersected = useMarketplaceContext(v => v.intersected)
  const searchPluginText = useMarketplaceContext(v => v.searchPluginText)
  const handleSearchPluginTextChange = useMarketplaceContext(v => v.handleSearchPluginTextChange)

  return (
    <div
      className={cn(
        'sticky top-3 flex items-center mx-auto p-1.5 w-[640px] h-11 border border-components-chat-input-border bg-components-panel-bg-blur rounded-xl shadow-md z-[11]',
        inputClassName,
        !intersected && 'w-[508px] transition-[width] duration-300',
      )}
    >
      <TagsFilter
        tags={tags}
        onTagsChange={onTagsChange}
      />
      <div className='mx-1 w-[1px] h-3.5 bg-divider-regular'></div>
      <div className='grow flex items-center p-1 pl-2'>
        <div className='flex items-center mr-2 py-0.5 w-full'>
          <input
            className='grow block outline-none appearance-none body-md-medium text-text-secondary'
            value={search}
            onChange={(e) => {
              onSearchChange(e.target.value)
            }}
          />
          {
            searchPluginText && (
              <ActionButton onClick={() => handleSearchPluginTextChange('')}>
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
