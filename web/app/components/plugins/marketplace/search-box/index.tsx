'use client'
import { RiCloseLine, RiSearchLine } from '@remixicon/react'
import TagsFilter from './tags-filter'
import ActionButton from '@/app/components/base/action-button'
import cn from '@/utils/classnames'
import { RiAddLine } from '@remixicon/react'
import Divider from '@/app/components/base/divider'

type SearchBoxProps = {
  search: string
  onSearchChange: (search: string) => void
  wrapperClassName?: string
  inputClassName?: string
  tags: string[]
  onTagsChange: (tags: string[]) => void
  placeholder?: string
  locale?: string
  supportAddCustomTool?: boolean
  usedInMarketplace?: boolean
  onShowAddCustomCollectionModal?: () => void
  onAddedCustomTool?: () => void
}
const SearchBox = ({
  search,
  onSearchChange,
  wrapperClassName,
  inputClassName,
  tags,
  onTagsChange,
  placeholder = '',
  locale,
  usedInMarketplace = false,
  supportAddCustomTool,
  onShowAddCustomCollectionModal,
}: SearchBoxProps) => {
  return (
    <div
      className={cn('z-[11] flex items-center', wrapperClassName)}
    >
      <div className={
        cn('flex items-center',
          usedInMarketplace && 'rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur p-1.5 shadow-md',
          !usedInMarketplace && 'rounded-lg bg-components-input-bg-normal p-0.5',
          inputClassName,
        )
      }>
        {
          usedInMarketplace && (
            <>
              <TagsFilter
                tags={tags}
                onTagsChange={onTagsChange}
                usedInMarketplace
                locale={locale}
              />
              <Divider type='vertical' className='mx-1 h-3.5' />
              <div className='flex grow items-center gap-x-2 p-1'>
                <input
                  className={cn(
                    'body-md-medium inline-block grow appearance-none bg-transparent text-text-secondary outline-none',
                  )}
                  value={search}
                  onChange={(e) => {
                    onSearchChange(e.target.value)
                  }}
                  placeholder={placeholder}
                />
                {
                  search && (
                    <ActionButton
                      onClick={() => onSearchChange('')}
                      className='shrink-0'
                    >
                      <RiCloseLine className='size-4' />
                    </ActionButton>
                  )
                }
              </div>
            </>
          )
        }
        {
          !usedInMarketplace && (
            <>
              <div className='flex grow items-center p-2'>
                <RiSearchLine className='size-4 text-components-input-text-placeholder' />
                <input
                  className={cn(
                    'body-md-medium ml-1.5 mr-1 inline-block grow appearance-none bg-transparent text-text-secondary outline-none',
                    search && 'mr-2',
                  )}
                  value={search}
                  onChange={(e) => {
                    onSearchChange(e.target.value)
                  }}
                  placeholder={placeholder}
                />
                {
                  search && (
                    <ActionButton
                      onClick={() => onSearchChange('')}
                      className='shrink-0'
                    >
                      <RiCloseLine className='size-4' />
                    </ActionButton>
                  )
                }
              </div>
              <Divider type='vertical' className='mx-0 mr-0.5 h-3.5' />
              <TagsFilter
                tags={tags}
                onTagsChange={onTagsChange}
                locale={locale}
              />
            </>
          )
        }
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
