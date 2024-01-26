'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen01 } from '../base/icons/src/vender/line/education'
import { Icon3Dots } from '../base/icons/src/public/other'

const NoCustomToolPlaceHolder: FC = () => {
  const { t } = useTranslation()

  return (
    <div className='h-full flex items-center justify-center'>
      <div className='p-6 rounded-xl bg-gray-50'>
        <div className='inline-flex p-2 border border-gray-200 rounded-md'>
          <BookOpen01 className='w-4 h-4 text-primary-600' />
        </div>
        <div className='mt-3 leading-6 text-base font-medium text-gray-700'>
          {t('tools.noCustomTool.title')}
          <Icon3Dots className='inline relative -top-3 -left-1.5' />
        </div>
        <div className='mt-2 leading-5 text-sm font-normal text-gray-700'>{t('tools.noCustomTool.content')}</div>
      </div>
    </div>
  )
}
export default React.memo(NoCustomToolPlaceHolder)
