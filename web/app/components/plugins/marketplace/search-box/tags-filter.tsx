'use client'

import { useState } from 'react'
import {
  RiArrowDownSLine,
  RiCloseCircleFill,
  RiFilter3Line,
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
          'text-text-tertiary hover:bg-state-base-hover flex cursor-pointer items-center rounded-lg',
          size === 'large' && 'h-8 px-2 py-1',
          size === 'small' && 'h-7 py-0.5 pl-1 pr-1.5 ',
          selectedTagsLength && 'text-text-secondary',
          open && 'bg-state-base-hover',
        )}>
          <div className='p-0.5'>
            <RiFilter3Line className='h-4 w-4' />
          </div>
          <div className={cn(
            'system-sm-medium flex items-center p-1',
            size === 'large' && 'p-1',
            size === 'small' && 'px-0.5 py-1',
          )}>
            {
              !selectedTagsLength && t('pluginTags.allTags')
            }
            {
              !!selectedTagsLength && tags.map(tag => tagsMap[tag].label).slice(0, 2).join(',')
            }
            {
              selectedTagsLength > 2 && (
                <div className='system-xs-medium text-text-tertiary ml-1'>
                  +{selectedTagsLength - 2}
                </div>
              )
            }
          </div>
          {
            !!selectedTagsLength && (
              <RiCloseCircleFill
                className='text-text-quaternary h-4 w-4 cursor-pointer'
                onClick={() => onTagsChange([])}
              />
            )
          }
          {
            !selectedTagsLength && (
              <RiArrowDownSLine className='h-4 w-4' />
            )
          }
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[1000]'>
        <div className='border-components-panel-border bg-components-panel-bg-blur w-[240px] rounded-xl border-[0.5px] shadow-lg'>
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
                  className='hover:bg-state-base-hover flex h-7 cursor-pointer items-center rounded-lg px-2 py-1.5'
                  onClick={() => handleCheck(option.name)}
                >
                  <Checkbox
                    className='mr-1'
                    checked={tags.includes(option.name)}
                  />
                  <div className='system-sm-medium text-text-secondary px-1'>
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
