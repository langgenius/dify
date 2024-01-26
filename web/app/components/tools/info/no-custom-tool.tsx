'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Icon3Dots } from '../../base/icons/src/public/other'
import { Tools } from '@/app/components/base/icons/src/public/header-nav/tools'
type Props = {
  onCreateTool: () => void
}

const NoCustomTool: FC<Props> = ({
  onCreateTool,
}) => {
  const { t } = useTranslation()

  return (
    <div>
      <div className='inline-flex p-3 rounded-lg  bg-gray-50 border border-[#EAECF5]'>
        <Tools className='w-5 h-5 text-gray-500' />
      </div>
      <div className='mt-2'>
        <div className='leading-5 text-sm font-medium text-gray-500'>
          {t('tools.noCustomTool.title')}<Icon3Dots className='inline relative -top-3 -left-1.5' />
        </div>
        <div className='mt-1 leading-[18px] text-xs font-normal text-gray-500'>
          {t('tools.noCustomTool.content')}
        </div>
        <div
          className='mt-2 leading-[18px] text-xs font-medium text-[#155EEF] uppercase cursor-pointer'
          onClick={onCreateTool}
        >
          {t('tools.noCustomTool.createTool')}
        </div>
      </div>
    </div>
  )
}
export default React.memo(NoCustomTool)
