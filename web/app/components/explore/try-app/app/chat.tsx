'use client'
import type { FC } from 'react'
import React from 'react'
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

type Props = {
  appId: string
  className: string
}

const TryApp: FC<Props> = ({
  appId,
  className,
}) => {
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const themeBuilder = useThemeContext()
  const chatData = useEmbeddedChatbot(AppSourceType.tryApp, appId)
  return (
    <EmbeddedChatbotContext.Provider value={{
      ...chatData,
      disableFeedback: true,
      isMobile,
      themeBuilder,
    } as any}>
      <div className={cn('bg-background-section-burn', className)}>
        <ChatWrapper />
      </div>
    </EmbeddedChatbotContext.Provider>
  )
}
export default React.memo(TryApp)
