'use client'

import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { Popover, PopoverContent } from '@langgenius/dify-ui/popover'
import { useState } from 'react'
import { useTranslation } from '#i18n'
import { useTags } from '@/app/components/plugins/hooks'
import MarketplaceTrigger from './trigger/marketplace'
import ToolSelectorTrigger from './trigger/tool-selector'

type TagsFilterProps = {
  tags: string[]
  onTagsChange: (tags: string[]) => void
  usedInMarketplace?: boolean
}
function TagsFilter({ tags, onTagsChange, usedInMarketplace = false }: TagsFilterProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const { tags: options, tagsMap } = useTags()
  const filteredOptions = options.filter((option) =>
    option.label.toLowerCase().includes(searchText.toLowerCase()),
  )
  const selectedTagsLength = tags.length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {usedInMarketplace && (
        <MarketplaceTrigger
          selectedTagsLength={selectedTagsLength}
          tags={tags}
          tagsMap={tagsMap}
          onTagsChange={onTagsChange}
        />
      )}
      {!usedInMarketplace && (
        <ToolSelectorTrigger
          selectedTagsLength={selectedTagsLength}
          tags={tags}
          tagsMap={tagsMap}
          onTagsChange={onTagsChange}
        />
      )}
      <PopoverContent
        placement="bottom-start"
        sideOffset={4}
        alignOffset={-6}
        className="border-none bg-transparent shadow-none"
      >
        <div className="w-60 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-xs">
          <div className="p-2 pb-1">
            <InputGroup>
              <InputGroupInput
                type="search"
                name="tag-query"
                autoComplete="off"
                enterKeyHint="search"
                aria-label={t(($) => $.searchTags, { ns: 'pluginTags' }) || ''}
                className="[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
                value={searchText}
                onValueChange={setSearchText}
                placeholder={t(($) => $.searchTags, { ns: 'pluginTags' }) || ''}
              />
              <InputGroupAddon className="ps-1.75 pe-0.75">
                <span
                  aria-hidden
                  className="i-ri-search-line size-4 text-components-input-text-placeholder"
                />
              </InputGroupAddon>
            </InputGroup>
          </div>
          <CheckboxGroup
            aria-label={t(($) => $.allTags, { ns: 'pluginTags' })}
            value={tags}
            onValueChange={(nextTags) => onTagsChange(nextTags)}
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
