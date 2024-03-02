'use client'

import { useTranslation } from 'react-i18next'
import { type AppMode } from '@/types/app'
import { AiText, CuteRobote } from '@/app/components/base/icons/src/vender/solid/communication'
import { BubbleText } from '@/app/components/base/icons/src/vender/solid/education'
import { Route } from '@/app/components/base/icons/src/vender/line/mapsAndTravel'

export type AppModeLabelProps = {
  mode: AppMode
}

const AppModeLabel = ({
  mode,
}: AppModeLabelProps) => {
  const { t } = useTranslation()

  return (
    <>
      {mode === 'completion' && (
        <div className='inline-flex items-center px-2 h-6 rounded-md bg-gray-50 border border-gray-100 text-xs text-gray-500'>
          <AiText className='mr-1 w-3 h-3' />
          {t('app.types.completion')}
        </div>
      )}
      {(mode === 'chat' || mode === 'advanced-chat') && (
        <div className='inline-flex items-center px-2 h-6 rounded-md bg-blue-25 border border-blue-100 text-xs text-blue-600'>
          <BubbleText className='mr-1 w-3 h-3' />
          {t('app.types.chatbot')}
        </div>
      )}
      {mode === 'agent-chat' && (
        <div className='inline-flex items-center px-2 h-6 rounded-md bg-indigo-25 border border-indigo-100 text-xs text-indigo-600'>
          <CuteRobote className='mr-1 w-3 h-3' />
          {t('app.types.agent')}
        </div>
      )}
      {mode === 'workflow' && (
        <div className='inline-flex items-center px-2 h-6 rounded-md bg-[#fffcf5] border border-[#fef0c7] text-xs text-[#f79009]'>
          <Route className='mr-1 w-3 h-3' />
          {t('app.types.workflow')}
        </div>
      )}
    </>
  )
}

export default AppModeLabel
