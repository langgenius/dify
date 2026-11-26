import type { FileEntity } from '../../file-uploader/types'
import type { SpeechToTextTarget } from '../../voice-input/types'
import type { HumanInputFormSubmitData } from '../chat/answer/human-input-content/type'
import type { ChatConfig, ChatItem, ChatItemInTree } from '../types'
import type { AgentChatCutInSend, AgentChatCutInTransport } from '../use-agent-chat-cut-in'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { RiArrowDownSLine, RiArrowUpSLine } from '@remixicon/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackWebAppEvent } from '@/app/components/base/amplitude/web-app-event'
import AnswerIcon from '@/app/components/base/answer-icon'
import AppIcon from '@/app/components/base/app-icon'
import InputsForm from '@/app/components/base/chat/chat-with-history/inputs-form'
import SuggestedQuestions from '@/app/components/base/chat/chat/answer/suggested-questions'
import { useAgentChatCutIn } from '@/app/components/base/chat/use-agent-chat-cut-in'
import { Markdown } from '@/app/components/base/markdown'
import { InputVarType } from '@/app/components/workflow/types'
import { prepareHumanInputFormSubmission } from '@/service/human-input-submission'
import {
  AppSourceType,
  chatMessagesSender,
  enqueueWebAgentChatInput,
  fetchChatList,
  fetchSuggestedQuestions,
  interruptWebAgentChatInput,
  stopChatMessageResponding,
  submitHumanInputForm,
} from '@/service/share'
import { submitHumanInputForm as submitHumanInputFormService } from '@/service/workflow'
import { TransferMethod } from '@/types/app'
import { getAvatarInitial } from '@/utils/avatar'
import Chat from '../chat'
import { useChat } from '../chat/hooks'
import { getLastAnswer, isValidGeneratedAnswer } from '../utils'
import { useChatWithHistoryContext } from './context'

// Web App transport for the shared cut-in hook: failures resolve to a
// retryable `null`/`false` so the caller keeps the draft or the replay item.
const webAgentCutInTransport: AgentChatCutInTransport = {
  interrupt: async (taskId, inputId, text) => {
    try {
      return await interruptWebAgentChatInput(taskId, inputId, text)
    } catch {
      return null
    }
  },
  enqueue: async (taskId, inputId, text) => {
    try {
      await enqueueWebAgentChatInput(taskId, inputId, text)
      return true
    } catch {
      return false
    }
  },
}

