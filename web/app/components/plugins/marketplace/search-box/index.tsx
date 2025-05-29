'use client'
import { RiCloseLine, RiSearchLine } from '@remixicon/react'
import TagsFilter from './tags-filter'
import ActionButton from '@/app/components/base/action-button'
import cn from '@/utils/classnames'
import { RiAddLine } from '@remixicon/react'

type SearchBoxProps = {
  search: string
  onSearchChange: (search: string) => void
  inputClassName?: string
  tags: string[]
  onTagsChange: (tags: string[]) => void
  size?: 'small' | 'large'
  placeholder?: string
  locale?: string
  supportAddCustomTool?: boolean
  onShowAddCustomCollectionModal?: () => void
  onAddedCustomTool?: () => void
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
  supportAddCustomTool,
  onShowAddCustomCollectionModal,
}: SearchBoxProps) => {
  return (
    <div
      className='z-[11] flex items-center'
    >
      <div className={
        cn('flex items-center',
          size === 'large' && 'rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur p-1.5 shadow-md',
          size === 'small' && 'rounded-lg bg-components-input-bg-normal p-0.5',
          inputClassName,
        )
      }>
        <div className='relative flex grow items-center p-1 pl-2'>
          <div className='mr-2 flex w-full items-center'>
            <RiSearchLine className='mr-1.5 size-4 text-text-placeholder' />
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
        <div className='mx-1 h-3.5 w-[1px] bg-divider-regular'></div>
        <TagsFilter
          tags={tags}
          onTagsChange={onTagsChange}
          size={size}
          locale={locale}
        />
      </div>
      {supportAddCustomTool && (
        <div className='flex shrink-0 items-center'>
          <ActionButton
            className='ml-2 rounded-full bg-components-button-primary-bg text-components-button-primary-text hover:bg-components-button-primary-bg hover:text-components-button-primary-text'
            onClick={onShowAddCustomCollectionModal}
          >
            <RiAddLine className='h-4 w-4' />
          </ActionButton>
        </div>
      )}
    </div>
  )
}

export default SearchBox
