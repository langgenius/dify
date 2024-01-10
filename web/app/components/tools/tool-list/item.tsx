'use client'
import type { FC } from 'react'
import React from 'react'
import { useContext } from 'use-context-selector'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import type { Tool } from '../types'
import Button from '../../base/button'
import I18n from '@/context/i18n'

type Props = {
  icon: JSX.Element
  payload: Tool
  added?: boolean
  onAdd?: (payload: Tool) => void
}

const Item: FC<Props> = ({
  icon,
  payload,
  added,
  onAdd,
}) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)

  return (
    <div className='flex justify-between items-center p-4 rounded-xl border border-gray-200 bg-white shadow-xs'>
      <div className='flex'>
        {icon}
        <div className='ml-3'>
          <div className={cn(' truncate', 'text-base font-semibold text-gray-900 truncate')}>{payload.label[locale === 'en' ? 'en_US' : 'zh_Hans']}</div>
          <div className={cn('max-w-[260px] truncate', 'leading-[18px] text-[13px] font-normal text-gray-500 truncate')}>
            {payload.description[locale === 'en' ? 'en_US' : 'zh_Hans']}
          </div>
        </div>
      </div>
      {onAdd && (
        <Button className='flex items-center h-7 !px-3 !text-xs !font-medium !text-gray-700' disabled={added} onClick={() => !added && onAdd(payload)}>{t(`common.operation.${added ? 'added' : 'add'}`)}</Button>
      )}
    </div>
  )
}
export default React.memo(Item)
