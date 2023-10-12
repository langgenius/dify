'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { PlusIcon } from '@heroicons/react/24/solid'

export type IAddFeatureBtnProps = {
  toBottomHeight: number
  onClick: () => void
}

const ITEM_HEIGHT = 48

const AddFeatureBtn: FC<IAddFeatureBtnProps> = ({
  toBottomHeight,
  onClick,
}) => {
  const { t } = useTranslation()
  return (
    <div
      className='absolute z-[9] left-0 right-0 flex justify-center pb-4'
      style={{
        top: toBottomHeight - ITEM_HEIGHT,
        background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.00) 0%, #FFF 100%)',
      }}
    >
      <div
        className='flex items-center h-8 space-x-2 px-3
        border border-primary-100 rounded-lg bg-primary-25 hover:bg-primary-50 cursor-pointer
        text-xs font-semibold text-primary-600 uppercase
      '
        onClick={onClick}
      >
        <PlusIcon className='w-4 h-4 font-semibold' />
        <div>{t('appDebug.operation.addFeature')}</div>
      </div>
    </div>
  )
}
export default React.memo(AddFeatureBtn)
