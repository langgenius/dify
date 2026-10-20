'use client'

import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { useTags } from '../../hooks'

type TagsFilterProps = {
  value: string[]
  onChange: (tags: string[]) => void
}
const TagsFilter = ({ value, onChange }: TagsFilterProps) => {
  const { t } = useTranslation(['common', 'pluginTags'])
  const [searchText, setSearchText] = useState('')
  const { tags: options, getTagLabel } = useTags()
  const filteredOptions = options.filter((option) =>
    option.name.toLowerCase().includes(searchText.toLowerCase()),
  )
  const selectedTagsLength = value.length
  const selectedTagLabels = value.map((tag) => getTagLabel(tag))
  const triggerRef = useRef<HTMLButtonElement>(null)
  const shouldRestoreFocusRef = useRef(false)

  useEffect(() => {
    if (selectedTagsLength || !shouldRestoreFocusRef.current) return

    shouldRestoreFocusRef.current = false
    triggerRef.current?.focus()
  }, [selectedTagsLength])

  return (
    <Popover>
      <div className="relative inline-flex h-8 items-center">
        <PopoverTrigger
          render={
            <Button
              ref={triggerRef}
              variant="ghost"
              size="medium"
              className={cn(
                'h-8 rounded-lg bg-components-input-bg-normal px-2 py-1 text-text-tertiary select-none hover:bg-state-base-hover-alt focus-visible:ring-inset',
                selectedTagsLength && 'pr-8 text-text-secondary',
                'data-popup-open:bg-state-base-hover',
              )}
            >
              <span className="flex items-center p-1 system-sm-medium">
                {!selectedTagsLength && t(($) => $['tag.tags'], { ns: 'common' })}
                {!!selectedTagsLength && selectedTagLabels.slice(0, 2).join(',')}
                {selectedTagsLength > 2 && (
                  <span className="ml-1 system-xs-medium text-text-tertiary">
                    +{selectedTagsLength - 2}
                  </span>
                )}
              </span>
              {!selectedTagsLength && (
                <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
              )}
            </Button>
          }
        />
        {!!selectedTagsLength && (
          <IconButton
            variant="ghost"
            size="md"
            aria-label={t(($) => $.clearSelectedTags, {
              ns: 'pluginTags',
              tags: selectedTagLabels.join(', '),
            })}
            className="absolute right-1 focus-visible:ring-inset"
            onClick={() => {
              shouldRestoreFocusRef.current = true
              onChange([])
            }}
          >
            <span aria-hidden className="i-ri-close-circle-fill size-4 text-text-quaternary" />
          </IconButton>
        )}
      </div>
      <PopoverContent
        placement="bottom-start"
        sideOffset={4}
        className="border-none bg-transparent shadow-none"
      >
        <div className="w-60 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-xs">
          <div className="p-2 pb-1">
            <SearchInput
              value={searchText}
              onValueChange={setSearchText}
              placeholder={t(($) => $.searchTags, { ns: 'pluginTags' })}
            />
          </div>
          <CheckboxGroup
            aria-label={t(($) => $.allTags, { ns: 'pluginTags' })}
            value={value}
            onValueChange={(nextValue) => onChange(nextValue)}
            className="max-h-112 overflow-y-auto p-1"
          >
            {filteredOptions.map((option) => (
              <label
                key={option.name}
                className="flex h-7 cursor-pointer items-center rounded-lg px-2 py-1.5 select-none hover:bg-state-base-hover"
              >
                <Checkbox className="mr-1" value={option.name} />
                <div className="px-1 system-sm-medium text-text-secondary">{option.label}</div>
              </label>
            ))}
          </CheckboxGroup>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default TagsFilter
