import { useCallback, useEffect, useMemo } from 'react'
import Chat from '../chat'
import type {
  ChatConfig,
  OnSend,
} from '../types'
import { useChat } from '../chat/hooks'
import { useEmbeddedChatbotContext } from './context'
import ConfigPanel from './config-panel'
import { isDify } from './utils'
import cn from '@/utils/classnames'
import {
  fetchSuggestedQuestions,
  getUrl,
  stopChatMessageResponding,
} from '@/service/share'
import LogoAvatar from '@/app/components/base/logo/logo-embeded-chat-avatar'

const ChatWrapper = () => {
  const {
    appData,
    appParams,
    appPrevChatList,
    currentConversationId,
    currentConversationItem,
    inputsForms,
    newConversationInputs,
    handleNewConversationCompleted,
    isMobile,
    isInstalledApp,
    appId,
    appMeta,
    handleFeedback,
    currentChatInstanceRef,
    themeBuilder,
  } = useEmbeddedChatbotContext()
  const appConfig = useMemo(() => {
    const config = appParams || {}

    return {
      ...config,
      supportFeedback: true,
      opening_statement: currentConversationId ? currentConversationItem?.introduction : (config as any).opening_statement,
    } as ChatConfig
  }, [appParams, currentConversationItem?.introduction, currentConversationId])
  const {
    chatList,
    handleSend,
    handleStop,
    isResponding,
    suggestedQuestions,
  } = useChat(
    appConfig,
    {
      inputs: (currentConversationId ? currentConversationItem?.inputs : newConversationInputs) as any,
      promptVariables: inputsForms,
    },
    appPrevChatList,
    taskId => stopChatMessageResponding('', taskId, isInstalledApp, appId),
  )

  useEffect(() => {
    if (currentChatInstanceRef.current)
      currentChatInstanceRef.current.handleStop = handleStop
  }, [])

  const doSend: OnSend = useCallback((message, files) => {
    const data: any = {
      query: message,
      inputs: currentConversationId ? currentConversationItem?.inputs : newConversationInputs,
      conversation_id: currentConversationId,
    }

    if (appConfig?.file_upload?.image.enabled && files?.length)
      data.files = files

    handleSend(
      getUrl('chat-messages', isInstalledApp, appId || ''),
      data,
      {
        onGetSuggestedQuestions: responseItemId => fetchSuggestedQuestions(responseItemId, isInstalledApp, appId),
        onConversationComplete: currentConversationId ? undefined : handleNewConversationCompleted,
        isPublicAPI: !isInstalledApp,
      },
    )
  }, [
    appConfig,
    currentConversationId,
    currentConversationItem,
    handleSend,
    newConversationInputs,
    handleNewConversationCompleted,
    isInstalledApp,
    appId,
  ])
  const chatNode = useMemo(() => {
    if (inputsForms.length) {
      return (
        <>
          {!currentConversationId && (
            <div className={cn('mx-auto w-full max-w-[720px] tablet:px-4', isMobile && 'px-4')}>
              <div className='mb-6' />
              <ConfigPanel />
              <div
                className='my-6 h-[1px]'
                style={{ background: 'linear-gradient(90deg, rgba(242, 244, 247, 0.00) 0%, #F2F4F7 49.17%, rgba(242, 244, 247, 0.00) 100%)' }}
              />
            </div>
          )}
        </>
      )
    }

    return null
  }, [currentConversationId, inputsForms, isMobile])

  return (
    <Chat
      appData={appData}
      config={appConfig}
      chatList={chatList}
      isResponding={isResponding}
      chatContainerInnerClassName={cn('mx-auto w-full max-w-[720px] tablet:px-4', isMobile && 'px-4')}
      chatFooterClassName='pb-4'
      chatFooterInnerClassName={cn('mx-auto w-full max-w-[720px] tablet:px-4', isMobile && 'px-4')}
      onSend={doSend}
      onStopResponding={handleStop}
      chatNode={chatNode}
      allToolIcons={appMeta?.tool_icons || {}}
      onFeedback={handleFeedback}
      suggestedQuestions={suggestedQuestions}
      answerIcon={isDify() ? <LogoAvatar className='relative shrink-0' /> : null}
      hideProcessDetail
      themeBuilder={themeBuilder}
    />
  )
}

export default ChatWrapper
