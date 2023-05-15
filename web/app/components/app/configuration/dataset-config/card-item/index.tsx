'use client'
import React, { FC } from 'react'
import cn from 'classnames'
import TypeIcon from '../type-icon'
import { useTranslation } from 'react-i18next'
import { formatNumber } from '@/utils/format'
import RemoveIcon from '../../base/icons/remove-icon'
import s from './style.module.css'

export interface ICardItemProps {
  className?: string
  config: any
  onRemove: (id: string) => void
}



// const RemoveIcon = ({ className, onClick }: { className: string, onClick: () => void }) => (
//   <svg className={className} onClick={onClick} width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
//     <path d="M10 6H14M6 8H18M16.6667 8L16.1991 15.0129C16.129 16.065 16.0939 16.5911 15.8667 16.99C15.6666 17.3412 15.3648 17.6235 15.0011 17.7998C14.588 18 14.0607 18 13.0062 18H10.9938C9.93927 18 9.41202 18 8.99889 17.7998C8.63517 17.6235 8.33339 17.3412 8.13332 16.99C7.90607 16.5911 7.871 16.065 7.80086 15.0129L7.33333 8M10.6667 11V14.3333M13.3333 11V14.3333" stroke="#667085" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
//   </svg>
// )

const CardItem: FC<ICardItemProps> = ({
  className,
  config,
  onRemove
}) => {
  const { t } = useTranslation()

  return (
    <div
      className={
        cn(className, s.card,
          'flex items-center justify-between rounded-xl  px-3 py-2.5 bg-white border border-gray-200  cursor-pointer')
      }>
      <div className='shrink-0 flex items-center space-x-2'>
        <TypeIcon type="upload_file" />
        <div>
          <div className='w-[160px] text-[13px] leading-[18px] font-medium text-gray-800 overflow-hidden text-ellipsis whitespace-nowrap'>{config.name}</div>
          <div className='flex text-xs text-gray-500'>
            {formatNumber(config.word_count)} {t('appDebug.feature.dataSet.words')} · {formatNumber(config.document_count)} {t('appDebug.feature.dataSet.textBlocks')}
          </div>
        </div>
      </div>

      <RemoveIcon className={`${s.deleteBtn} shrink-0`} onClick={() => onRemove(config.id)} />
    </div>
  )
}
export default React.memo(CardItem)
