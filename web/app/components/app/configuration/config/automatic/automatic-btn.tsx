'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Generator } from '@/app/components/base/icons/src/vender/other'

export type IAutomaticBtnProps = {
  onClick: () => void
}
const AutomaticBtn: FC<IAutomaticBtnProps> = ({
  onClick,
}) => {
  const { t } = useTranslation()

  return (
    <div className='flex space-x-1 items-center !h-8 cursor-pointer'
      onClick={onClick}
    >
      <Generator className='w-3.5 h-3.5 text-indigo-600' />
      <span className='text-xs font-semibold text-indigo-600'>{t('appDebug.operation.automatic')}</span>
    </div>
  )
}
export default React.memo(AutomaticBtn)
