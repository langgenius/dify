'use client'

import { useState } from 'react'
import {
  RiPriceTag3Line,
} from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Checkbox from '@/app/components/base/checkbox'
import cn from '@/utils/classnames'
import Input from '@/app/components/base/input'
import { useTags } from '@/app/components/plugins/hooks'
import { useMixedTranslation } from '@/app/components/plugins/marketplace/hooks'

type TagsFilterProps = {
  tags: string[]
  onTagsChange: (tags: string[]) => void
  size: 'small' | 'large'
  locale?: string
}
const TagsFilter = ({
  tags,
  onTagsChange,
  size,
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
        <div className={cn(
          'ml-0.5 mr-1.5 flex  items-center text-text-tertiary ',
          size === 'large' && 'h-8 py-1',
          size === 'small' && 'h-7 py-0.5 ',
          // selectedTagsLength && 'text-text-secondary',
          // open && 'bg-state-base-hover',
        )}>
          <div className='cursor-pointer rounded-md p-0.5 hover:bg-state-base-hover'>
            <RiPriceTag3Line className='h-4 w-4 text-text-tertiary' />
          </div>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[1000]'>
        <div className='w-[240px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg'>
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
                  className='flex h-7 cursor-pointer items-center rounded-lg px-2 py-1.5 hover:bg-state-base-hover'
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
