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
        'z-[11] flex items-center',
        size === 'large' && 'rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur p-1.5 shadow-md',
        size === 'small' && 'rounded-lg bg-components-input-bg-normal p-0.5',
        inputClassName,
      )}
    >
      <TagsFilter
        tags={tags}
        onTagsChange={onTagsChange}
        size={size}
        locale={locale}
      />
      <div className='mx-1 h-3.5 w-[1px] bg-divider-regular'></div>
      <div className='relative flex grow items-center p-1 pl-2'>
        <div className='mr-2 flex w-full items-center'>
          <input
            className={cn(
              'body-md-medium block grow appearance-none bg-transparent text-text-secondary outline-none',
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
                  <RiCloseLine className='h-4 w-4' />
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
