'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
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
    <div className={className}>
      <div className='flex items-center h-[34px] px-4 shadow-xs shadow-shadow-shadow-3
        border-y-[0.5px] border-divider-regular text-xs text-text-tertiary'>
        {t('datasetCreation.stepOne.website.totalPageScraped')} {crawledNum}/{totalNum}
      </div>

      <div className='p-2'>
        {['', '', '', ''].map((item, index) => (
          <div className='py-[5px]' key={index}>
            <RowStruct className='text-text-quaternary' />
          </div>
        ))}
      </div>
    </div>
  )
}
export default React.memo(Crawling)
