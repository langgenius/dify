'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiQuestionLine,
} from '@remixicon/react'
import { MessageSmileSquare } from '@/app/components/base/icons/src/vender/solid/communication'
import TooltipPlus from '@/app/components/base/tooltip-plus'

const SuggestedQuestionsAfterAnswer: FC = () => {
  const { t } = useTranslation()

  return (
    <div className='flex items-center px-3 h-12 bg-gray-50 rounded-xl overflow-hidden'>
      <div className='shrink-0 flex items-center justify-center mr-1 w-6 h-6'>
        <MessageSmileSquare className='w-4 h-4 text-[#06AED4]' />
      </div>
      <div className='shrink-0 mr-2 flex items-center whitespace-nowrap text-sm text-gray-800 font-semibold'>
        <div className='mr-2'>{t('appDebug.feature.suggestedQuestionsAfterAnswer.title')}</div>
        <TooltipPlus popupContent={t('appDebug.feature.suggestedQuestionsAfterAnswer.description')}>
          <RiQuestionLine className='w-[14px] h-[14px] text-gray-400' />
        </TooltipPlus>
      </div>
      <div className='grow'></div>
      <div className='text-xs text-gray-500'>{t('appDebug.feature.suggestedQuestionsAfterAnswer.resDes')}</div>
    </div>
  )
}
export default React.memo(SuggestedQuestionsAfterAnswer)