const ChatWrapper = () => {
  const { t } = useTranslation(['share', 'agentV2'])
  const {
    appParams,
    appPrevChatTree,
    currentConversationId,
    currentConversationItem,
    currentConversationInputs,
    inputsForms,
    newConversationInputs,
    newConversationInputsRef,
    handleNewConversationCompleted,
    isBelowSm,
    isInstalledApp,
    appId,
    appMeta,
    handleFeedback,
    currentChatInstanceRef,
    appData,
    theme,
    sidebarCollapseState,
    clearChatList,
    setClearChatList,
    setIsResponding,
    allInputsHidden,
    initUserVariables,
    isNewAgent,
    renderAgentContent,
    chatShouldReloadKey,
  } = useChatWithHistoryContext()

  const appSourceType = isInstalledApp ? AppSourceType.installedApp : AppSourceType.webApp
  const timezone =
    appSourceType === AppSourceType.webApp
      ? new Intl.DateTimeFormat().resolvedOptions().timeZone
      : undefined

  // Semantic variable for better code readability
  const isHistoryConversation = !!currentConversationId

  const appConfig = useMemo(() => {
    const config = appParams || {}

    return {
      ...config,
      file_upload: {
        ...(config as any).file_upload,
        fileUploadConfig: (config as any).system_parameters,
      },
      supportFeedback: true,
      opening_statement: currentConversationItem?.introduction || (config as any).opening_statement,
    } as ChatConfig
  }, [appParams, currentConversationItem?.introduction])
  const {
    chatList,
    handleSend,
    handleStop,
    handleSwitchSibling,
    prepareHumanInputSubmission,
    isResponding: respondingState,
    suggestedQuestions,
    settleAgentHandoff,
  } = useChat(
    appConfig,
    {
      inputs: (currentConversationId ? currentConversationInputs : newConversationInputs) as any,
      inputsForm: inputsForms,
    },
    appPrevChatTree,
    (taskId) => stopChatMessageResponding('', taskId, appSourceType, appId),
    clearChatList,
    setClearChatList,
    undefined,
    { isNewAgent, timezone },
  )
  const inputsFormValue = currentConversationId
    ? currentConversationInputs
    : newConversationInputsRef?.current
  const inputDisabled = useMemo(() => {
    if (allInputsHidden) return false

    let hasEmptyInput = ''
    let fileIsUploading = false
    const requiredVars = inputsForms.filter(
      ({ required, type }) => required && type !== InputVarType.checkbox,
    )
    if (requiredVars.length) {
      requiredVars.forEach(({ variable, label, type }) => {
        if (hasEmptyInput) return

        if (fileIsUploading) return

        const inputValue = inputsFormValue?.[variable]
        if (
          inputValue === undefined ||
          inputValue === null ||
          inputValue === '' ||
          (Array.isArray(inputValue) && inputValue.length === 0)
        )
          hasEmptyInput = label as string

        if (
          (type === InputVarType.singleFile || type === InputVarType.multiFiles) &&
          inputsFormValue?.[variable]
        ) {
          const files = inputsFormValue[variable]
          if (Array.isArray(files))
            fileIsUploading = files.find(
              (item) => item.transferMethod === TransferMethod.local_file && !item.uploadedId,
            )
          else
            fileIsUploading =
              files.transferMethod === TransferMethod.local_file && !files.uploadedId
        }
      })
    }
    if (hasEmptyInput) return true

    if (fileIsUploading) return true

    if (
      chatList.some(
        (item) =>
          item.isAnswer && item.humanInputFormDataList && item.humanInputFormDataList.length > 0,
      )
    )
      return true
    return false
  }, [allInputsHidden, inputsForms, chatList, inputsFormValue])

  useEffect(() => {
    if (currentChatInstanceRef.current) currentChatInstanceRef.current.handleStop = handleStop
  }, [currentChatInstanceRef, handleStop])

  useEffect(() => {
    setIsResponding(respondingState)
  }, [respondingState, setIsResponding])

  // Resume paused workflows when chat history is loaded
  useEffect(() => {
    if (!appPrevChatTree || appPrevChatTree.length === 0) return

    // Find the last answer item with workflow_run_id that needs resumption (DFS - find deepest first)
    let lastPausedNode: ChatItemInTree | undefined
    const findLastPausedWorkflow = (nodes: ChatItemInTree[]) => {
      nodes.forEach((node) => {
        // Track the last node with humanInputFormDataList
        if (
          node.isAnswer &&
          node.workflow_run_id &&
          node.humanInputFormDataList &&
          node.humanInputFormDataList.length > 0
        )
          lastPausedNode = node

        // A paused descendant supersedes its ancestor.
        if (node.children && node.children.length > 0) findLastPausedWorkflow(node.children)
      })
    }

    findLastPausedWorkflow(appPrevChatTree)

    // Only resume the last paused workflow
    if (lastPausedNode) {
      handleSwitchSibling(lastPausedNode.id, {
        onGetSuggestedQuestions: (responseItemId) =>
          fetchSuggestedQuestions(responseItemId, appSourceType, appId),
        onConversationComplete: currentConversationId ? undefined : handleNewConversationCompleted,
        isPublicAPI: appSourceType === AppSourceType.webApp,
      })
    }
  }, [])

  const [hasSent, setHasSent] = useState(false)
  const [prevConversationId, setPrevConversationId] = useState(currentConversationId)
  if (prevConversationId !== currentConversationId) {
    setPrevConversationId(currentConversationId)
    if (!currentConversationId) setHasSent(false)
  }

  // Published roster Agent Web Apps admit steering: while the scoped run is
  // live, a normal Send of plain text cuts in instead of queueing a second
  // turn. `enabled` stays false for installed/trial surfaces so their sends
  // pass through unchanged.
  const webSteeringEnabled = isNewAgent === true && appSourceType === AppSourceType.webApp

  const sendTurn: AgentChatCutInSend = useCallback(
    async (message, files, isRegenerate = false, parentAnswer = null, onReady) => {
      if (!currentConversationId) setHasSent(true)
      const data: any = {
        query: message,
        files,
        inputs: currentConversationId ? currentConversationInputs : newConversationInputs,
        // Blank must not land in the body: `useChat` already carries the
        // conversation id assigned by the live run's queue-ready frame, so a
        // cut-in replacement turn before the completion callback stays in the
        // same conversation instead of opening a new one.
        ...(currentConversationId ? { conversation_id: currentConversationId } : {}),
        parent_message_id: (isRegenerate ? parentAnswer?.id : getLastAnswer(chatList)?.id) || null,
      }

      const result = await handleSend(chatMessagesSender(appSourceType, appId || ''), data, {
        onGetConversationMessages: isNewAgent
          ? (conversationId) => fetchChatList(conversationId, appSourceType, appId)
          : undefined,
        onGetSuggestedQuestions: (responseItemId) =>
          fetchSuggestedQuestions(responseItemId, appSourceType, appId),
        onConversationComplete: isHistoryConversation ? undefined : handleNewConversationCompleted,
        onAgentQueueReady: webSteeringEnabled ? (taskId) => onReady?.(taskId) : undefined,
        isPublicAPI: appSourceType === AppSourceType.webApp,
      })
      const appMode = isNewAgent ? 'agent-v2' : appData?.mode
      if (appSourceType === AppSourceType.webApp && appMode)
        trackWebAppEvent('webapp_run', { app_mode: appMode })
      return result
    },
    [
      currentConversationId,
      currentConversationInputs,
      newConversationInputs,
      chatList,
      handleSend,
      appSourceType,
      appId,
      isHistoryConversation,
      handleNewConversationCompleted,
      isNewAgent,
      appData?.mode,
      webSteeringEnabled,
    ],
  )

  // Scoped to this visitor + app + mount so a stale frame or a different
  // surface can never steer this conversation; the scope survives the first
  // conversation id assignment on purpose.
  const cutInScopeKey = `${appId ?? ''}:${appData?.end_user_id ?? ''}:${chatShouldReloadKey}`
  const settleWebHandoff = useCallback(
    (taskId: string) => settleAgentHandoff(taskId),
    [settleAgentHandoff],
  )
  const {
    onReady: _onCutInReady,
    canSteer: cutInCanSteer,
    sendFailed: cutInSendFailed,
    send: cutInSend,
  } = useAgentChatCutIn({
    enabled: webSteeringEnabled,
    scopeKey: cutInScopeKey,
    isResponding: respondingState,
    transport: webAgentCutInTransport,
    settle: settleWebHandoff,
    send: sendTurn,
  })

  const doRegenerate = useCallback(
    (chatItem: ChatItem, editedQuestion?: { message: string; files?: FileEntity[] }) => {
      const question = editedQuestion
        ? chatItem
        : chatList.find((item) => item.id === chatItem.parentMessageId)!
      const parentAnswer = chatList.find((item) => item.id === question.parentMessageId)
      void cutInSend(
        editedQuestion ? editedQuestion.message : question.content,
        editedQuestion ? editedQuestion.files : question.message_files,
        true,
        isValidGeneratedAnswer(parentAnswer) ? parentAnswer : null,
      )
    },
    [chatList, cutInSend],
  )

  const doSwitchSibling = useCallback(
    (siblingMessageId: string) => {
      handleSwitchSibling(siblingMessageId, {
        onGetSuggestedQuestions: (responseItemId) =>
          fetchSuggestedQuestions(responseItemId, appSourceType, appId),
        onConversationComplete: currentConversationId ? undefined : handleNewConversationCompleted,
        isPublicAPI: appSourceType === AppSourceType.webApp,
      })
    },
    [
      handleSwitchSibling,
      currentConversationId,
      handleNewConversationCompleted,
      appSourceType,
      appId,
    ],
  )

  const messageList = useMemo(() => {
    if (currentConversationId || chatList.length > 1) return chatList
    // Without messages we are in the welcome screen, so hide the opening statement from chatlist
    return chatList.filter((item) => !item.isOpeningStatement)
  }, [chatList, currentConversationId])

  const handleSubmitHumanInputForm = useCallback(
    async (formToken: string, formData: HumanInputFormSubmitData) => {
      const { form_version: formVersion, ...submission } = formData
      await prepareHumanInputFormSubmission(prepareHumanInputSubmission)
      if (isInstalledApp) await submitHumanInputFormService(formToken, submission, formVersion)
      else await submitHumanInputForm(formToken, submission, formVersion)
    },
    [isInstalledApp, prepareHumanInputSubmission],
  )

  const [collapsed, setCollapsed] = useState(!!currentConversationId)
  const [descExpanded, setDescExpanded] = useState(false)

  const description = appData?.site.description
  const [showDescToggle, setShowDescToggle] = useState(false)
  const handleDescRef = useCallback((node: HTMLDivElement | null) => {
    setShowDescToggle(!!node && node.scrollHeight > node.clientHeight)
  }, [])

  const descriptionNode = useMemo(() => {
    if (!description || currentConversationId || hasSent) return null
    return (
      <div className={cn('flex flex-col items-center px-4 pt-6', isBelowSm && 'pt-4')}>
        <div className="w-full max-w-2xl rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-md">
          <div className={cn('p-6', isBelowSm && 'p-4')}>
            <div
              ref={handleDescRef}
              className={cn(
                'relative system-xs-regular wrap-break-word whitespace-pre-wrap text-text-tertiary',
                !descExpanded && 'line-clamp-3',
                descExpanded && 'max-h-32 overflow-y-auto',
              )}
            >
              {description}
              {!descExpanded && showDescToggle && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-linear-to-b from-components-panel-bg-transparent to-components-panel-bg" />
              )}
            </div>
            {showDescToggle && (
              <button
                type="button"
                className="mt-0.5 flex items-center gap-0.5 system-xs-regular text-text-accent hover:opacity-80"
                onClick={() => setDescExpanded((v) => !v)}
              >
                {descExpanded ? (
                  <>
                    <RiArrowUpSLine className="size-3" />
                    {t(($) => $['chat.collapse'], { ns: 'share' })}
                  </>
                ) : (
                  <>
                    <RiArrowDownSLine className="size-3" />
                    {t(($) => $['chat.expand'], { ns: 'share' })}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }, [description, isBelowSm, currentConversationId, hasSent, descExpanded, showDescToggle, t])

  const chatNode = useMemo(() => {
    if (allInputsHidden || !inputsForms.length) return null
    if (isBelowSm) {
      if (!currentConversationId)
        return <InputsForm collapsed={collapsed} setCollapsed={setCollapsed} />
      return null
    } else {
      return <InputsForm collapsed={collapsed} setCollapsed={setCollapsed} />
    }
  }, [inputsForms.length, isBelowSm, currentConversationId, collapsed, allInputsHidden])

  const welcome = useMemo(() => {
    const welcomeMessage = chatList.find((item) => item.isOpeningStatement)
    if (respondingState) return null
    if (currentConversationId) return null
    if (!welcomeMessage) return null
    if (!collapsed && inputsForms.length > 0 && !allInputsHidden) return null
    if (welcomeMessage.suggestedQuestions && welcomeMessage.suggestedQuestions?.length > 0) {
      return (
        <div className="flex min-h-[50vh] items-center justify-center px-4 py-12">
          <div className="flex max-w-180 grow gap-4">
            <AppIcon size="xl" icon={appData?.site} />
            <div className="w-0 grow">
              <div className="grow rounded-2xl bg-chat-bubble-bg px-4 py-3 body-lg-regular text-text-primary">
                <Markdown content={welcomeMessage.content} />
                <SuggestedQuestions item={welcomeMessage} />
              </div>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className={cn('flex min-h-[50vh] flex-col items-center justify-center gap-3 py-12')}>
        <AppIcon size="xl" icon={appData?.site} />
        <div className="max-w-3xl px-4">
          <Markdown
            className="body-2xl-regular! text-text-tertiary!"
            content={welcomeMessage.content}
          />
        </div>
      </div>
    )
  }, [
    appData?.site.icon,
    appData?.site.icon_background,
    appData?.site.icon_type,
    appData?.site.icon_url,
    chatList,
    collapsed,
    currentConversationId,
    inputsForms.length,
    respondingState,
    allInputsHidden,
  ])

  const answerIcon =
    appData?.site && appData.site.use_icon_as_answer_icon ? (
      <AnswerIcon
        iconType={appData.site.icon_type}
        icon={appData.site.icon}
        background={appData.site.icon_background}
        imageUrl={appData.site.icon_url}
      />
    ) : null
  const speechToTextTarget: SpeechToTextTarget | undefined =
    appSourceType === AppSourceType.webApp
      ? { type: 'app' as const, appSourceType: AppSourceType.webApp }
      : appId
        ? { type: 'app' as const, appId, appSourceType }
        : undefined

  return (
    <div className="h-full overflow-hidden bg-chatbot-bg">
      <Chat
        appData={appData ?? undefined}
        config={appConfig}
        speechToTextTarget={speechToTextTarget}
        chatList={messageList}
        isResponding={respondingState}
        chatContainerInnerClassName={`mx-auto pt-6 w-full max-w-[768px] ${isBelowSm && 'px-4'}`}
        chatFooterClassName="pb-4"
        chatFooterInnerClassName={`mx-auto w-full max-w-[768px] ${isBelowSm ? 'px-2' : 'px-4'}`}
        onSend={cutInSend}
        allowSendWhileResponding={cutInCanSteer}
        inputs={currentConversationId ? (currentConversationInputs as any) : newConversationInputs}
        inputsForm={inputsForms}
        onRegenerate={doRegenerate}
        onStopResponding={handleStop}
        onHumanInputFormSubmit={handleSubmitHumanInputForm}
        chatNode={
          <>
            {descriptionNode}
            {chatNode}
            {welcome}
          </>
        }
        allToolIcons={appMeta?.tool_icons || {}}
        onFeedback={handleFeedback}
        suggestedQuestions={suggestedQuestions}
        answerIcon={answerIcon}
        hideProcessDetail
        theme={theme}
        switchSibling={doSwitchSibling}
        inputDisabled={inputDisabled}
        footerNotice={
          cutInSendFailed ? (
            <p role="alert" className="mb-2 text-xs text-text-destructive">
              {t(($) => $['agentDetail.configure.preview.queue.sendFailed'], { ns: 'agentV2' })}
            </p>
          ) : undefined
        }
        sidebarCollapseState={sidebarCollapseState}
        renderAgentContent={renderAgentContent}
        questionIcon={
          initUserVariables?.avatar_url ? (
            <Avatar size="xl" role="img" aria-label={initUserVariables.name || 'user'}>
              <AvatarFallback>{getAvatarInitial(initUserVariables.name || 'user')}</AvatarFallback>
              <AvatarImage src={initUserVariables.avatar_url} alt="" />
            </Avatar>
          ) : undefined
        }
      />
    </div>
  )
}

export default ChatWrapper
