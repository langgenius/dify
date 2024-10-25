'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Panel from '@/app/components/app/configuration/base/feature-panel'
import SuggestedQuestionsAfterAnswerIcon from '@/app/components/app/configuration/base/icons/suggested-questions-after-answer-icon'
import Tooltip from '@/app/components/base/tooltip'

const SuggestedQuestionsAfterAnswer: FC = () => {
  const { t } = useTranslation()

  return (
    <Panel
      title={
        <div className='flex items-center gap-1'>
          <div>{t('appDebug.feature.suggestedQuestionsAfterAnswer.title')}</div>
          <Tooltip
            popupContent={
              <div className='w-[180px]'>
                {t('appDebug.feature.suggestedQuestionsAfterAnswer.description')}
              </div>
            }
          />
        </div>
      }
      headerIcon={<SuggestedQuestionsAfterAnswerIcon />}
      headerRight={
        <div className='text-xs text-gray-500'>{t('appDebug.feature.suggestedQuestionsAfterAnswer.resDes')}</div>
      }
      noBodySpacing
    />
  )
}
export default React.memo(SuggestedQuestionsAfterAnswer)
