'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

const AdvancedModeWarning: FC = () => {
  const { t } = useTranslation()
  const [show, setShow] = React.useState(true)
  if (!show)
    return null
  return (
    <div className='mb-3 py-3 px-4 border border-[#FEF0C7] rounded-xl bg-[#FFFAEB]' >
      <div className='mb-2 text-xs leading-[18px] font-bold text-[#DC6803]'>{t('appDebug.promptMode.advancedWarning.title')}</div>
      <div className='flex justify-between items-center'>
        <div className='text-xs leading-[18px] '>
          <span className='text-gray-700'>{t('appDebug.promptMode.advancedWarning.description')}</span>
          {/* TODO: Doc link */}
          {/* <a
            className='font-medium text-[#155EEF]'
            href='https://docs.dify.ai/getting-started/readme'
            target='_blank'
          >
            {t('appDebug.promptMode.advancedWarning.learnMore')}
          </a> */}
        </div>

        <div
          className='flex items-center h-6 px-2 rounded-md bg-[#fff] border border-gray-200 shadow-xs text-xs font-medium text-primary-600 cursor-pointer'
          onClick={() => setShow(false)}
        >{t('appDebug.promptMode.advancedWarning.ok')}</div>
      </div>
    </div>
  )
}
export default React.memo(AdvancedModeWarning)
