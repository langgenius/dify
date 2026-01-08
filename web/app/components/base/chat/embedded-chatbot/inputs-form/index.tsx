import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import InputsFormContent from '@/app/components/base/chat/embedded-chatbot/inputs-form/content'
import Divider from '@/app/components/base/divider'
import { Message3Fill } from '@/app/components/base/icons/src/public/other'
import { AppSourceType } from '@/service/share'
import { cn } from '@/utils/classnames'
import { useEmbeddedChatbotContext } from '../context'

type Props = {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
}

const InputsFormNode = ({
  collapsed,
  setCollapsed,
}: Props) => {
  const { t } = useTranslation()
  const {
    appSourceType,
    isMobile,
    currentConversationId,
    themeBuilder,
    handleStartChat,
    allInputsHidden,
    inputsForms,
  } = useEmbeddedChatbotContext()
  const isTryApp = appSourceType === AppSourceType.tryApp

  if (allInputsHidden || inputsForms.length === 0)
    return null

  return (
    <div className={cn('mb-6 flex flex-col items-center px-4 pt-6', isMobile && 'mb-4 pt-4', isTryApp && 'mb-0 px-0')}>
      <div className={cn(
        'w-full max-w-[672px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-md',
        collapsed && 'border border-components-card-border bg-components-card-bg shadow-none',
        isTryApp && 'max-w-[auto]',
      )}
      >
        <div className={cn(
          'flex items-center gap-3 rounded-t-2xl px-6 py-4',
          !collapsed && 'border-b border-divider-subtle',
          isMobile && 'px-4 py-3',
        )}
        >
          <Message3Fill className="h-6 w-6 shrink-0" />
          <div className="system-xl-semibold grow text-text-secondary">{t('chat.chatSettingsTitle', { ns: 'share' })}</div>
          {collapsed && (
            <Button className="uppercase text-text-tertiary" size="small" variant="ghost" onClick={() => setCollapsed(false)}>{t('operation.edit', { ns: 'common' })}</Button>
          )}
          {!collapsed && currentConversationId && (
            <Button className="uppercase text-text-tertiary" size="small" variant="ghost" onClick={() => setCollapsed(true)}>{t('operation.close', { ns: 'common' })}</Button>
          )}
        </div>
        {!collapsed && (
          <div className={cn('p-6', isMobile && 'p-4')}>
            <InputsFormContent />
          </div>
        )}
        {!collapsed && !currentConversationId && (
          <div className={cn('p-6', isMobile && 'p-4')}>
            <Button
              variant="primary"
              className="w-full"
              onClick={() => handleStartChat(() => setCollapsed(true))}
              style={
                themeBuilder?.theme
                  ? {
                      backgroundColor: themeBuilder?.theme.primaryColor,
                    }
                  : {}
              }
            >
              {t('chat.startChat', { ns: 'share' })}
            </Button>
          </div>
        )}
      </div>
      {collapsed && (
        <div className="flex w-full max-w-[720px] items-center py-4">
          <Divider bgStyle="gradient" className="h-px basis-1/2 rotate-180" />
          <Divider bgStyle="gradient" className="h-px basis-1/2" />
        </div>
      )}
    </div>
  )
}

export default InputsFormNode
