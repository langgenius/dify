'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import type { IConfigProps } from '../config'
import Config from '../config'
import s from './style.module.css'

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
          <div className={s.line}></div>
        </div>
        <Config className='w-[480px] mx-auto' {...configProps} />
      </div>
    </div>
  )
}
export default React.memo(Init)
