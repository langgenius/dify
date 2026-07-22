'use client'

import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import { Input } from '@langgenius/dify-ui/input'
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
          open={open}
          tags={tags}
          tagsMap={tagsMap}
          onTagsChange={onTagsChange}
        />
      )}
      {!usedInMarketplace && (
        <ToolSelectorTrigger
          selectedTagsLength={selectedTagsLength}
          open={open}
          tags={tags}
          tagsMap={tagsMap}
          onTagsChange={onTagsChange}
        />
      )}
      <PopoverContent
        placement="bottom-start"
        sideOffset={4}
        alignOffset={-6}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div className="w-[240px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-xs">
          <div className="p-2 pb-1">
            <div className="relative">
              <span
                aria-hidden
                className="absolute top-1/2 left-2 i-ri-search-line size-4 -translate-y-1/2 text-components-input-text-placeholder"
              />
              <Input
                type="search"
                name="tag-query"
                autoComplete="off"
                aria-label={t(($) => $.searchTags, { ns: 'pluginTags' }) || ''}
                className="pl-6.5"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder={t(($) => $.searchTags, { ns: 'pluginTags' }) || ''}
              />
            </div>
          </div>
          <CheckboxGroup
            aria-label={t(($) => $.allTags, { ns: 'pluginTags' })}
            value={tags}
            onValueChange={(nextTags) => onTagsChange(nextTags)}
            className="max-h-[448px] overflow-y-auto p-1"
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
