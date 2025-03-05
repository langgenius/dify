import { useCallback, useEffect, useMemo, useState } from 'react'
import Chat from '../chat'
import type {
  ChatConfig,
  ChatItem,
  ChatItemInTree,
  OnSend,
} from '../types'
import { useChat } from '../chat/hooks'
import { getLastAnswer, isValidGeneratedAnswer } from '../utils'
import { useChatWithHistoryContext } from './context'
import { InputVarType } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import InputsForm from '@/app/components/base/chat/chat-with-history/inputs-form'
import {
  fetchSuggestedQuestions,
  getUrl,
  stopChatMessageResponding,
} from '@/service/share'
import AppIcon from '@/app/components/base/app-icon'
import AnswerIcon from '@/app/components/base/answer-icon'
import cn from '@/utils/classnames'

const ChatWrapper = () => {
  const {
    appParams,
    appPrevChatTree,
    currentConversationId,
    currentConversationItem,
    inputsForms,
    newConversationInputs,
    newConversationInputsRef,
    handleNewConversationCompleted,
    isMobile,
    isInstalledApp,
    appId,
    appMeta,
    handleFeedback,
    currentChatInstanceRef,
    appData,
    themeBuilder,
  } = useChatWithHistoryContext()
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
    chatList,
    setTargetMessageId,
    handleSend,
    handleStop,
    isResponding,
    suggestedQuestions,
  } = useChat(
    appConfig,
    {
      inputs: (currentConversationId ? currentConversationItem?.inputs : newConversationInputs) as any,
      inputsForm: inputsForms,
    },
    appPrevChatTree,
    taskId => stopChatMessageResponding('', taskId, isInstalledApp, appId),
  )
  const inputsFormValue = currentConversationId ? currentConversationItem?.inputs : newConversationInputsRef?.current
  const inputDisabled = useMemo(() => {
    let hasEmptyInput = ''
    let fileIsUploading = false
    const requiredVars = inputsForms.filter(({ required }) => required)
    if (requiredVars.length) {
      requiredVars.forEach(({ variable, label, type }) => {
        if (hasEmptyInput)
          return

        if (fileIsUploading)
          return

        if (!inputsFormValue?.[variable])
          hasEmptyInput = label as string

        if ((type === InputVarType.singleFile || type === InputVarType.multiFiles) && inputsFormValue?.[variable]) {
          const files = inputsFormValue[variable]
          if (Array.isArray(files))
            fileIsUploading = files.find(item => item.transferMethod === TransferMethod.local_file && !item.uploadedId)
          else
            fileIsUploading = files.transferMethod === TransferMethod.local_file && !files.uploadedId
        }
      })
    }
    if (hasEmptyInput)
      return true

    if (fileIsUploading)
      return true
    return false
  }, [inputsFormValue, inputsForms])

  useEffect(() => {
    if (currentChatInstanceRef.current)
      currentChatInstanceRef.current.handleStop = handleStop
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doSend: OnSend = useCallback((message, files, isRegenerate = false, parentAnswer: ChatItem | null = null) => {
    const data: any = {
      query: message,
      files,
      inputs: currentConversationId ? currentConversationItem?.inputs : newConversationInputs,
      conversation_id: currentConversationId,
      parent_message_id: (isRegenerate ? parentAnswer?.id : getLastAnswer(chatList)?.id) || null,
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
    chatList,
    handleNewConversationCompleted,
    handleSend,
    currentConversationId,
    currentConversationItem,
    newConversationInputs,
    isInstalledApp,
    appId,
  ])

  const doRegenerate = useCallback((chatItem: ChatItemInTree) => {
    const question = chatList.find(item => item.id === chatItem.parentMessageId)!
    const parentAnswer = chatList.find(item => item.id === question.parentMessageId)
    doSend(question.content, question.message_files, true, isValidGeneratedAnswer(parentAnswer) ? parentAnswer : null)
  }, [chatList, doSend])

  const messageList = useMemo(() => {
    if (currentConversationId)
      return chatList
    return chatList.filter(item => !item.isOpeningStatement)
  }, [chatList, currentConversationId])

  const [collapsed, setCollapsed] = useState(!!currentConversationId)

  const chatNode = useMemo(() => {
    if (!inputsForms.length)
      return null
    if (isMobile) {
      if (!currentConversationId)
        return <InputsForm collapsed={collapsed} setCollapsed={setCollapsed} />
      return null
    }
    else {
      return <InputsForm collapsed={collapsed} setCollapsed={setCollapsed} />
    }
  }, [inputsForms.length, isMobile, currentConversationId, collapsed])

  const welcome = useMemo(() => {
    const welcomeMessage = chatList.find(item => item.isOpeningStatement)
    if (currentConversationId)
      return null
    if (!welcomeMessage)
      return null
    if (!collapsed && inputsForms.length > 0)
      return null
    return (
      <div className={cn('h-[50vh] py-12 flex flex-col items-center justify-center gap-3')}>
        <AppIcon
          size='xl'
          iconType={appData?.site.icon_type}
          icon={appData?.site.icon}
          background={appData?.site.icon_background}
          imageUrl={appData?.site.icon_url}
        />
        <div className='text-text-tertiary body-2xl-regular'>{welcomeMessage.content}</div>
      </div>
    )
  }, [appData?.site.icon, appData?.site.icon_background, appData?.site.icon_type, appData?.site.icon_url, chatList, collapsed, currentConversationId, inputsForms.length])

  const answerIcon = (appData?.site && appData.site.use_icon_as_answer_icon)
    ? <AnswerIcon
      iconType={appData.site.icon_type}
      icon={appData.site.icon}
      background={appData.site.icon_background}
      imageUrl={appData.site.icon_url}
    />
    : null

  return (
    <div
      className='h-full bg-chatbot-bg overflow-hidden'
    >
      <Chat
        appData={appData}
        config={appConfig}
        chatList={messageList}
        isResponding={isResponding}
        chatContainerInnerClassName={`mx-auto pt-6 w-full max-w-[720px] ${isMobile && 'px-4'}`}
        chatFooterClassName='pb-4'
        chatFooterInnerClassName={`mx-auto w-full max-w-[720px] ${isMobile ? 'px-2' : 'px-4'}`}
        onSend={doSend}
        inputs={currentConversationId ? currentConversationItem?.inputs as any : newConversationInputs}
        inputsForm={inputsForms}
        onRegenerate={doRegenerate}
        onStopResponding={handleStop}
        chatNode={
          <>
            {chatNode}
            {welcome}
          </>
        }
        allToolIcons={appMeta?.tool_icons || {}}
        onFeedback={handleFeedback}
        suggestedQuestions={suggestedQuestions}
        answerIcon={answerIcon}
        hideProcessDetail
        themeBuilder={themeBuilder}
        switchSibling={siblingMessageId => setTargetMessageId(siblingMessageId)}
        inputDisabled={inputDisabled}
        isMobile={isMobile}
      />
    </div>
  )
}

export default ChatWrapper
