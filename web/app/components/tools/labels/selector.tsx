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
            'flex items-center gap-1 px-3 h-10 rounded-lg border-[0.5px] border-transparent bg-components-input-bg-normal cursor-pointer hover:bg-components-input-bg-hover',
            open && '!hover:bg-components-input-bg-hover hover:bg-components-input-bg-hover',
          )}>
            <div title={value.length > 0 ? selectedLabels : ''} className={cn('grow text-[13px] leading-[18px] text-text-secondary truncate', !value.length && '!text-text-quaternary')}>
              {!value.length && t('tools.createTool.toolInput.labelPlaceholder')}
              {!!value.length && selectedLabels}
            </div>
            <div className='shrink-0 ml-1 text-text-secondary opacity-60'>
              <RiArrowDownSLine className='h-4 w-4' />
            </div>
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1040]'>
          <div className='relative w-[591px] bg-components-panel-bg-blur backdrop-blur-[5px] rounded-lg border-[0.5px] border-components-panel-border  shadow-lg'>
            <div className='p-2 border-b-[0.5px] border-divider-regular'>
              <Input
                showLeftIcon
                showClearIcon
                value={keywords}
                onChange={e => handleKeywordsChange(e.target.value)}
                onClear={() => handleKeywordsChange('')}
              />
            </div>
            <div className='p-1 max-h-[264px] overflow-y-auto'>
              {filteredLabelList.map(label => (
                <div
                  key={label.name}
                  className='flex items-center gap-2 pl-3 py-[6px] pr-2 rounded-lg cursor-pointer hover:bg-components-panel-on-panel-item-bg-hover'
                  onClick={() => selectLabel(label)}
                >
                  <Checkbox
                    className='shrink-0'
                    checked={value.includes(label.name)}
                    onCheck={() => { }}
                  />
                  <div title={label.label} className='grow text-sm text-text-secondary leading-5 truncate'>{label.label}</div>
                </div>
              ))}
              {!filteredLabelList.length && (
                <div className='p-3 flex flex-col items-center gap-1'>
                  <Tag03 className='h-6 w-6 text-text-quaternary' />
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
