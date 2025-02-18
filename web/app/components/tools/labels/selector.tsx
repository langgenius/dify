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
import { Tag03 } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import Checkbox from '@/app/components/base/checkbox'
import type { Label } from '@/app/components/tools/labels/constant'
import { useTags } from '@/app/components/plugins/hooks'

type LabelSelectorProps = {
  value: string[]
  onChange: (v: string[]) => void
}
const LabelSelector: FC<LabelSelectorProps> = ({
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

  const selectedLabels = useMemo(() => {
    return value.map(v => labelList.find(l => l.name === v)?.label).join(', ')
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
            'bg-components-input-bg-normal hover:bg-components-input-bg-hover flex h-10 cursor-pointer items-center gap-1 rounded-lg border-[0.5px] border-transparent px-3',
            open && '!hover:bg-components-input-bg-hover hover:bg-components-input-bg-hover',
          )}>
            <div title={value.length > 0 ? selectedLabels : ''} className={cn('text-text-secondary grow truncate text-[13px] leading-[18px]', !value.length && '!text-text-quaternary')}>
              {!value.length && t('tools.createTool.toolInput.labelPlaceholder')}
              {!!value.length && selectedLabels}
            </div>
            <div className='text-text-secondary ml-1 shrink-0 opacity-60'>
              <RiArrowDownSLine className='h-4 w-4' />
            </div>
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1040]'>
          <div className='bg-components-panel-bg-blur border-components-panel-border relative w-[591px] rounded-lg border-[0.5px] shadow-lg  backdrop-blur-[5px]'>
            <div className='border-divider-regular border-b-[0.5px] p-2'>
              <Input
                showLeftIcon
                showClearIcon
                value={keywords}
                onChange={e => handleKeywordsChange(e.target.value)}
                onClear={() => handleKeywordsChange('')}
              />
            </div>
            <div className='max-h-[264px] overflow-y-auto p-1'>
              {filteredLabelList.map(label => (
                <div
                  key={label.name}
                  className='hover:bg-components-panel-on-panel-item-bg-hover flex cursor-pointer items-center gap-2 rounded-lg py-[6px] pl-3 pr-2'
                  onClick={() => selectLabel(label)}
                >
                  <Checkbox
                    className='shrink-0'
                    checked={value.includes(label.name)}
                    onCheck={() => { }}
                  />
                  <div title={label.label} className='text-text-secondary grow truncate text-sm leading-5'>{label.label}</div>
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

export default LabelSelector
