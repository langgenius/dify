'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import TypeIcon from '../type-icon'
import RemoveIcon from '../../base/icons/remove-icon'
import s from './style.module.css'
import type { DataSet } from '@/models/datasets'
import { formatNumber } from '@/utils/format'
import Tooltip from '@/app/components/base/tooltip'
import { Settings01 } from '@/app/components/base/icons/src/vender/line/general'

export type ICardItemProps = {
  className?: string
  config: DataSet
  onSetting: (id: string) => void
  onRemove: (id: string) => void
  readonly?: boolean
}

const CardItem: FC<ICardItemProps> = ({
  className,
  config,
  onSetting,
  onRemove,
  readonly,
}) => {
  const { t } = useTranslation()

  return (
    <div
      className={
        cn(className, s.card,
          'relative flex items-center justify-between rounded-xl px-2.5 py-2 bg-white border border-gray-200  cursor-pointer')
      }>
      <div className='flex items-center space-x-2'>
        <div className={cn(!config.embedding_available && 'opacity-50')}>
          <TypeIcon type="upload_file" size='md' />
        </div>
        <div>
          <div className='flex items-center w-[290px]'>
            <div className={cn('text-[13px] leading-[18px] font-medium text-gray-800 overflow-hidden text-ellipsis whitespace-nowrap', !config.embedding_available && 'opacity-50')}>{config.name}</div>
            {!config.embedding_available && (
              <Tooltip
                selector={`unavailable-tag-${config.id}`}
                htmlContent={t('dataset.unavailableTip')}
              >
                <span className='shrink-0 inline-flex whitespace-nowrap px-1 border boder-gray-200 rounded-md text-gray-500 text-xs font-normal leading-[18px]'>{t('dataset.unavailable')}</span>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
      <div className={cn('max-w-[150px] flex text-xs text-gray-500', !config.embedding_available && 'opacity-50')}>
        {formatNumber(config.word_count)} {t('appDebug.feature.dataSet.words')} · {formatNumber(config.document_count)} {t('appDebug.feature.dataSet.textBlocks')}
      </div>

      {!readonly
      && (
        <div className={`${s.btnWrap} absolute right-2 top-1/2 translate-y-[-50%] flex items-center space-x-1`}>
          <div
            onClick={() => onSetting(config.id)}
            className={cn(s.settingBtn, 'rounded-md text-gray-500 p-1 cursor-pointer')}
          >
            <Settings01 className='w-4 h-4' />
          </div>
          <RemoveIcon className={`${s.deleteBtn}`} onClick={() => onRemove(config.id)} />
        </div>
      )
      }
    </div>
  )
}
export default React.memo(CardItem)
