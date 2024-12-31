'use client'
import { RiCloseLine } from '@remixicon/react'
import TagsFilter from './tags-filter'
import ActionButton from '@/app/components/base/action-button'
import cn from '@/utils/classnames'

type SearchBoxProps = {
  search: string
  onSearchChange: (search: string) => void
  inputClassName?: string
  tags: string[]
  onTagsChange: (tags: string[]) => void
  size?: 'small' | 'large'
  placeholder?: string
  locale?: string
}
const SearchBox = ({
  search,
  onSearchChange,
  inputClassName,
  tags,
  onTagsChange,
  size = 'small',
  placeholder = '',
  locale,
}: SearchBoxProps) => {
  return (
    <div
      className={cn(
        'flex items-center z-[11]',
        size === 'large' && 'p-1.5 bg-components-panel-bg-blur rounded-xl shadow-md border border-components-chat-input-border',
        size === 'small' && 'p-0.5 bg-components-input-bg-normal rounded-lg',
        inputClassName,
      )}
    >
      <TagsFilter
        tags={tags}
        onTagsChange={onTagsChange}
        size={size}
        locale={locale}
      />
      <div className='mx-1 w-[1px] h-3.5 bg-divider-regular'></div>
      <div className='relative grow flex items-center p-1 pl-2'>
        <div className='flex items-center mr-2 w-full'>
          <input
            className={cn(
              'grow block outline-none appearance-none body-md-medium text-text-secondary bg-transparent',
            )}
            value={search}
            onChange={(e) => {
              onSearchChange(e.target.value)
            }}
            placeholder={placeholder}
          />
          {
            search && (
              <div className='absolute right-2 top-1/2 -translate-y-1/2'>
                <ActionButton onClick={() => onSearchChange('')}>
                  <RiCloseLine className='w-4 h-4' />
                </ActionButton>
              </div>
            )
          }
        </div>
      </div>
    </div>
  )
}

export default SearchBox
