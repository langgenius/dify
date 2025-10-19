'use client'

import { useState } from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Checkbox from '@/app/components/base/checkbox'
import Input from '@/app/components/base/input'
import { useTags } from '@/app/components/plugins/hooks'
import { useMixedTranslation } from '@/app/components/plugins/marketplace/hooks'
import MarketplaceTrigger from './trigger/marketplace'
import ToolSelectorTrigger from './trigger/tool-selector'

type TagsFilterProps = {
  tags: string[]
  onTagsChange: (tags: string[]) => void
  usedInMarketplace?: boolean
  locale?: string
}
const TagsFilter = ({
  tags,
  onTagsChange,
  usedInMarketplace = false,
  locale,
}: TagsFilterProps) => {
  const { t } = useMixedTranslation(locale)
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const { tags: options, tagsMap } = useTags(t)
  const filteredOptions = options.filter(option => option.label.toLowerCase().includes(searchText.toLowerCase()))
  const handleCheck = (id: string) => {
    if (tags.includes(id))
      onTagsChange(tags.filter((tag: string) => tag !== id))
    else
      onTagsChange([...tags, id])
  }
  const selectedTagsLength = tags.length

  return (
    <PortalToFollowElem
      placement='bottom-start'
      offset={{
        mainAxis: 4,
        crossAxis: -6,
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger
        className='shrink-0'
        onClick={() => setOpen(v => !v)}
      >
        {
          usedInMarketplace && (
            <MarketplaceTrigger
              selectedTagsLength={selectedTagsLength}
              open={open}
              tags={tags}
              tagsMap={tagsMap}
              locale={locale}
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
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[1000]'>
        <div className='w-[240px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm'>
          <div className='p-2 pb-1'>
            <Input
              showLeftIcon
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder={t('pluginTags.searchTags') || ''}
            />
          </div>
          <div className='max-h-[448px] overflow-y-auto p-1'>
            {
              filteredOptions.map(option => (
                <div
                  key={option.name}
                  className='flex h-7 cursor-pointer select-none items-center rounded-lg px-2 py-1.5 hover:bg-state-base-hover'
                  onClick={() => handleCheck(option.name)}
                >
                  <Checkbox
                    className='mr-1'
                    checked={tags.includes(option.name)}
                  />
                  <div className='system-sm-medium px-1 text-text-secondary'>
                    {option.label}
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default TagsFilter
