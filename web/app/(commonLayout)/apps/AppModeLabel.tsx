'use client'

import { useTranslation } from 'react-i18next'
import { type AppMode } from '@/types/app'
import {
  AiText,
  CuteRobote,
} from '@/app/components/base/icons/src/vender/solid/communication'
import { BubbleText } from '@/app/components/base/icons/src/vender/solid/education'

export type AppModeLabelProps = {
  mode: AppMode
  isAgent?: boolean
  className?: string
}

const AppModeLabel = ({
  mode,
  isAgent,
  className,
}: AppModeLabelProps) => {
  const { t } = useTranslation()

  return (
    <div className={`inline-flex items-center px-2 h-6 rounded-md border border-gray-100 text-xs text-gray-500 ${className}`}>
      {
        mode === 'completion' && (
          <>
            <AiText className='mr-1 w-3 h-3 text-gray-400' />
            {t('app.newApp.completeApp')}
          </>
        )
      }
      {
        mode === 'chat' && !isAgent && (
          <>
            <BubbleText className='mr-1 w-3 h-3 text-gray-400' />
            {t('appDebug.assistantType.chatAssistant.name')}
          </>
        )
      }
      {
        mode === 'chat' && isAgent && (
          <>
            <CuteRobote className='mr-1 w-3 h-3 text-gray-400' />
            {t('appDebug.assistantType.agentAssistant.name')}
          </>
        )
      }
    </div>
  )
}

export default AppModeLabel
