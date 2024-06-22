'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { PlusIcon } from '@heroicons/react/24/outline'
import Button from '@/app/components/base/button'
export type INoDataProps = {
  onStartCreateContent: () => void
}

const markIcon = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4.16699 6.5C4.16699 5.09987 4.16699 4.3998 4.43948 3.86502C4.67916 3.39462 5.06161 3.01217 5.53202 2.77248C6.0668 2.5 6.76686 2.5 8.16699 2.5H11.8337C13.2338 2.5 13.9339 2.5 14.4686 2.77248C14.939 3.01217 15.3215 3.39462 15.5612 3.86502C15.8337 4.3998 15.8337 5.09987 15.8337 6.5V17.5L10.0003 14.1667L4.16699 17.5V6.5Z" stroke="#667085" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const lightIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="inline relative -top-3 -left-1.5"><path d="M5 6.5V5M8.93934 7.56066L10 6.5M10.0103 11.5H11.5103" stroke="#374151" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path></svg>
)

const NoData: FC<INoDataProps> = ({
  onStartCreateContent,
}) => {
  const { t } = useTranslation()

  return (
    <div className='mt-[60px] px-5 py-4 rounded-2xl bg-gray-50 '>
      <div className='flex items-center justify-center w-11 h-11 border border-gray-100 rounded-lg'>
        {markIcon}
      </div>
      <div className='mt-2'>
        <span className='text-gray-700 font-semibold'>{t('share.generation.savedNoData.title')}</span>
        {lightIcon}
      </div>
      <div className='mt-2 text-gray-500 text-[13px] font-normal'>
        {t('share.generation.savedNoData.description')}
      </div>
      <Button
        className='mt-4'
        onClick={onStartCreateContent}
      >
        <div className='flex items-center space-x-2 text-primary-600 text-[13px] font-medium'>
          <PlusIcon className='w-4 h-4' />
          <span>{t('share.generation.savedNoData.startCreateContent')}</span>
        </div>
      </Button>
    </div>
  )
}

export default React.memo(NoData)
