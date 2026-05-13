'use client'

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useState } from 'react'
import { useTranslation } from '#i18n'
import Checkbox from '@/app/components/base/checkbox'
import Input from '@/app/components/base/input'
import { useTags } from '@/app/components/plugins/hooks'
import MarketplaceTrigger from './trigger/marketplace'
import ToolSelectorTrigger from './trigger/tool-selector'

type TagsFilterProps = {
  tags: string[]
  onTagsChange: (tags: string[]) => void
  usedInMarketplace?: boolean
}
const TagsFilter = ({
  tags,
  onTagsChange,
  usedInMarketplace = false,
}: TagsFilterProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const { tags: options, tagsMap } = useTags()
  const filteredOptions = options.filter(option => option.label.toLowerCase().includes(searchText.toLowerCase()))
  const handleCheck = (id: string) => {
    if (tags.includes(id))
      onTagsChange(tags.filter((tag: string) => tag !== id))
    else
      onTagsChange([...tags, id])
  }
  const selectedTagsLength = tags.length

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger
        nativeButton={false}
        render={(
          <div className="shrink-0">
            {
              usedInMarketplace && (
                <MarketplaceTrigger
                  selectedTagsLength={selectedTagsLength}
                  open={open}
                  tags={tags}
                  tagsMap={tagsMap}
                  onTagsChange={onTagsChange}
                />
              )
            }
            {
              !usedInMarketplace && (
                <ToolSelectorTrigger
                  selectedTagsLength={selectedTagsLength}
                  open={open}
                  tags={tags}
                  tagsMap={tagsMap}
                  onTagsChange={onTagsChange}
                />
              )
            }
          </div>
        )}
      />
      <PopoverContent
        placement="bottom-start"
        sideOffset={4}
        alignOffset={-6}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div className="w-[240px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-xs">
          <div className="p-2 pb-1">
            <Input
              showLeftIcon
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder={t('searchTags', { ns: 'pluginTags' }) || ''}
            />
          </div>
          <div className="max-h-[448px] overflow-y-auto p-1">
            {
              filteredOptions.map(option => (
                <div
                  key={option.name}
                  className="flex h-7 cursor-pointer items-center rounded-lg px-2 py-1.5 select-none hover:bg-state-base-hover"
                  onClick={() => handleCheck(option.name)}
                >
                  <Checkbox
                    className="mr-1"
                    checked={tags.includes(option.name)}
                  />
                  <div className="px-1 system-sm-medium text-text-secondary">
                    {option.label}
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default TagsFilter
