import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useDebounceFn, useMount } from 'ahooks'
import { RiArrowDownSLine } from '@remixicon/react'
import { useStore as useLabelStore } from './store'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import SearchInput from '@/app/components/base/search-input'
import { Tag03 } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import Checkbox from '@/app/components/base/checkbox'
import type { Label } from '@/app/components/tools/labels/constant'
import { fetchLabelList } from '@/service/tools'
import I18n from '@/context/i18n'
import { getLanguage } from '@/i18n/language'

type LabelSelectorProps = {
  value: string[]
  onChange: (v: string[]) => void
}
const LabelSelector: FC<LabelSelectorProps> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const language = getLanguage(locale)
  const [open, setOpen] = useState(false)

  const labelList = useLabelStore(s => s.labelList)
  const setLabelList = useLabelStore(s => s.setLabelList)

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
    return value.map(v => labelList.find(l => l.name === v)?.label[language]).join(', ')
  }, [value, labelList, language])

  const selectLabel = (label: Label) => {
    if (value.includes(label.name))
      onChange(value.filter(v => v !== label.name))
    else
      onChange([...value, label.name])
  }

  useMount(() => {
    fetchLabelList().then((res) => {
      setLabelList(res)
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
            'flex items-center gap-1 px-3 h-9 rounded-lg border-[0.5px] border-transparent bg-gray-100 cursor-pointer hover:bg-gray-200',
            open && '!bg-gray-200 hover:bg-gray-200',
          )}>
            <div title={value.length > 0 ? selectedLabels : ''} className={cn('grow text-[13px] leading-[18px] text-gray-700 truncate', !value.length && '!text-gray-400')}>
              {!value.length && t('tools.createTool.toolInput.labelPlaceholder')}
              {!!value.length && selectedLabels}
            </div>
            <div className='shrink-0 ml-1 text-gray-700 opacity-60'>
              <RiArrowDownSLine className='h-4 w-4' />
            </div>
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1040]'>
          <div className='relative w-[591px] bg-white rounded-lg border-[0.5px] border-gray-200  shadow-lg'>
            <div className='p-2 border-b-[0.5px] border-black/5'>
              <SearchInput white value={keywords} onChange={handleKeywordsChange} />
            </div>
            <div className='p-1 max-h-[264px] overflow-y-auto'>
              {filteredLabelList.map(label => (
                <div
                  key={label.name}
                  className='flex items-center gap-2 pl-3 py-[6px] pr-2 rounded-lg cursor-pointer hover:bg-gray-100'
                  onClick={() => selectLabel(label)}
                >
                  <Checkbox
                    className='shrink-0'
                    checked={value.includes(label.name)}
                    onCheck={() => { }}
                  />
                  <div title={label.label[language]} className='grow text-sm text-gray-700 leading-5 truncate'>{label.label[language]}</div>
                </div>
              ))}
              {!filteredLabelList.length && (
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

export default LabelSelector
