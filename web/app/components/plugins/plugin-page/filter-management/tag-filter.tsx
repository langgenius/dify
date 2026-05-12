'use client'

import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import {
  RiArrowDownSLine,
  RiCloseCircleFill,
} from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'
import Input from '@/app/components/base/input'
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
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger
        nativeButton={false}
        render={(
          <div className={cn(
            'flex h-8 cursor-pointer items-center rounded-lg bg-components-input-bg-normal px-2 py-1 text-text-tertiary select-none hover:bg-state-base-hover-alt',
            selectedTagsLength && 'text-text-secondary',
            open && 'bg-state-base-hover',
          )}
          >
            <div className={cn(
              'flex items-center p-1 system-sm-medium',
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
                  <div className="ml-1 system-xs-medium text-text-tertiary">
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
                  onClick={(e) => {
                    e.stopPropagation()
                    onChange([])
                  }}
                />
              )
            }
            {
              !selectedTagsLength && (
                <RiArrowDownSLine className="h-4 w-4" />
              )
            }
          </div>
        )}
      />
      <PopoverContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div className="w-[240px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-xs">
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
                  className="flex h-7 cursor-pointer items-center rounded-lg px-2 py-1.5 select-none hover:bg-state-base-hover"
                  onClick={() => handleCheck(option.name)}
                >
                  <Checkbox
                    className="mr-1"
                    checked={value.includes(option.name)}
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
