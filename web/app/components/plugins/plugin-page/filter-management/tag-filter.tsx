'use client'

import { useState } from 'react'
import {
  RiArrowDownSLine,
  RiCloseCircleFill,
} from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Checkbox from '@/app/components/base/checkbox'
import cn from '@/utils/classnames'
import Input from '@/app/components/base/input'
import { useTags } from '../../hooks'
import { useTranslation } from 'react-i18next'

type TagsFilterProps = {
  value: string[]
  onChange: (tags: string[]) => void
}
const TagsFilter = ({
  value,
  onChange,
}: TagsFilterProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const { tags: options, tagsMap } = useTags()
  const filteredOptions = options.filter(option => option.name.toLowerCase().includes(searchText.toLowerCase()))
  const handleCheck = (id: string) => {
    if (value.includes(id))
      onChange(value.filter(tag => tag !== id))
    else
      onChange([...value, id])
  }
  const selectedTagsLength = value.length

  return (
    <PortalToFollowElem
      placement='bottom-start'
      offset={{
        mainAxis: 4,
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <div className={cn(
          'flex items-center px-2 py-1 h-8 text-text-tertiary rounded-lg bg-components-input-bg-normal hover:bg-state-base-hover-alt cursor-pointer',
          selectedTagsLength && 'text-text-secondary',
          open && 'bg-state-base-hover',
        )}>
          <div className={cn(
            'flex items-center p-1 system-sm-medium',
          )}>
            {
              !selectedTagsLength && t('pluginTags.allTags')
            }
            {
              !!selectedTagsLength && value.map(val => tagsMap[val].label).slice(0, 2).join(',')
            }
            {
              selectedTagsLength > 2 && (
                <div className='ml-1 system-xs-medium text-text-tertiary'>
                  +{selectedTagsLength - 2}
                </div>
              )
            }
          </div>
          {
            !!selectedTagsLength && (
              <RiCloseCircleFill
                className='w-4 h-4 text-text-quaternary cursor-pointer'
                onClick={() => onChange([])}
              />
            )
          }
          {
            !selectedTagsLength && (
              <RiArrowDownSLine className='w-4 h-4' />
            )
          }
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-10'>
        <div className='w-[240px] border-[0.5px] border-components-panel-border bg-components-panel-bg-blur rounded-xl shadow-lg'>
          <div className='p-2 pb-1'>
            <Input
              showLeftIcon
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder={t('pluginTags.searchTags')}
            />
          </div>
          <div className='p-1 max-h-[448px] overflow-y-auto'>
            {
              filteredOptions.map(option => (
                <div
                  key={option.name}
                  className='flex items-center px-2 py-1.5 h-7 rounded-lg cursor-pointer hover:bg-state-base-hover'
                  onClick={() => handleCheck(option.name)}
                >
                  <Checkbox
                    className='mr-1'
                    checked={value.includes(option.name)}
                  />
                  <div className='px-1 system-sm-medium text-text-secondary'>
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
