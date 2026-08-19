'use client'
import type { FC } from 'react'
import type { EmbeddedChatbotContextValue } from '@/app/components/base/chat/embedded-chatbot/context'
import type { TryAppInfo } from '@/service/try-app'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { RiResetLeftLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@/app/components/base/alert'
import AppIcon from '@/app/components/base/app-icon'
import ChatWrapper from '@/app/components/base/chat/embedded-chatbot/chat-wrapper'
import { EmbeddedChatbotContext } from '@/app/components/base/chat/embedded-chatbot/context'
import { useEmbeddedChatbot } from '@/app/components/base/chat/embedded-chatbot/hooks'
import ViewFormDropdown from '@/app/components/base/chat/embedded-chatbot/inputs-form/view-form-dropdown'
import { createTheme } from '@/app/components/base/chat/embedded-chatbot/theme/theme'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { AppSourceType } from '@/service/share'

type Props = Readonly<{
  appId: string
  appDetail: TryAppInfo
  className: string
}>

const TryApp: FC<Props> = ({ appId, appDetail, className }) => {
  const { t } = useTranslation()
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const { removeConversationIdInfo, ...chatData } = useEmbeddedChatbot(AppSourceType.tryApp, appId)
  const theme = createTheme(
    chatData.appData?.site?.chat_color_theme ?? null,
    chatData.appData?.site?.chat_color_theme_inverted ?? false,
  )
  const currentConversationId = chatData.currentConversationId
  const inputsForms = chatData.inputsForms
  useEffect(() => {
    if (appId) removeConversationIdInfo(appId)
  }, [appId])
  const [isHideTryNotice, { setTrue: hideTryNotice }] = useBoolean(false)

  const handleNewConversation = () => {
    removeConversationIdInfo(appId)
    chatData.handleNewConversation()
  }
  return (
    <EmbeddedChatbotContext.Provider
      value={
        {
          ...chatData,
          disableFeedback: true,
          isMobile,
          theme,
        } as EmbeddedChatbotContextValue
      }
    >
      <div className={cn('flex h-full flex-col rounded-2xl bg-background-section-burn', className)}>
        <div className="flex shrink-0 justify-between p-3">
          <div className="flex grow items-center space-x-2">
            <AppIcon
              size="large"
              iconType={appDetail.site.icon_type}
              icon={appDetail.site.icon ?? undefined}
              background={appDetail.site.icon_background ?? undefined}
              imageUrl={appDetail.site.icon_url ?? undefined}
            />
            <div
              className="grow truncate system-md-semibold text-text-primary"
              title={appDetail.name}
            >
              {appDetail.name}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {currentConversationId && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <IconButton
                      size="lg"
                      aria-label={t(($) => $['chat.resetChat'], { ns: 'share' })}
                      onClick={handleNewConversation}
                    >
                      <RiResetLeftLine className="h-4.5 w-4.5" aria-hidden="true" />
                    </IconButton>
                  }
                />
                <TooltipContent>{t(($) => $['chat.resetChat'], { ns: 'share' })}</TooltipContent>
              </Tooltip>
            )}
            {currentConversationId && inputsForms.length > 0 && <ViewFormDropdown />}
          </div>
        </div>
        <div className="mx-auto mt-4 flex h-0 w-192.25 grow flex-col">
          {!isHideTryNotice && (
            <Alert
              className="mb-4 shrink-0"
              message={t(($) => $['tryApp.tryInfo'], { ns: 'explore' })}
              onHide={hideTryNotice}
            />
          )}
          <ChatWrapper />
        </div>
      </div>
    </EmbeddedChatbotContext.Provider>
  )
}
export default React.memo(TryApp)
