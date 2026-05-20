'use client'

import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
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
                  className="size-4 cursor-pointer text-text-quaternary"
                  onClick={(e) => {
                    e.stopPropagation()
                    onChange([])
                  }}
                />
              )
            }
            {
              !selectedTagsLength && (
                <RiArrowDownSLine className="size-4" />
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
          <CheckboxGroup
            aria-label={t('allTags', { ns: 'pluginTags' })}
            value={value}
            onValueChange={nextValue => onChange(nextValue)}
            className="max-h-[448px] overflow-y-auto p-1"
          >
            {
              filteredOptions.map(option => (
                <label
                  key={option.name}
                  className="flex h-7 cursor-pointer items-center rounded-lg px-2 py-1.5 select-none hover:bg-state-base-hover"
                >
                  <Checkbox
                    className="mr-1"
                    value={option.name}
                  />
                  <div className="px-1 system-sm-medium text-text-secondary">
                    {option.label}
                  </div>
                </label>
              ))
            }
          </CheckboxGroup>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default TagsFilter
