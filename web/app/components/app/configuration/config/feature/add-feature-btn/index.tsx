'use client'
import React, { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { PlusIcon } from '@heroicons/react/24/solid'

export interface IAddFeatureBtnProps {
  onClick: () => void
}

const AddFeatureBtn: FC<IAddFeatureBtnProps> = ({
  onClick
}) => {
  const { t } = useTranslation()
  return (
    <div
      className='
        flex items-center h-8 space-x-2 px-3
        border border-primary-100 rounded-lg bg-primary-25 hover:bg-primary-50 cursor-pointer
        text-xs font-semibold text-primary-600 uppercase 
      '
      style={{
        boxShadow: '0px 4px 8px -2px rgba(16, 24, 40, 0.1), 0px 2px 4px -2px rgba(16, 24, 40, 0.06)',
      }}
      onClick={onClick}
    >
      <PlusIcon className='w-4 h-4 font-semibold' />
      <div>{t('appDebug.operation.addFeature')}</div>
    </div>
  )
}
export default React.memo(AddFeatureBtn)
