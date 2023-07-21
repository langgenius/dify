'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import type { IConfigProps } from '../config'
import Config from '../config'
import s from './style.module.css'

const Line = (
  <svg width="720" height="1" viewBox="0 0 720 1" fill="none" xmlns="http://www.w3.org/2000/svg">
    <line y1="0.5" x2="720" y2="0.5" stroke="url(#paint0_linear_6845_53470)"/>
    <defs>
      <linearGradient id="paint0_linear_6845_53470" x1="0" y1="1" x2="720" y2="1" gradientUnits="userSpaceOnUse">
        <stop stopColor="#F2F4F7" stopOpacity="0"/>
        <stop offset="0.491667" stopColor="#F2F4F7"/>
        <stop offset="1" stopColor="#F2F4F7" stopOpacity="0"/>
      </linearGradient>
    </defs>
  </svg>
)

const Init: FC<IConfigProps> = ({
  ...configProps
}) => {
  const { t } = useTranslation()

  return (
    <div className='h-full flex items-center'>
      <div>
        <div className='w-[480px] mx-auto text-center'>
          <div className={cn(s.textGradient, 'mb-2 leading-[32px] font-semibold text-[24px]')}>{t('explore.universalChat.welcome')}</div>
          <div className='mb-2 font-normal text-sm text-gray-500'>{t('explore.universalChat.welcomeDescribe')}</div>
        </div>
        <div className='flex mb-2 mx-auto h-8 items-center'>
          {Line}
        </div>
        <Config className='w-[480px] mx-auto' {...configProps} />
      </div>
    </div>
  )
}
export default React.memo(Init)
