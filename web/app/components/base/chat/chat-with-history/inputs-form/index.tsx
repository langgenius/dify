import React from 'react'
import { useTranslation } from 'react-i18next'
import { Message3Fill } from '@/app/components/base/icons/src/public/other'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import InputsFormContent from '@/app/components/base/chat/chat-with-history/inputs-form/content'
import { useChatWithHistoryContext } from '../context'
import cn from '@/utils/classnames'

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
    isMobile,
    currentConversationId,
    handleStartChat,
    themeBuilder,
  } = useChatWithHistoryContext()

  return (
    <div className={cn('pt-6 px-4 flex flex-col items-center', isMobile && 'pt-4')}>
      <div className={cn(
        'w-full max-w-[672px] bg-components-panel-bg rounded-2xl border-[0.5px] border-components-panel-border shadow-md',
        collapsed && 'bg-components-card-bg border border-components-card-border shadow-none',
      )}>
        <div className={cn(
          'flex items-center gap-3 px-6 py-4 rounded-t-2xl',
          !collapsed && 'border-b border-divider-subtle',
          isMobile && 'px-4 py-3',
        )}>
          <Message3Fill className='shrink-0 w-6 h-6' />
          <div className='grow text-text-secondary system-xl-semibold'>{t('share.chat.chatSettingsTitle')}</div>
          {collapsed && (
            <Button className='text-text-tertiary uppercase' size='small' variant='ghost' onClick={() => setCollapsed(false)}>{currentConversationId ? t('common.operation.view') : t('common.operation.edit')}</Button>
          )}
          {!collapsed && currentConversationId && (
            <Button className='text-text-tertiary uppercase' size='small' variant='ghost' onClick={() => setCollapsed(true)}>{t('common.operation.close')}</Button>
          )}
        </div>
        {!collapsed && (
          <div className={cn('p-6', isMobile && 'p-4')}>
            <InputsFormContent showTip={!!currentConversationId} />
          </div>
        )}
        {!collapsed && !currentConversationId && (
          <div className={cn('p-6', isMobile && 'p-4')}>
            <Button
              variant='primary'
              className='w-full'
              onClick={() => handleStartChat(() => setCollapsed(true))}
              style={
                themeBuilder?.theme
                  ? {
                    backgroundColor: themeBuilder?.theme.primaryColor,
                  }
                  : {}
              }
            >{t('share.chat.startChat')}</Button>
          </div>
        )}
      </div>
      {collapsed && (
        <div className='py-4 flex items-center w-full max-w-[720px]'>
          <Divider bgStyle='gradient' className='basis-1/2 h-px rotate-180' />
          <Divider bgStyle='gradient' className='basis-1/2 h-px' />
        </div>
      )}
    </div>
  )
}

export default InputsFormNode
