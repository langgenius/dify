import type { FC } from 'react'
import type { Tag } from '@/app/components/base/tag-management/constant'
import { cn } from '@langgenius/dify-ui/cn'
import { useMount } from 'ahooks'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tag01, Tag03 } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import Input from '@/app/components/base/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/base/ui/popover'
import { fetchTagList } from '@/service/tag'

import { useStore as useTagStore } from './store'

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
  const setShowTagManagementModal = useTagStore(s => s.setShowTagManagementModal)

  const [keywords, setKeywords] = useState('')

  const filteredTagList = useMemo(() => {
    return tagList.filter(tag => tag.type === type && tag.name.includes(keywords))
  }, [type, tagList, keywords])

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
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <div className="relative">
        <PopoverTrigger
          render={(
            <button
              type="button"
              className={cn(
                'flex h-8 cursor-pointer items-center gap-1 rounded-lg border-[0.5px] border-transparent bg-components-input-bg-normal px-2 text-left select-none',
                !!value.length && 'pr-6 shadow-xs',
              )}
            >
              <div className="p-px">
                <Tag01 className="h-3.5 w-3.5 text-text-tertiary" data-testid="tag-filter-trigger-icon" />
              </div>
              <div className="min-w-0 truncate text-[13px] leading-[18px] text-text-secondary">
                {!value.length && t('tag.placeholder', { ns: 'common' })}
                {!!value.length && currentTag?.name}
              </div>
              {value.length > 1 && (
                <div className="shrink-0 text-xs leading-[18px] font-medium text-text-tertiary">{`+${value.length - 1}`}</div>
              )}
              {!value.length && (
                <div className="shrink-0 p-px">
                  <span className="i-ri-arrow-down-s-line h-3.5 w-3.5 text-text-tertiary" data-testid="tag-filter-arrow-down-icon" />
                </div>
              )}
            </button>
          )}
        />
        {!!value.length && (
          <button
            type="button"
            className="group/clear absolute top-1/2 right-2 -translate-y-1/2 p-px"
            onClick={() => onChange([])}
            data-testid="tag-filter-clear-button"
          >
            <span className="i-custom-vender-solid-general-x-circle h-3.5 w-3.5 text-text-tertiary group-hover/clear:text-text-secondary" />
          </button>
        )}
        <PopoverContent
          placement="bottom-start"
          sideOffset={4}
          popupClassName="w-[240px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px]"
        >
          <div className="relative">
            <div className="p-2">
              <Input
                showLeftIcon
                showClearIcon
                value={keywords}
                onChange={e => setKeywords(e.target.value)}
                onClear={() => setKeywords('')}
              />
            </div>
            <div className="max-h-72 overflow-auto p-1">
              {filteredTagList.map(tag => (
                <div
                  key={tag.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg py-[6px] pr-2 pl-3 select-none hover:bg-state-base-hover"
                  onClick={() => selectTag(tag)}
                >
                  <div title={tag.name} className="grow truncate text-sm leading-5 text-text-tertiary">{tag.name}</div>
                  {value.includes(tag.id) && <span className="i-custom-vender-line-general-check h-4 w-4 shrink-0 text-text-secondary" data-testid="tag-filter-selected-icon" />}
                </div>
              ))}
              {!filteredTagList.length && (
                <div className="flex flex-col items-center gap-1 p-3">
                  <Tag03 className="h-6 w-6 text-text-tertiary" />
                  <div className="text-xs leading-[14px] text-text-tertiary">{t('tag.noTag', { ns: 'common' })}</div>
                </div>
              )}
            </div>
            <div className="border-t-[0.5px] border-divider-regular" />
            <div className="p-1">
              <div
                className="flex cursor-pointer items-center gap-2 rounded-lg py-[6px] pr-2 pl-3 select-none hover:bg-state-base-hover"
                onClick={() => {
                  setShowTagManagementModal(true)
                  setOpen(false)
                }}
              >
                <Tag03 className="h-4 w-4 text-text-tertiary" />
                <div className="grow truncate text-sm leading-5 text-text-secondary">
                  {t('tag.manageTags', { ns: 'common' })}
                </div>
              </div>
            </div>
          </div>
        </PopoverContent>
      </div>
    </Popover>

  )
}

export default TagFilter
