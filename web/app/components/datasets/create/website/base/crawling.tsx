'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
import { RowStruct } from '@/app/components/base/icons/src/public/other'

type Props = {
  className?: string
  crawledNum: number
  totalNum: number
}

const Crawling: FC<Props> = ({
  className = '',
  crawledNum,
  totalNum,
}) => {
  const { t } = useTranslation()

  return (
    <div className={cn(className, 'border-t border-gray-200')}>
      <div className='shadow-xs border-black/8 flex h-[34px] items-center border-b-[0.5px] bg-gray-50 px-4 text-xs font-normal text-gray-700'>
        {t('datasetCreation.stepOne.website.totalPageScraped')} {crawledNum}/{totalNum}
      </div>

      <div className='p-2'>
        {['', '', '', ''].map((item, index) => (
          <div className='py-[5px]' key={index}>
            <RowStruct />
          </div>
        ))}
      </div>
    </div>
  )
}
export default React.memo(Crawling)
