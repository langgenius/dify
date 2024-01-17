'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { SearchMd } from '../../base/icons/src/vender/solid/general'

type Props = {
  onReset: () => void
}

const NoSearchRes: FC<Props> = ({
  onReset,
}) => {
  const { t } = useTranslation()

  return (
    <div>
      <div className='inline-flex p-3 rounded-lg  bg-gray-50 border border-[#EAECF5]'>
        <SearchMd className='w-5 h-5 text-gray-500' />
      </div>
      <div className='mt-2'>
        <div className='leading-5 text-sm font-medium text-gray-500'>
          {t('tools.noSearchRes.title')}
        </div>
        <div className='mt-1 leading-[18px] text-xs font-normal text-gray-500'>
          {t('tools.noSearchRes.content')}
        </div>
        <div
          className='mt-2 leading-[18px] text-xs font-medium text-[#155EEF] uppercase cursor-pointer'
          onClick={onReset}
        >
          {t('tools.noSearchRes.reset')}
        </div>
      </div>
    </div>
  )
}
export default React.memo(NoSearchRes)
