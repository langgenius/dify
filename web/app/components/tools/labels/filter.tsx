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
            'bg-components-input-bg-normal hover:bg-components-input-bg-hover flex h-8 cursor-pointer items-center gap-1 rounded-lg border-[0.5px] border-transparent px-2',
            !open && !!value.length && 'shadow-xs',
            open && !!value.length && 'shadow-xs',
          )}>
            <div className='p-[1px]'>
              <Tag01 className='text-text-tertiary h-3.5 w-3.5' />
            </div>
            <div className='text-text-tertiary text-[13px] leading-[18px]'>
              {!value.length && t('common.tag.placeholder')}
              {!!value.length && currentLabel?.label}
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
          <div className='bg-components-panel-bg-blur border-components-panel-border relative w-[240px] rounded-lg border-[0.5px] shadow-lg  backdrop-blur-[5px]'>
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
                  className='hover:bg-state-base-hover flex cursor-pointer items-center gap-2 rounded-lg py-[6px] pl-3 pr-2'
                  onClick={() => selectLabel(label)}
                >
                  <div title={label.label} className='text-text-secondary grow truncate text-sm leading-5'>{label.label}</div>
                  {value.includes(label.name) && <Check className='text-text-accent h-4 w-4 shrink-0' />}
                </div>
              ))}
              {!filteredLabelList.length && (
                <div className='flex flex-col items-center gap-1 p-3'>
                  <Tag03 className='text-text-quaternary h-6 w-6' />
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

export default LabelFilter
