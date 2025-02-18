import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDebounceFn, useMount } from 'ahooks'
import { RiArrowDownSLine } from '@remixicon/react'
import { useStore as useTagStore } from './store'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Input from '@/app/components/base/input'
import { Tag01, Tag03 } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import { Check } from '@/app/components/base/icons/src/vender/line/general'
import { XCircle } from '@/app/components/base/icons/src/vender/solid/general'
import type { Tag } from '@/app/components/base/tag-management/constant'

import { fetchTagList } from '@/service/tag'

interface TagFilterProps {
  type: 'knowledge' | 'app'
  value: string[]
  onChange: (v: string[]) => void
}
const TagFilter: FC<TagFilterProps> = ({
  type,
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const tagList = useTagStore(s => s.tagList)
  const setTagList = useTagStore(s => s.setTagList)

  const [keywords, setKeywords] = useState('')
  const [searchKeywords, setSearchKeywords] = useState('')
  const { run: handleSearch } = useDebounceFn(() => {
    setSearchKeywords(keywords)
  }, { wait: 500 })
  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
    handleSearch()
  }

  const filteredTagList = useMemo(() => {
    return tagList.filter(tag => tag.type === type && tag.name.includes(searchKeywords))
  }, [type, tagList, searchKeywords])

  const currentTag = useMemo(() => {
    return tagList.find(tag => tag.id === value[0])
  }, [value, tagList])

  const selectTag = (tag: Tag) => {
    if (value.includes(tag.id))
      onChange(value.filter(v => v !== tag.id))
    else
      onChange([...value, tag.id])
  }

  useMount(() => {
    fetchTagList(type).then((res) => {
      setTagList(res)
    })
  })

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={4}
    >
      <div className='relative'>
        <PortalToFollowElemTrigger
          onClick={() => setOpen(v => !v)}
          className='block'
        >
          <div className={cn(
            'bg-components-input-bg-normal flex h-8 cursor-pointer items-center gap-1 rounded-lg border-[0.5px] border-transparent px-2',
            !open && !!value.length && 'shadow-xs',
            open && !!value.length && 'shadow-xs',
          )}>
            <div className='p-[1px]'>
              <Tag01 className='text-text-tertiary h-3.5 w-3.5' />
            </div>
            <div className='text-text-secondary text-[13px] leading-[18px]'>
              {!value.length && t('common.tag.placeholder')}
              {!!value.length && currentTag?.name}
            </div>
            {value.length > 1 && (
              <div className='text-text-tertiary text-xs font-medium leading-[18px]'>{`+${value.length - 1}`}</div>
            )}
            {!value.length && (
              <div className='p-[1px]'>
                <RiArrowDownSLine className='text-text-tertiary h-3.5 w-3.5' />
              </div>
            )}
            {!!value.length && (
              <div className='group/clear cursor-pointer p-[1px]' onClick={(e) => {
                e.stopPropagation()
                onChange([])
              }}>
                <XCircle className='text-text-tertiary group-hover/clear:text-text-secondary h-3.5 w-3.5' />
              </div>
            )}
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1002]'>
          <div className='bg-components-panel-bg-blur border-components-panel-border relative w-[240px] rounded-lg border-[0.5px] shadow-lg backdrop-blur-[5px]'>
            <div className='p-2'>
              <Input
                showLeftIcon
                showClearIcon
                value={keywords}
                onChange={e => handleKeywordsChange(e.target.value)}
                onClear={() => handleKeywordsChange('')}
              />
            </div>
            <div className='max-h-72 overflow-auto p-1'>
              {filteredTagList.map(tag => (
                <div
                  key={tag.id}
                  className='hover:bg-state-base-hover flex cursor-pointer items-center gap-2 rounded-lg py-[6px] pl-3 pr-2'
                  onClick={() => selectTag(tag)}
                >
                  <div title={tag.name} className='text-text-tertiary grow truncate text-sm leading-5'>{tag.name}</div>
                  {value.includes(tag.id) && <Check className='text-text-secondary h-4 w-4 shrink-0' />}
                </div>
              ))}
              {!filteredTagList.length && (
                <div className='flex flex-col items-center gap-1 p-3'>
                  <Tag03 className='text-text-tertiary h-6 w-6' />
                  <div className='text-text-tertiary text-xs leading-[14px]'>{t('common.tag.noTag')}</div>
                </div>
              )}
            </div>
          </div>
        </PortalToFollowElemContent>
      </div>
    </PortalToFollowElem>

  )
}

export default TagFilter
