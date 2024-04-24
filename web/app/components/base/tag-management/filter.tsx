import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDebounceFn, useMount } from 'ahooks'
import cn from 'classnames'
import { useStore as useTagStore } from './store'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import SearchInput from '@/app/components/base/search-input'
import { ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'
import { Tag01, Tag03 } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import { Check } from '@/app/components/base/icons/src/vender/line/general'
import { XCircle } from '@/app/components/base/icons/src/vender/solid/general'
import type { Tag } from '@/app/components/base/tag-management/constant'

import { fetchTagList } from '@/service/tag'

type TagFilterProps = {
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
            'flex items-center gap-1 px-2 h-8 rounded-lg border-[0.5px] border-transparent bg-gray-200 cursor-pointer hover:bg-gray-300',
            open && !value.length && '!bg-gray-300 hover:bg-gray-300',
            !open && !!value.length && '!bg-white/80 shadow-xs !border-black/5 hover:!bg-gray-200',
            open && !!value.length && '!bg-gray-200 !border-black/5 shadow-xs hover:!bg-gray-200',
          )}>
            <div className='p-[1px]'>
              <Tag01 className='h-3.5 w-3.5 text-gray-700' />
            </div>
            <div className='text-[13px] leading-[18px] text-gray-700'>
              {!value.length && t('common.tag.placeholder')}
              {!!value.length && currentTag?.name}
            </div>
            {value.length > 1 && (
              <div className='text-xs font-medium leading-[18px] text-gray-500'>{`+${value.length - 1}`}</div>
            )}
            {!value.length && (
              <div className='p-[1px]'>
                <ChevronDown className='h-3.5 w-3.5 text-gray-700'/>
              </div>
            )}
            {!!value.length && (
              <div className='p-[1px] cursor-pointer group/clear' onClick={(e) => {
                e.stopPropagation()
                onChange([])
              }}>
                <XCircle className='h-3.5 w-3.5 text-gray-400 group-hover/clear:text-gray-600'/>
              </div>
            )}
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1002]'>
          <div className='relative w-[240px] bg-white rounded-lg border-[0.5px] border-gray-200  shadow-lg'>
            <div className='p-2 border-b-[0.5px] border-black/5'>
              <SearchInput white value={keywords} onChange={handleKeywordsChange} />
            </div>
            <div className='p-1'>
              {filteredTagList.map(tag => (
                <div
                  key={tag.id}
                  className='flex items-center gap-2 pl-3 py-[6px] pr-2 rounded-lg cursor-pointer hover:bg-gray-100'
                  onClick={() => selectTag(tag)}
                >
                  <div title={tag.name} className='grow text-sm text-gray-700 leading-5 truncate'>{tag.name}</div>
                  {value.includes(tag.id) && <Check className='shrink-0 w-4 h-4 text-primary-600'/>}
                </div>
              ))}
              {!filteredTagList.length && (
                <div className='p-3 flex flex-col items-center gap-1'>
                  <Tag03 className='h-6 w-6 text-gray-300' />
                  <div className='text-gray-500 text-xs leading-[14px]'>{t('common.tag.noTag')}</div>
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
