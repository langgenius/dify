'use client'
import { useMemo } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import type { Collection } from '../types'
import cn from '@/utils/classnames'
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
    <div className={cn('group col-span-1 flex min-h-[160px] cursor-pointer flex-col rounded-xl border-2 border-solid border-transparent bg-white shadow-sm transition-all duration-200 ease-in-out hover:shadow-lg', active && '!border-primary-400')} onClick={onSelect}>
      <div className='flex h-[66px] shrink-0 grow-0 items-center gap-3 px-[14px] pb-3 pt-[14px]'>
        <div className='relative shrink-0'>
          {typeof collection.icon === 'string' && (
            <div className='h-10 w-10 rounded-md bg-cover bg-center bg-no-repeat' style={{ backgroundImage: `url(${collection.icon})` }} />
          )}
          {typeof collection.icon !== 'string' && (
            <AppIcon
              size='large'
              icon={collection.icon.content}
              background={collection.icon.background}
            />
          )}
        </div>
        <div className='w-0 grow py-[1px]'>
          <div className='flex items-center text-sm font-semibold leading-5 text-gray-800'>
            <div className='truncate' title={collection.label[language]}>{collection.label[language]}</div>
          </div>
          <div className='flex items-center text-[10px] font-medium leading-[18px] text-gray-500'>
            <div className='truncate'>{t('tools.author')}&nbsp;{collection.author}</div>
          </div>
        </div>
      </div>
      <div
        className={cn(
          'mb-2 max-h-[72px] grow px-[14px] text-xs leading-normal text-gray-500',
          collection.labels?.length ? 'line-clamp-2' : 'line-clamp-4',
          collection.labels?.length > 0 && 'group-hover:line-clamp-2 group-hover:max-h-[36px]',
        )}
        title={collection.description[language]}
      >
        {collection.description[language]}
      </div>
      {collection.labels?.length > 0 && (
        <div className='mt-1 flex h-[42px] shrink-0 items-center pb-[6px] pl-[14px] pr-[6px] pt-1'>
          <div className='relative flex w-full items-center gap-1 rounded-md py-[7px] text-gray-500' title={labelContent}>
            <Tag01 className='h-3 w-3 shrink-0' />
            <div className='grow truncate text-start text-xs font-normal leading-[18px]'>{labelContent}</div>
          </div>
        </div>
      )}
    </div>
  )
}
export default ProviderCard
