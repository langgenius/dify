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
import { useCategories } from '../../hooks'
import { useTranslation } from 'react-i18next'

type CategoriesFilterProps = {
  value: string[]
  onChange: (categories: string[]) => void
}
const CategoriesFilter = ({
  value,
  onChange,
}: CategoriesFilterProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const { categories: options, categoriesMap } = useCategories()
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
          'text-text-tertiary bg-components-input-bg-normal hover:bg-state-base-hover-alt flex h-8 cursor-pointer items-center rounded-lg px-2 py-1',
          selectedTagsLength && 'text-text-secondary',
          open && 'bg-state-base-hover',
        )}>
          <div className={cn(
            'system-sm-medium flex items-center p-1',
          )}>
            {
              !selectedTagsLength && t('plugin.allCategories')
            }
            {
              !!selectedTagsLength && value.map(val => categoriesMap[val].label).slice(0, 2).join(',')
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
                onClick={
                  (e) => {
                    e.stopPropagation()
                    onChange([])
                  }
                }
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
      <PortalToFollowElemContent className='z-10'>
        <div className='border-components-panel-border bg-components-panel-bg-blur w-[240px] rounded-xl border-[0.5px] shadow-lg'>
          <div className='p-2 pb-1'>
            <Input
              showLeftIcon
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder={t('plugin.searchCategories')}
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
                    checked={value.includes(option.name)}
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

export default CategoriesFilter
