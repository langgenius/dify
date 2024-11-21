'use client'
import type { FC, SVGProps } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

const ThreeDotsIcon = ({ className }: SVGProps<SVGElement>) => {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className ?? ''}>
    <path d="M5 6.5V5M8.93934 7.56066L10 6.5M10.0103 11.5H11.5103" stroke="#374151" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

const EmptyElement: FC = () => {
  const { t } = useTranslation()

  return (
    <div className='flex items-center justify-center h-full'>
      <div className='bg-background-section-burn w-[560px] h-fit box-border px-5 py-4 rounded-2xl'>
        <span className='text-text-secondary system-md-semibold'>{t('appAnnotation.noData.title')}<ThreeDotsIcon className='inline relative -top-3 -left-1.5' /></span>
        <div className='mt-2 text-text-tertiary system-sm-regular'>
          {t('appAnnotation.noData.description')}
        </div>
      </div>
    </div>
  )
}
export default React.memo(EmptyElement)
