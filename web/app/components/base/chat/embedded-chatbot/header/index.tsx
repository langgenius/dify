import type { FC } from 'react'
import type { Theme } from '../theme/theme-context'
import { RiCollapseDiagonal2Line, RiExpandDiagonal2Line, RiResetLeftLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import ViewFormDropdown from '@/app/components/base/chat/embedded-chatbot/inputs-form/view-form-dropdown'
import Divider from '@/app/components/base/divider'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import Tooltip from '@/app/components/base/tooltip'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { cn } from '@/utils/classnames'
import { isClient } from '@/utils/client'
import {
  useEmbeddedChatbotContext,
} from '../context'
import { CssTransform } from '../theme/utils'

export type IHeaderProps = {
  isMobile?: boolean
  allowResetChat?: boolean
  customerIcon?: React.ReactNode
  title: string
  theme?: Theme
  onCreateNewChat?: () => void
}
const Header: FC<IHeaderProps> = ({
  isMobile,
  allowResetChat,
  customerIcon,
  title,
  theme,
  onCreateNewChat,
}) => {
  const { t } = useTranslation()
  const {
    appData,
    currentConversationId,
    inputsForms,
    allInputsHidden,
  } = useEmbeddedChatbotContext()

  const isIframe = isClient ? window.self !== window.top : false
  const [parentOrigin, setParentOrigin] = useState('')
  const [showToggleExpandButton, setShowToggleExpandButton] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)

  const handleMessageReceived = useCallback((event: MessageEvent) => {
    let currentParentOrigin = parentOrigin
    if (!currentParentOrigin && event.data.type === 'dify-chatbot-config') {
      currentParentOrigin = event.origin
      setParentOrigin(event.origin)
    }
    if (event.origin !== currentParentOrigin)
      return
    if (event.data.type === 'dify-chatbot-config')
      setShowToggleExpandButton(event.data.payload.isToggledByButton && !event.data.payload.isDraggable)
  }, [parentOrigin])

  useEffect(() => {
    if (!isIframe)
      return

    const listener = (event: MessageEvent) => handleMessageReceived(event)
    window.addEventListener('message', listener)

    // Security: Use document.referrer to get parent origin
    const targetOrigin = document.referrer ? new URL(document.referrer).origin : '*'
    window.parent.postMessage({ type: 'dify-chatbot-iframe-ready' }, targetOrigin)

    return () => window.removeEventListener('message', listener)
  }, [isIframe, handleMessageReceived])

  const handleToggleExpand = useCallback(() => {
    if (!isIframe || !showToggleExpandButton)
      return
    setExpanded(!expanded)
    window.parent.postMessage({
      type: 'dify-chatbot-expand-change',
    }, parentOrigin)
  }, [isIframe, parentOrigin, showToggleExpandButton, expanded])

  if (!isMobile) {
    return (
      <div className="flex h-14 shrink-0 items-center justify-end p-3">
        <div className="flex items-center gap-1">
          {/* powered by */}
          <div className="shrink-0">
            {!appData?.custom_config?.remove_webapp_brand && (
              <div className={cn(
                'flex shrink-0 items-center gap-1.5 px-2',
              )}
              >
                <div className="system-2xs-medium-uppercase text-text-tertiary">{t('chat.poweredBy', { ns: 'share' })}</div>
                {
                  systemFeatures.branding.enabled && systemFeatures.branding.workspace_logo
                    ? <img src={systemFeatures.branding.workspace_logo} alt="logo" className="block h-5 w-auto" />
                    : appData?.custom_config?.replace_webapp_logo
                      ? <img src={`${appData?.custom_config?.replace_webapp_logo}`} alt="logo" className="block h-5 w-auto" />
                      : <DifyLogo size="small" />
                }
              </div>
            )}
          </div>
          {currentConversationId && (
            <Divider type="vertical" className="h-3.5" />
          )}
          {
            showToggleExpandButton && (
              <Tooltip
                popupContent={expanded ? t('chat.collapse', { ns: 'share' }) : t('chat.expand', { ns: 'share' })}
              >
                <ActionButton size="l" onClick={handleToggleExpand}>
                  {
                    expanded
                      ? <RiCollapseDiagonal2Line className="h-[18px] w-[18px]" />
                      : <RiExpandDiagonal2Line className="h-[18px] w-[18px]" />
                  }
                </ActionButton>
              </Tooltip>
            )
          }
          {currentConversationId && allowResetChat && (
            <Tooltip
              popupContent={t('chat.resetChat', { ns: 'share' })}
            >
              <ActionButton size="l" onClick={onCreateNewChat}>
                <RiResetLeftLine className="h-[18px] w-[18px]" />
              </ActionButton>
            </Tooltip>
          )}
          {currentConversationId && inputsForms.length > 0 && !allInputsHidden && (
            <ViewFormDropdown />
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn('flex h-14 shrink-0 items-center justify-between rounded-t-2xl px-3')}
      style={CssTransform(theme?.headerBorderBottomStyle ?? '')}
    >
      <div className="flex grow items-center space-x-3">
        {customerIcon}
        <div
          className="system-md-semibold truncate"
          style={CssTransform(theme?.colorFontOnHeaderStyle ?? '')}
        >
          {title}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {
          showToggleExpandButton && (
            <Tooltip
              popupContent={expanded ? t('chat.collapse', { ns: 'share' }) : t('chat.expand', { ns: 'share' })}
            >
              <ActionButton size="l" onClick={handleToggleExpand}>
                {
                  expanded
                    ? <RiCollapseDiagonal2Line className={cn('h-[18px] w-[18px]', theme?.colorPathOnHeader)} />
                    : <RiExpandDiagonal2Line className={cn('h-[18px] w-[18px]', theme?.colorPathOnHeader)} />
                }
              </ActionButton>
            </Tooltip>
          )
        }
        {currentConversationId && allowResetChat && (
          <Tooltip
            popupContent={t('chat.resetChat', { ns: 'share' })}
          >
            <ActionButton size="l" onClick={onCreateNewChat}>
              <RiResetLeftLine className={cn('h-[18px] w-[18px]', theme?.colorPathOnHeader)} />
            </ActionButton>
          </Tooltip>
        )}
        {currentConversationId && inputsForms.length > 0 && !allInputsHidden && (
          <ViewFormDropdown iconColor={theme?.colorPathOnHeader} />
        )}
      </div>
    </div>
  )
}

export default React.memo(Header)
