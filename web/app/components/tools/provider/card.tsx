'use client'
import { useMemo } from 'react'
import cn from 'classnames'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import type { Collection } from '../types'
import AppIcon from '@/app/components/base/app-icon'
import { Tag01 } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import I18n from '@/context/i18n'
import { getLanguage } from '@/i18n/language'
import { useStore as useLabelStore } from '@/app/components/tools/labels/store'

type Props = {
  active: boolean
  collection: Collection
  onSelect: () => void
}

const ProviderCard = ({
  active,
  collection,
  onSelect,
}: Props) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const language = getLanguage(locale)
  const labelList = useLabelStore(s => s.labelList)

  const labelContent = useMemo(() => {
    if (!collection.labels)
      return ''
    return collection.labels.map((name) => {
      const label = labelList.find(item => item.name === name)
      return label?.label[language]
    }).filter(Boolean).join(', ')
  }, [collection.labels, labelList, language])

  return (
    <div className={cn('group flex col-span-1 bg-white border-2 border-solid border-transparent rounded-xl shadow-sm min-h-[160px] flex flex-col transition-all duration-200 ease-in-out cursor-pointer hover:shadow-lg', active && '!border-primary-400')} onClick={onSelect}>
      <div className='flex pt-[14px] px-[14px] pb-3 h-[66px] items-center gap-3 grow-0 shrink-0'>
        <div className='relative shrink-0'>
          {typeof collection.icon === 'string' && (
            <div className='w-10 h-10 bg-center bg-cover bg-no-repeat rounded-md' style={{ backgroundImage: `url(${collection.icon})` }}/>
          )}
          {typeof collection.icon !== 'string' && (
            <AppIcon
              size='large'
              icon={collection.icon.content}
              background={collection.icon.background}
            />
          )}
        </div>
        <div className='grow w-0 py-[1px]'>
          <div className='flex items-center text-sm leading-5 font-semibold text-gray-800'>
            <div className='truncate' title={collection.label[language]}>{collection.label[language]}</div>
          </div>
          <div className='flex items-center text-[10px] leading-[18px] text-gray-500 font-medium'>
            <div className='truncate'>{t('tools.author')}&nbsp;{collection.author}</div>
          </div>
        </div>
      </div>
      <div
        className={cn(
          'grow mb-2 px-[14px] max-h-[72px] text-xs leading-normal text-gray-500',
          collection.labels?.length ? 'line-clamp-2' : 'line-clamp-4',
          collection.labels?.length > 0 && 'group-hover:line-clamp-2 group-hover:max-h-[36px]',
        )}
        title={collection.description[language]}
      >
        {collection.description[language]}
      </div>
      {collection.labels?.length > 0 && (
        <div className='flex items-center shrink-0 mt-1 pt-1 pl-[14px] pr-[6px] pb-[6px] h-[42px]'>
          <div className='relative w-full flex items-center gap-1 py-[7px] rounded-md text-gray-500' title={labelContent}>
            <Tag01 className='shrink-0 w-3 h-3' />
            <div className='grow text-xs text-start leading-[18px] font-normal truncate'>{labelContent}</div>
          </div>
        </div>
      )}
    </div>
  )
}
export default ProviderCard
