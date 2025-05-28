'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import TypeIcon from '../type-icon'
import RemoveIcon from '../../base/icons/remove-icon'
import s from './style.module.css'
import cn from '@/utils/classnames'
import type { DataSet } from '@/models/datasets'
import { formatNumber } from '@/utils/format'
import Tooltip from '@/app/components/base/tooltip'

export type ICardItemProps = {
  className?: string
  config: DataSet
  onRemove: (id: string) => void
  readonly?: boolean
}
const CardItem: FC<ICardItemProps> = ({
  className,
  config,
  onRemove,
  readonly,
}) => {
  const { t } = useTranslation()

  return (
    <div
      className={
        cn(className, s.card,
          'relative flex cursor-pointer items-center  rounded-xl border border-gray-200 bg-white px-3  py-2.5')
      }>
      <div className='flex items-center space-x-2'>
        <div className={cn(!config.embedding_available && 'opacity-50')}>
          <TypeIcon type="upload_file" />
        </div>
        <div>
          <div className='mr-1 flex w-[160px] items-center'>
            <div className={cn('overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium leading-[18px] text-gray-800', !config.embedding_available && 'opacity-50')}>{config.name}</div>
            {!config.embedding_available && (
              <Tooltip
                popupContent={t('dataset.unavailableTip')}
              >
                <span className='inline-flex shrink-0 whitespace-nowrap rounded-md border border-gray-200 px-1 text-xs font-normal leading-[18px] text-gray-500'>{t('dataset.unavailable')}</span>
              </Tooltip>
            )}
          </div>
          <div className={cn('flex max-w-[150px] text-xs text-gray-500', !config.embedding_available && 'opacity-50')}>
            {formatNumber(config.word_count)} {t('appDebug.feature.dataSet.words')} · {formatNumber(config.document_count)} {t('appDebug.feature.dataSet.textBlocks')}
          </div>
        </div>
      </div>

      {!readonly && <RemoveIcon className={`${s.deleteBtn} absolute right-1 top-1/2 translate-y-[-50%]`} onClick={() => onRemove(config.id)} />}
    </div>
  )
}
export default React.memo(CardItem)
