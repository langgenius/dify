import { useCallback, useMemo } from 'react'
import Chat from '../chat'
import type { OnSend } from '../types'
import { useChat } from '../chat/hooks'
import { useChatWithHistoryContext } from './context'
import Header from './header'
import ConfigPanel from './config-panel'
import {
  fetchSuggestedQuestions,
  getUrl,
} from '@/service/share'

const ChatWrapper = () => {
  const {
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
  } = useChatWithHistoryContext()
  const {
    chatList,
    handleSend,
    handleStop,
    isResponsing,
  } = useChat(
    appParams,
    undefined,
    appPrevChatList,
  )

  const doSend: OnSend = useCallback((message, files) => {
    const data: any = {
      query: message,
      inputs: currentConversationId ? currentConversationItem?.inputs : newConversationInputs,
      conversation_id: currentConversationId,
    }

    if (appParams?.file_upload?.image.enabled && files?.length)
      data.files = files

    handleSend(
      getUrl('chat-messages', isInstalledApp, appId || ''),
      data,
      {
        onGetSuggestedQuestions: responseItemId => fetchSuggestedQuestions(responseItemId, isInstalledApp, appId),
        onConversationComplete: currentConversationId ? undefined : handleNewConversationCompleted,
      },
    )
  }, [
    appParams,
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
          <Header
            isMobile={isMobile}
            title={currentConversationItem?.name || ''}
          />
          {
            !currentConversationId && (
              <div className={`mx-auto w-full max-w-[720px] ${isMobile && 'px-4'}`}>
                <div className='mb-6' />
                <ConfigPanel />
                <div
                  className='my-6 h-[1px]'
                  style={{ background: 'linear-gradient(90deg, rgba(242, 244, 247, 0.00) 0%, #F2F4F7 49.17%, rgba(242, 244, 247, 0.00) 100%)' }}
                />
              </div>
            )
          }
        </>
      )
    }

    return (
      <Header
        isMobile={isMobile}
        title={currentConversationItem?.name || ''}
      />
    )
  }, [
    currentConversationId,
    inputsForms,
    currentConversationItem,
    isMobile,
  ])

  return (
    <Chat
      chatList={chatList}
      isResponsing={isResponsing}
      chatContainerInnerClassName={`mx-auto pt-6 w-full max-w-[720px] ${isMobile && 'px-4'}`}
      chatFooterClassName='pb-4'
      chatFooterInnerClassName={`mx-auto w-full max-w-[720px] ${isMobile && 'px-4'}`}
      onSend={doSend}
      onStopResponding={handleStop}
      chatNode={chatNode}
    />
  )
}

export default ChatWrapper
