import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDebounceFn } from 'ahooks'
import { RiArrowDownSLine } from '@remixicon/react'
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
import type { Label } from '@/app/components/tools/labels/constant'
import { useTags } from '@/app/components/plugins/hooks'

type LabelFilterProps = {
  value: string[]
  onChange: (v: string[]) => void
}
const LabelFilter: FC<LabelFilterProps> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const { tags: labelList } = useTags()

  const [keywords, setKeywords] = useState('')
  const [searchKeywords, setSearchKeywords] = useState('')
  const { run: handleSearch } = useDebounceFn(() => {
    setSearchKeywords(keywords)
  }, { wait: 500 })
  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
    handleSearch()
  }

  const filteredLabelList = useMemo(() => {
    return labelList.filter(label => label.name.includes(searchKeywords))
  }, [labelList, searchKeywords])

  const currentLabel = useMemo(() => {
    return labelList.find(label => label.name === value[0])
  }, [value, labelList])

  const selectLabel = (label: Label) => {
    if (value.includes(label.name))
      onChange(value.filter(v => v !== label.name))
    else
      onChange([...value, label.name])
  }

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
            'flex h-8 cursor-pointer select-none items-center gap-1 rounded-lg border-[0.5px] border-transparent bg-components-input-bg-normal px-2 hover:bg-components-input-bg-hover',
            !open && !!value.length && 'shadow-xs',
            open && !!value.length && 'shadow-xs',
          )}>
            <div className='p-[1px]'>
              <Tag01 className='h-3.5 w-3.5 text-text-tertiary' />
            </div>
            <div className='text-[13px] leading-[18px] text-text-tertiary'>
              {!value.length && t('common.tag.placeholder')}
              {!!value.length && currentLabel?.label}
            </div>
            {value.length > 1 && (
              <div className='text-xs font-medium leading-[18px] text-text-tertiary'>{`+${value.length - 1}`}</div>
            )}
            {!value.length && (
              <div className='p-[1px]'>
                <RiArrowDownSLine className='h-3.5 w-3.5 text-text-tertiary' />
              </div>
            )}
            {!!value.length && (
              <div className='group/clear cursor-pointer p-[1px]' onClick={(e) => {
                e.stopPropagation()
                onChange([])
              }}>
                <XCircle className='h-3.5 w-3.5 text-text-tertiary group-hover/clear:text-text-secondary' />
              </div>
            )}
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1002]'>
          <div className='relative w-[240px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg  backdrop-blur-[5px]'>
            <div className='p-2'>
              <Input
                showLeftIcon
                showClearIcon
                value={keywords}
                onChange={e => handleKeywordsChange(e.target.value)}
                onClear={() => handleKeywordsChange('')}
              />
            </div>
            <div className='p-1'>
              {filteredLabelList.map(label => (
                <div
                  key={label.name}
                  className='flex cursor-pointer select-none items-center gap-2 rounded-lg py-[6px] pl-3 pr-2 hover:bg-state-base-hover'
                  onClick={() => selectLabel(label)}
                >
                  <div title={label.label} className='grow truncate text-sm leading-5 text-text-secondary'>{label.label}</div>
                  {value.includes(label.name) && <Check className='h-4 w-4 shrink-0 text-text-accent' />}
                </div>
              ))}
              {!filteredLabelList.length && (
                <div className='flex flex-col items-center gap-1 p-3'>
                  <Tag03 className='h-6 w-6 text-text-quaternary' />
                  <div className='text-xs leading-[14px] text-text-tertiary'>{t('common.tag.noTag')}</div>
                </div>
              )}
            </div>
          </div>
        </PortalToFollowElemContent>
      </div>
    </PortalToFollowElem>

  )
}

export default LabelFilter
