'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Heart02 } from '../base/icons/src/vender/solid/education'
import { BookOpen01 } from '../base/icons/src/vender/line/education'

const Contribute: FC = () => {
  const { t } = useTranslation()

  return (
    <div className='shrink-0 p-2'>
      <div className='inline-block p-2 bg-white shadow-lg rounded-lg'>
        <Heart02 className='w-3 h-3 text-[#EE46BC]' />
      </div>
      <div className='mt-2'>
        <div className='text-gradient'>
          {t('tools.contribute.line1')}
        </div>
        <div className='text-gradient'>
          {t('tools.contribute.line2')}
        </div>
      </div>
      <a href='https://github.com/langgenius/dify/blob/main/CONTRIBUTING.md' target='_blank' rel='noopener noreferrer' className='mt-1 flex items-center space-x-1 text-[#155EEF]'>
        <BookOpen01 className='w-3 h-3' />
        <div className='leading-[18px] text-xs font-normal'>{t('tools.contribute.viewGuide')}</div>
      </a>
    </div>
  )
}
export default React.memo(Contribute)
