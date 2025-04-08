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
import { useEmbeddedChatbotContext } from './context'
import { isDify } from './utils'
import { InputVarType } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import InputsForm from '@/app/components/base/chat/embedded-chatbot/inputs-form'
import {
  fetchSuggestedQuestions,
  getUrl,
  stopChatMessageResponding,
} from '@/service/share'
import AppIcon from '@/app/components/base/app-icon'
import LogoAvatar from '@/app/components/base/logo/logo-embedded-chat-avatar'
import AnswerIcon from '@/app/components/base/answer-icon'
import SuggestedQuestions from '@/app/components/base/chat/chat/answer/suggested-questions'
import { Markdown } from '@/app/components/base/markdown'
import cn from '@/utils/classnames'

const ChatWrapper = () => {
  const {
    appData,
    appParams,
    appPrevChatList,
    currentConversationId,
    currentConversationItem,
    currentConversationInputs,
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
    themeBuilder,
    clearChatList,
    setClearChatList,
    setIsResponding,
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
    chatList,
    setTargetMessageId,
    handleSend,
    handleStop,
    isResponding: respondingState,
    suggestedQuestions,
  } = useChat(
    appConfig,
    {
      inputs: (currentConversationId ? currentConversationInputs : newConversationInputs) as any,
      inputsForm: inputsForms,
    },
    appPrevChatList,
    taskId => stopChatMessageResponding('', taskId, isInstalledApp, appId),
    clearChatList,
    setClearChatList,
  )
  const inputsFormValue = currentConversationId ? currentConversationInputs : newConversationInputsRef?.current
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
  }, [currentChatInstanceRef, handleStop])
  useEffect(() => {
    setIsResponding(respondingState)
  }, [respondingState, setIsResponding])

  const doSend: OnSend = useCallback((message, files, isRegenerate = false, parentAnswer: ChatItem | null = null) => {
    const data: any = {
      query: message,
      files,
      inputs: currentConversationId ? currentConversationInputs : newConversationInputs,
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
      return <div className='mb-4'></div>
    }
    else {
      return <InputsForm collapsed={collapsed} setCollapsed={setCollapsed} />
    }
  }, [inputsForms.length, isMobile, currentConversationId, collapsed])

  const welcome = useMemo(() => {
    const welcomeMessage = chatList.find(item => item.isOpeningStatement)
    if (respondingState)
      return null
    if (currentConversationId)
      return null
    if (!welcomeMessage)
      return null
    if (!collapsed && inputsForms.length > 0)
      return null
    if (welcomeMessage.suggestedQuestions && welcomeMessage.suggestedQuestions?.length > 0) {
      return (
        <div className='flex h-[50vh] items-center justify-center px-4 py-12'>
          <div className='flex max-w-[720px] grow gap-4'>
            <AppIcon
              size='xl'
              iconType={appData?.site.icon_type}
              icon={appData?.site.icon}
              background={appData?.site.icon_background}
              imageUrl={appData?.site.icon_url}
            />
            <div className='body-lg-regular grow rounded-2xl bg-chat-bubble-bg px-4 py-3 text-text-primary'>
              <Markdown content={welcomeMessage.content} />
              <SuggestedQuestions item={welcomeMessage} />
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className={cn('flex h-[50vh] flex-col items-center justify-center gap-3 py-12')}>
        <AppIcon
          size='xl'
          iconType={appData?.site.icon_type}
          icon={appData?.site.icon}
          background={appData?.site.icon_background}
          imageUrl={appData?.site.icon_url}
        />
        <div className='max-w-[768px] px-4'>
          <Markdown className='!body-2xl-regular !text-text-tertiary' content={welcomeMessage.content} />
        </div>
      </div>
    )
  }, [appData?.site.icon, appData?.site.icon_background, appData?.site.icon_type, appData?.site.icon_url, chatList, collapsed, currentConversationId, inputsForms.length, respondingState])

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
      chatList={messageList}
      isResponding={respondingState}
      chatContainerInnerClassName={cn('mx-auto w-full max-w-full pt-4 tablet:px-4', isMobile && 'px-4')}
      chatFooterClassName={cn('pb-4', !isMobile && 'rounded-b-2xl')}
      chatFooterInnerClassName={cn('mx-auto w-full max-w-full px-4', isMobile && 'px-2')}
      onSend={doSend}
      inputs={currentConversationId ? currentConversationInputs as any : newConversationInputs}
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
  )
}

export default ChatWrapper
