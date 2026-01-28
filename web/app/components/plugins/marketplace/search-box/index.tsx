'use client'
import { RiAddLine, RiCloseLine, RiSearchLine } from '@remixicon/react'
import ActionButton from '@/app/components/base/action-button'
import Divider from '@/app/components/base/divider'
import { cn } from '@/utils/classnames'
import TagsFilter from './tags-filter'

type SearchBoxProps = {
  search: string
  onSearchChange: (search: string) => void
  wrapperClassName?: string
  inputClassName?: string
  tags: string[]
  onTagsChange: (tags: string[]) => void
  placeholder?: string
  supportAddCustomTool?: boolean
  usedInMarketplace?: boolean
  onShowAddCustomCollectionModal?: () => void
  onAddedCustomTool?: () => void
  autoFocus?: boolean
}
const SearchBox = ({
  search,
  onSearchChange,
  wrapperClassName,
  inputClassName,
  tags,
  onTagsChange,
  placeholder = '',
  usedInMarketplace = false,
  supportAddCustomTool,
  onShowAddCustomCollectionModal,
  autoFocus = false,
}: SearchBoxProps) => {
  return (
    <div
      className={cn('z-[11] flex items-center', wrapperClassName)}
    >
      <div className={
        cn('flex items-center', usedInMarketplace && 'rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur p-1.5 shadow-md', !usedInMarketplace && 'radius-md border border-transparent bg-components-input-bg-normal focus-within:border-components-input-border-active hover:border-components-input-border-hover', inputClassName)
      }
      >
        {
          usedInMarketplace && (
            <>
              <TagsFilter
                tags={tags}
                onTagsChange={onTagsChange}
                usedInMarketplace
              />
              <Divider type="vertical" className="mx-1 h-3.5" />
              <div className="flex grow items-center gap-x-2 p-1">
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
                      className="shrink-0"
                    >
                      <RiCloseLine className="size-4" />
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
              <div className="flex grow items-center py-[7px] pl-2 pr-3">
                <RiSearchLine className="size-4 text-components-input-text-placeholder" />
                <input
                  autoFocus={autoFocus}
                  className={cn(
                    'system-sm-regular ml-1.5 mr-1 inline-block grow appearance-none bg-transparent text-components-input-text-filled outline-none placeholder:text-components-input-text-placeholder',
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
                      className="shrink-0"
                    >
                      <RiCloseLine className="size-4" />
                    </ActionButton>
                  )
                }
              </div>
              <Divider type="vertical" className="mx-0 mr-0.5 h-3.5" />
              <TagsFilter
                tags={tags}
                onTagsChange={onTagsChange}
              />
            </>
          )
        }
      </div>
      {supportAddCustomTool && (
        <div className="flex shrink-0 items-center">
          <ActionButton
            className="ml-2 rounded-full bg-components-button-primary-bg text-components-button-primary-text hover:bg-components-button-primary-bg hover:text-components-button-primary-text"
            onClick={onShowAddCustomCollectionModal}
          >
            <RiAddLine className="h-4 w-4" />
          </ActionButton>
        </div>
      )}
    </div>
  )
}

export default SearchBox
