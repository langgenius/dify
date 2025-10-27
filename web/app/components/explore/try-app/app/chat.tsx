'use client'
import type { FC } from 'react'
import React, { useEffect } from 'react'
import ChatWrapper from '@/app/components/base/chat/embedded-chatbot/chat-wrapper'
import { useThemeContext } from '../../../base/chat/embedded-chatbot/theme/theme-context'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import {
  EmbeddedChatbotContext,
} from '@/app/components/base/chat/embedded-chatbot/context'
import {
  useEmbeddedChatbot,
} from '@/app/components/base/chat/embedded-chatbot/hooks'
import cn from '@/utils/classnames'
import { AppSourceType } from '@/service/share'
import Alert from '@/app/components/base/alert'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import type { TryAppInfo } from '@/service/try-app'
import AppIcon from '@/app/components/base/app-icon'
import Tooltip from '@/app/components/base/tooltip'
import ActionButton from '@/app/components/base/action-button'
import { RiResetLeftLine } from '@remixicon/react'
import ViewFormDropdown from '@/app/components/base/chat/embedded-chatbot/inputs-form/view-form-dropdown'

type Props = {
  appId: string
  appDetail: TryAppInfo
  className: string
}

const TryApp: FC<Props> = ({
  appId,
  appDetail,
  className,
}) => {
  const { t } = useTranslation()
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const themeBuilder = useThemeContext()
  const { removeConversationIdInfo, ...chatData } = useEmbeddedChatbot(AppSourceType.tryApp, appId)
  const currentConversationId = chatData.currentConversationId
  const inputsForms = chatData.inputsForms
  useEffect(() => {
    if (appId)
      removeConversationIdInfo(appId)
  }, [appId])
  const [isHideTryNotice, {
    setTrue: hideTryNotice,
  }] = useBoolean(false)

  const handleNewConversation = () => {
    removeConversationIdInfo(appId)
    chatData.handleNewConversation()
  }
  return (
    <EmbeddedChatbotContext.Provider value={{
      ...chatData,
      disableFeedback: true,
      isMobile,
      themeBuilder,
    } as any}>
      <div className={cn('flex h-full flex-col rounded-2xl bg-background-section-burn', className)}>
        <div className='flex shrink-0 justify-between p-3'>
          <div className='flex grow items-center space-x-2'>
            <AppIcon
              size='large'
              iconType={appDetail.site.icon_type}
              icon={appDetail.site.icon}
              background={appDetail.site.icon_background}
              imageUrl={appDetail.site.icon_url}
            />
            <div className='system-md-semibold grow truncate text-text-primary' title={appDetail.name}>{appDetail.name}</div>
          </div>
          <div className='flex items-center gap-1'>
            {currentConversationId && (
              <Tooltip
                popupContent={t('share.chat.resetChat')}
              >
                <ActionButton size='l' onClick={handleNewConversation}>
                  <RiResetLeftLine className='h-[18px] w-[18px]' />
                </ActionButton>
              </Tooltip>
            )}
            {currentConversationId && inputsForms.length > 0 && (
              <ViewFormDropdown />
            )}
          </div>
        </div>
        <div className='mx-auto mt-4 flex h-[0] w-[769px] grow flex-col'>
          {!isHideTryNotice && (
            <Alert className='mb-4 shrink-0' message={t('explore.tryApp.tryInfo')} onHide={hideTryNotice} />
          )}
          <ChatWrapper />
        </div>
      </div>
    </EmbeddedChatbotContext.Provider>
  )
}
export default React.memo(TryApp)
