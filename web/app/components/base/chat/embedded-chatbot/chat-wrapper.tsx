import { useCallback, useEffect, useMemo } from 'react'
import Chat from '../chat'
import type {
  ChatConfig,
  ChatItem,
  OnSend,
} from '../types'
import { useChat } from '../chat/hooks'
import { getLastAnswer } from '../utils'
import { useEmbeddedChatbotContext } from './context'
import ConfigPanel from './config-panel'
import { isDify } from './utils'
import cn from '@/utils/classnames'
import {
  fetchSuggestedQuestions,
  getUrl,
  stopChatMessageResponding,
} from '@/service/share'
import LogoAvatar from '@/app/components/base/logo/logo-embedded-chat-avatar'
import AnswerIcon from '@/app/components/base/answer-icon'

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
      file_upload: {
        ...(config as any).file_upload,
        fileUploadConfig: (config as any).system_parameters,
      },
      supportFeedback: true,
      opening_statement: currentConversationId ? currentConversationItem?.introduction : (config as any).opening_statement,
    } as ChatConfig
  }, [appParams, currentConversationItem?.introduction, currentConversationId])
  const {
    chatListRef,
    chatList,
    handleSend,
    handleStop,
    isResponding,
    suggestedQuestions,
    handleUpdateChatList,
  } = useChat(
    appConfig,
    {
      inputs: (currentConversationId ? currentConversationItem?.inputs : newConversationInputs) as any,
      inputsForm: inputsForms,
    },
    appPrevChatList,
    taskId => stopChatMessageResponding('', taskId, isInstalledApp, appId),
  )

  useEffect(() => {
    if (currentChatInstanceRef.current)
      currentChatInstanceRef.current.handleStop = handleStop
  }, [])

  const doSend: OnSend = useCallback((message, files, last_answer) => {
    const data: any = {
      query: message,
      files,
      inputs: currentConversationId ? currentConversationItem?.inputs : newConversationInputs,
      conversation_id: currentConversationId,
      parent_message_id: last_answer?.id || getLastAnswer(chatListRef.current)?.id || null,
    }

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
    chatListRef,
    appConfig,
    currentConversationId,
    currentConversationItem,
    handleSend,
    newConversationInputs,
    handleNewConversationCompleted,
    isInstalledApp,
    appId,
  ])

  const doRegenerate = useCallback((chatItem: ChatItem) => {
    const index = chatList.findIndex(item => item.id === chatItem.id)
    if (index === -1)
      return

    const prevMessages = chatList.slice(0, index)
    const question = prevMessages.pop()
    const lastAnswer = getLastAnswer(prevMessages)

    if (!question)
      return

    handleUpdateChatList(prevMessages)
    doSend(question.content, question.message_files, lastAnswer)
  }, [chatList, handleUpdateChatList, doSend])

  const chatNode = useMemo(() => {
    if (inputsForms.length) {
      return (
        <>
          {!currentConversationId && (
            <div className={cn('mx-auto w-full max-w-full tablet:px-4', isMobile && 'px-4')}>
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

  const answerIcon = isDify()
    ? <LogoAvatar className='relative shrink-0' />
    : (appData?.site && appData.site.use_icon_as_answer_icon)
      ? <AnswerIcon
        iconType={appData.site.icon_type}
        icon={appData.site.icon}
        background={appData.site.icon_background}
        imageUrl={appData.site.icon_url}
      />
      : null

  return (
    <Chat
      appData={appData}
      config={appConfig}
      chatList={chatList}
      isResponding={isResponding}
      chatContainerInnerClassName={cn('mx-auto w-full max-w-full tablet:px-4', isMobile && 'px-4')}
      chatFooterClassName='pb-4'
      chatFooterInnerClassName={cn('mx-auto w-full max-w-full tablet:px-4', isMobile && 'px-4')}
      onSend={doSend}
      inputs={currentConversationId ? currentConversationItem?.inputs as any : newConversationInputs}
      inputsForm={inputsForms}
      onRegenerate={doRegenerate}
      onStopResponding={handleStop}
      chatNode={chatNode}
      allToolIcons={appMeta?.tool_icons || {}}
      onFeedback={handleFeedback}
      suggestedQuestions={suggestedQuestions}
      answerIcon={answerIcon}
      hideProcessDetail
      themeBuilder={themeBuilder}
    />
  )
}

export default ChatWrapper
