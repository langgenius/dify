'use client'

import {
  RiArrowDownSLine,
  RiCloseCircleFill,
} from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'
import Input from '@/app/components/base/input'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'
import { useTags } from '../../hooks'

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
  const { tags: options, getTagLabel } = useTags()
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
      placement="bottom-start"
      offset={{
        mainAxis: 4,
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <div className={cn(
          'flex h-8 cursor-pointer select-none items-center rounded-lg bg-components-input-bg-normal px-2 py-1 text-text-tertiary hover:bg-state-base-hover-alt',
          selectedTagsLength && 'text-text-secondary',
          open && 'bg-state-base-hover',
        )}
        >
          <div className={cn(
            'system-sm-medium flex items-center p-1',
          )}
          >
            {
              !selectedTagsLength && t('allTags', { ns: 'pluginTags' })
            }
            {
              !!selectedTagsLength && value.map(val => getTagLabel(val)).slice(0, 2).join(',')
            }
            {
              selectedTagsLength > 2 && (
                <div className="system-xs-medium ml-1 text-text-tertiary">
                  +
                  {selectedTagsLength - 2}
                </div>
              )
            }
          </div>
          {
            !!selectedTagsLength && (
              <RiCloseCircleFill
                className="h-4 w-4 cursor-pointer text-text-quaternary"
                onClick={() => onChange([])}
              />
            )
          }
          {
            !selectedTagsLength && (
              <RiArrowDownSLine className="h-4 w-4" />
            )
          }
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-10">
        <div className="w-[240px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm">
          <div className="p-2 pb-1">
            <Input
              showLeftIcon
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder={t('searchTags', { ns: 'pluginTags' })}
            />
          </div>
          <div className="max-h-[448px] overflow-y-auto p-1">
            {
              filteredOptions.map(option => (
                <div
                  key={option.name}
                  className="flex h-7 cursor-pointer select-none items-center rounded-lg px-2 py-1.5 hover:bg-state-base-hover"
                  onClick={() => handleCheck(option.name)}
                >
                  <Checkbox
                    className="mr-1"
                    checked={value.includes(option.name)}
                  />
                  <div className="system-sm-medium px-1 text-text-secondary">
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
