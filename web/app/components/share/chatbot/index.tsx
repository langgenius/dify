/* eslint-disable @typescript-eslint/no-use-before-define */
'use client'
import type { FC } from 'react'
import React, { useEffect, useRef, useState } from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import produce, { setAutoFreeze } from 'immer'
import { useBoolean, useGetState } from 'ahooks'
import { checkOrSetAccessToken } from '../utils'
import AppUnavailable from '../../base/app-unavailable'
import useConversation from './hooks/use-conversation'
import { ToastContext } from '@/app/components/base/toast'
import ConfigScene from '@/app/components/share/chatbot/config-scence'
import Header from '@/app/components/share/header'
import {
  fetchAppInfo,
  fetchAppMeta,
  fetchAppParams,
  fetchChatList,
  fetchConversations,
  fetchSuggestedQuestions,
  generationConversationName,
  sendChatMessage,
  stopChatMessageResponding,
  updateFeedback,
} from '@/service/share'
import { addFileInfos, sortAgentSorts } from '@/app/components/tools/utils'
import type { AppMeta, ConversationItem, SiteInfo } from '@/models/share'
import type { PromptConfig, SuggestedQuestionsAfterAnswerConfig } from '@/models/debug'
import type { Feedbacktype, IChatItem } from '@/app/components/app/chat/type'
import Chat from '@/app/components/app/chat'
import { changeLanguage } from '@/i18n/i18next-config'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import Loading from '@/app/components/base/loading'
import { replaceStringWithValues } from '@/app/components/app/configuration/prompt-value-panel'
import { userInputsFormToPromptVariables } from '@/utils/model-config'
import type { InstalledApp } from '@/models/explore'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import LogoHeader from '@/app/components/base/logo/logo-embeded-chat-header'
import LogoAvatar from '@/app/components/base/logo/logo-embeded-chat-avatar'
import type { VisionFile, VisionSettings } from '@/types/app'
import { Resolution, TransferMethod } from '@/types/app'
import type { Annotation as AnnotationType } from '@/models/log'

export type IMainProps = {
  isInstalledApp?: boolean
  installedAppInfo?: InstalledApp
}

const Main: FC<IMainProps> = ({
  isInstalledApp = false,
  installedAppInfo,
}) => {
  const { t } = useTranslation()
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  /*
  * app info
  */
  const [appUnavailable, setAppUnavailable] = useState<boolean>(false)
  const [isUnknwonReason, setIsUnknwonReason] = useState<boolean>(false)
  const [appId, setAppId] = useState<string>('')
  const [isPublicVersion, setIsPublicVersion] = useState<boolean>(true)
  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>()
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null)
  const [inited, setInited] = useState<boolean>(false)
  const [plan, setPlan] = useState<string>('basic') // basic/plus/pro
  const [canReplaceLogo, setCanReplaceLogo] = useState<boolean>(false)
  const [customConfig, setCustomConfig] = useState<any>(null)
  const [appMeta, setAppMeta] = useState<AppMeta | null>(null)

  // Can Use metadata(https://beta.nextjs.org/docs/api-reference/metadata) to set title. But it only works in server side client.
  useEffect(() => {
    if (siteInfo?.title) {
      if (canReplaceLogo)
        document.title = `${siteInfo.title}`
      else
        document.title = `${siteInfo.title} - Powered by Dify`
    }
  }, [siteInfo?.title, canReplaceLogo])

  // onData change thought (the produce obj). https://github.com/immerjs/immer/issues/576
  useEffect(() => {
    setAutoFreeze(false)
    return () => {
      setAutoFreeze(true)
    }
  }, [])

  /*
  * conversation info
  */
  const [allConversationList, setAllConversationList] = useState<ConversationItem[]>([])
  const [isClearConversationList, { setTrue: clearConversationListTrue, setFalse: clearConversationListFalse }] = useBoolean(false)
  const [isClearPinnedConversationList, { setTrue: clearPinnedConversationListTrue, setFalse: clearPinnedConversationListFalse }] = useBoolean(false)
  const {
    conversationList,
    setConversationList,
    pinnedConversationList,
    setPinnedConversationList,
    currConversationId,
    getCurrConversationId,
    setCurrConversationId,
    getConversationIdFromStorage,
    isNewConversation,
    currConversationInfo,
    currInputs,
    newConversationInputs,
    // existConversationInputs,
    resetNewConversationInputs,
    setCurrInputs,
    setNewConversationInfo,
    setExistConversationInfo,
  } = useConversation()
  const [hasMore, setHasMore] = useState<boolean>(true)
  const [hasPinnedMore, setHasPinnedMore] = useState<boolean>(true)

  const onMoreLoaded = ({ data: conversations, has_more }: any) => {
    setHasMore(has_more)
    if (isClearConversationList) {
      setConversationList(conversations)
      clearConversationListFalse()
    }
    else {
      setConversationList([...conversationList, ...conversations])
    }
  }

  const onPinnedMoreLoaded = ({ data: conversations, has_more }: any) => {
    setHasPinnedMore(has_more)
    if (isClearPinnedConversationList) {
      setPinnedConversationList(conversations)
      clearPinnedConversationListFalse()
    }
    else {
      setPinnedConversationList([...pinnedConversationList, ...conversations])
    }
  }

  const [controlUpdateConversationList, setControlUpdateConversationList] = useState(0)

  const noticeUpdateList = () => {
    setHasMore(true)
    clearConversationListTrue()

    setHasPinnedMore(true)
    clearPinnedConversationListTrue()

    setControlUpdateConversationList(Date.now())
  }
  const [suggestedQuestionsAfterAnswerConfig, setSuggestedQuestionsAfterAnswerConfig] = useState<SuggestedQuestionsAfterAnswerConfig | null>(null)
  const [speechToTextConfig, setSpeechToTextConfig] = useState<SuggestedQuestionsAfterAnswerConfig | null>(null)
  const [textToSpeechConfig, setTextToSpeechConfig] = useState<SuggestedQuestionsAfterAnswerConfig | null>(null)
  const [citationConfig, setCitationConfig] = useState<SuggestedQuestionsAfterAnswerConfig | null>(null)

  const [conversationIdChangeBecauseOfNew, setConversationIdChangeBecauseOfNew, getConversationIdChangeBecauseOfNew] = useGetState(false)
  const [isChatStarted, { setTrue: setChatStarted, setFalse: setChatNotStarted }] = useBoolean(false)
  const handleStartChat = (inputs: Record<string, any>) => {
    createNewChat()
    setConversationIdChangeBecauseOfNew(true)
    setCurrInputs(inputs)
    setChatStarted()
    // parse variables in introduction
    setChatList(generateNewChatListWithOpenstatement('', inputs))
  }
  const hasSetInputs = (() => {
    if (!isNewConversation)
      return true

    return isChatStarted
  })()

  // const conversationName = currConversationInfo?.name || t('share.chat.newChatDefaultName') as string
  const conversationIntroduction = currConversationInfo?.introduction || ''

  const handleConversationSwitch = () => {
    if (!inited)
      return
    if (!appId) {
      // wait for appId
      setTimeout(handleConversationSwitch, 100)
      return
    }

    // update inputs of current conversation
    let notSyncToStateIntroduction = ''
    let notSyncToStateInputs: Record<string, any> | undefined | null = {}
    if (!isNewConversation) {
      const item = allConversationList.find(item => item.id === currConversationId)
      notSyncToStateInputs = item?.inputs || {}
      setCurrInputs(notSyncToStateInputs)
      notSyncToStateIntroduction = item?.introduction || ''
      setExistConversationInfo({
        name: item?.name || '',
        introduction: notSyncToStateIntroduction,
      })
    }
    else {
      notSyncToStateInputs = newConversationInputs
      setCurrInputs(notSyncToStateInputs)
    }

    // update chat list of current conversation
    if (!isNewConversation && !conversationIdChangeBecauseOfNew && !isResponsing) {
      fetchChatList(currConversationId, isInstalledApp, installedAppInfo?.id).then((res: any) => {
        const { data } = res
        const newChatList: IChatItem[] = generateNewChatListWithOpenstatement(notSyncToStateIntroduction, notSyncToStateInputs)

        data.forEach((item: any) => {
          newChatList.push({
            id: `question-${item.id}`,
            content: item.query,
            isAnswer: false,
            message_files: item.message_files?.filter((file: any) => file.belongs_to === 'user') || [],
          })
          newChatList.push({
            id: item.id,
            content: item.answer,
            agent_thoughts: addFileInfos(item.agent_thoughts ? sortAgentSorts(item.agent_thoughts) : item.agent_thoughts, item.message_files),
            feedback: item.feedback,
            isAnswer: true,
            citation: item.retriever_resources,
            message_files: item.message_files?.filter((file: any) => file.belongs_to === 'assistant') || [],
          })
        })
        setChatList(newChatList)
      })
    }

    if (isNewConversation && isChatStarted)
      setChatList(generateNewChatListWithOpenstatement())

    setControlFocus(Date.now())
  }
  useEffect(handleConversationSwitch, [currConversationId, inited])

  /*
  * chat info. chat is under conversation.
  */
  const [chatList, setChatList, getChatList] = useGetState<IChatItem[]>([])
  const chatListDomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // scroll to bottom
    if (chatListDomRef.current)
      chatListDomRef.current.scrollTop = chatListDomRef.current.scrollHeight
  }, [chatList, currConversationId])
  // user can not edit inputs if user had send message
  const canEditInputs = !chatList.some(item => item.isAnswer === false) && isNewConversation
  const createNewChat = async () => {
    // if new chat is already exist, do not create new chat
    abortController?.abort()
    setResponsingFalse()
    if (conversationList.some(item => item.id === '-1'))
      return

    setConversationList(produce(conversationList, (draft) => {
      draft.unshift({
        id: '-1',
        name: t('share.chat.newChatDefaultName'),
        inputs: newConversationInputs,
        introduction: conversationIntroduction,
      })
    }))
  }

  // sometime introduction is not applied to state
  const generateNewChatListWithOpenstatement = (introduction?: string, inputs?: Record<string, any> | null) => {
    let caculatedIntroduction = introduction || conversationIntroduction || ''
    const caculatedPromptVariables = inputs || currInputs || null
    if (caculatedIntroduction && caculatedPromptVariables)
      caculatedIntroduction = replaceStringWithValues(caculatedIntroduction, promptConfig?.prompt_variables || [], caculatedPromptVariables)

    const openstatement = {
      id: `${Date.now()}`,
      content: caculatedIntroduction,
      isAnswer: true,
      feedbackDisabled: true,
      isOpeningStatement: isPublicVersion,
    }
    if (caculatedIntroduction)
      return [openstatement]

    return []
  }

  const fetchAllConversations = () => {
    return fetchConversations(isInstalledApp, installedAppInfo?.id, undefined, undefined, 100)
  }

  const fetchInitData = async () => {
    if (!isInstalledApp)
      await checkOrSetAccessToken()

    return Promise.all([isInstalledApp
      ? {
        app_id: installedAppInfo?.id,
        site: {
          title: installedAppInfo?.app.name,
          prompt_public: false,
          copyright: '',
        },
        plan: 'basic',
      }
      : fetchAppInfo(), fetchAllConversations(), fetchAppParams(isInstalledApp, installedAppInfo?.id), fetchAppMeta(isInstalledApp, installedAppInfo?.id)])
  }

  // init
  useEffect(() => {
    (async () => {
      try {
        const [appData, conversationData, appParams, appMeta]: any = await fetchInitData()
        setAppMeta(appMeta)
        const { app_id: appId, site: siteInfo, plan, can_replace_logo, custom_config }: any = appData
        setAppId(appId)
        setPlan(plan)
        setCanReplaceLogo(can_replace_logo)
        setCustomConfig(custom_config)
        const tempIsPublicVersion = siteInfo.prompt_public
        setIsPublicVersion(tempIsPublicVersion)
        const prompt_template = ''
        // handle current conversation id
        const { data: allConversations } = conversationData as { data: ConversationItem[]; has_more: boolean }
        const _conversationId = getConversationIdFromStorage(appId)
        const isNotNewConversation = allConversations.some(item => item.id === _conversationId)
        setAllConversationList(allConversations)
        // fetch new conversation info
        const { user_input_form, opening_statement: introduction, suggested_questions_after_answer, speech_to_text, text_to_speech, retriever_resource, file_upload, sensitive_word_avoidance }: any = appParams
        setVisionConfig({
          ...file_upload.image,
          image_file_size_limit: appParams?.system_parameters?.image_file_size_limit,
        })
        const prompt_variables = userInputsFormToPromptVariables(user_input_form)
        if (siteInfo.default_language)
          changeLanguage(siteInfo.default_language)

        setNewConversationInfo({
          name: t('share.chat.newChatDefaultName'),
          introduction,
        })
        setSiteInfo(siteInfo as SiteInfo)
        setPromptConfig({
          prompt_template,
          prompt_variables,
        } as PromptConfig)
        setSuggestedQuestionsAfterAnswerConfig(suggested_questions_after_answer)
        setSpeechToTextConfig(speech_to_text)
        setTextToSpeechConfig(text_to_speech)
        setCitationConfig(retriever_resource)

        // setConversationList(conversations as ConversationItem[])

        if (isNotNewConversation)
          setCurrConversationId(_conversationId, appId, false)

        setInited(true)
      }
      catch (e: any) {
        if (e.status === 404) {
          setAppUnavailable(true)
        }
        else {
          setIsUnknwonReason(true)
          setAppUnavailable(true)
        }
      }
    })()
  }, [])

  const [isResponsing, { setTrue: setResponsingTrue, setFalse: setResponsingFalse }] = useBoolean(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const { notify } = useContext(ToastContext)
  const logError = (message: string) => {
    notify({ type: 'error', message })
  }

  const checkCanSend = () => {
    if (currConversationId !== '-1')
      return true

    const prompt_variables = promptConfig?.prompt_variables
    const inputs = currInputs
    if (!inputs || !prompt_variables || prompt_variables?.length === 0)
      return true

    let hasEmptyInput = ''
    const requiredVars = prompt_variables?.filter(({ key, name, required }) => {
      const res = (!key || !key.trim()) || (!name || !name.trim()) || (required || required === undefined || required === null)
      return res
    }) || [] // compatible with old version
    requiredVars.forEach(({ key, name }) => {
      if (hasEmptyInput)
        return

      if (!inputs?.[key])
        hasEmptyInput = name
    })

    if (hasEmptyInput) {
      logError(t('appDebug.errorMessage.valueOfVarRequired', { key: hasEmptyInput }))
      return false
    }
    return !hasEmptyInput
  }

  const [controlFocus, setControlFocus] = useState(0)
  const [isShowSuggestion, setIsShowSuggestion] = useState(false)
  const doShowSuggestion = isShowSuggestion && !isResponsing
  const [suggestQuestions, setSuggestQuestions] = useState<string[]>([])
  const [messageTaskId, setMessageTaskId] = useState('')
  const [hasStopResponded, setHasStopResponded, getHasStopResponded] = useGetState(false)
  const [isResponsingConIsCurrCon, setIsResponsingConCurrCon, getIsResponsingConIsCurrCon] = useGetState(true)
  const [shouldReload, setShouldReload] = useState(false)
  const [userQuery, setUserQuery] = useState('')
  const [visionConfig, setVisionConfig] = useState<VisionSettings>({
    enabled: false,
    number_limits: 2,
    detail: Resolution.low,
    transfer_methods: [TransferMethod.local_file],
  })

  const updateCurrentQA = ({
    responseItem,
    questionId,
    placeholderAnswerId,
    questionItem,
  }: {
    responseItem: IChatItem
    questionId: string
    placeholderAnswerId: string
    questionItem: IChatItem
  }) => {
    // closesure new list is outdated.
    const newListWithAnswer = produce(
      getChatList().filter(item => item.id !== responseItem.id && item.id !== placeholderAnswerId),
      (draft) => {
        if (!draft.find(item => item.id === questionId))
          draft.push({ ...questionItem })

        draft.push({ ...responseItem })
      })
    setChatList(newListWithAnswer)
  }

  const handleSend = async (message: string, files?: VisionFile[]) => {
    if (isResponsing) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForResponse') })
      return
    }

    if (files?.find(item => item.transfer_method === TransferMethod.local_file && !item.upload_file_id)) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForImgUpload') })
      return false
    }
    const data: Record<string, any> = {
      inputs: currInputs,
      query: message,
      conversation_id: isNewConversation ? null : currConversationId,
    }

    if (visionConfig.enabled && files && files?.length > 0) {
      data.files = files.map((item) => {
        if (item.transfer_method === TransferMethod.local_file) {
          return {
            ...item,
            url: '',
          }
        }
        return item
      })
    }

    // qustion
    const questionId = `question-${Date.now()}`
    const questionItem = {
      id: questionId,
      content: message,
      isAnswer: false,
      message_files: files,
    }

    const placeholderAnswerId = `answer-placeholder-${Date.now()}`
    const placeholderAnswerItem = {
      id: placeholderAnswerId,
      content: '',
      isAnswer: true,
    }

    const newList = [...getChatList(), questionItem, placeholderAnswerItem]
    setChatList(newList)

    let isAgentMode = false

    // answer
    const responseItem: IChatItem = {
      id: `${Date.now()}`,
      content: '',
      agent_thoughts: [],
      message_files: [],
      isAnswer: true,
    }
    let hasSetResponseId = false

    const prevTempNewConversationId = getCurrConversationId() || '-1'
    let tempNewConversationId = prevTempNewConversationId

    setHasStopResponded(false)
    setResponsingTrue()
    setIsShowSuggestion(false)
    sendChatMessage(data, {
      getAbortController: (abortController) => {
        setAbortController(abortController)
      },
      onData: (message: string, isFirstMessage: boolean, { conversationId: newConversationId, messageId, taskId }: any) => {
        if (!isAgentMode) {
          responseItem.content = responseItem.content + message
        }
        else {
          const lastThought = responseItem.agent_thoughts?.[responseItem.agent_thoughts?.length - 1]
          if (lastThought)
            lastThought.thought = lastThought.thought + message // need immer setAutoFreeze
        }
        if (messageId && !hasSetResponseId) {
          responseItem.id = messageId
          hasSetResponseId = true
        }

        if (isFirstMessage && newConversationId)
          tempNewConversationId = newConversationId

        setMessageTaskId(taskId)
        // has switched to other conversation
        if (prevTempNewConversationId !== getCurrConversationId()) {
          setIsResponsingConCurrCon(false)
          return
        }
        updateCurrentQA({
          responseItem,
          questionId,
          placeholderAnswerId,
          questionItem,
        })
      },
      async onCompleted(hasError?: boolean) {
        if (hasError)
          return

        if (getConversationIdChangeBecauseOfNew()) {
          const { data: allConversations }: any = await fetchAllConversations()
          const newItem: any = await generationConversationName(isInstalledApp, installedAppInfo?.id, allConversations[0].id)
          const newAllConversations = produce(allConversations, (draft: any) => {
            draft[0].name = newItem.name
          })
          setAllConversationList(newAllConversations as any)
          noticeUpdateList()
        }
        setConversationIdChangeBecauseOfNew(false)
        resetNewConversationInputs()
        setChatNotStarted()
        setCurrConversationId(tempNewConversationId, appId, true)
        if (suggestedQuestionsAfterAnswerConfig?.enabled && !getHasStopResponded()) {
          const { data }: any = await fetchSuggestedQuestions(responseItem.id, isInstalledApp, installedAppInfo?.id)
          setSuggestQuestions(data)
          setIsShowSuggestion(true)
        }
        setResponsingFalse()
      },
      onFile(file) {
        const lastThought = responseItem.agent_thoughts?.[responseItem.agent_thoughts?.length - 1]
        if (lastThought)
          lastThought.message_files = [...(lastThought as any).message_files, { ...file }]

        updateCurrentQA({
          responseItem,
          questionId,
          placeholderAnswerId,
          questionItem,
        })
      },
      onThought(thought) {
        isAgentMode = true
        const response = responseItem as any
        if (thought.message_id && !hasSetResponseId) {
          response.id = thought.message_id
          hasSetResponseId = true
        }
        // responseItem.id = thought.message_id;
        if (response.agent_thoughts.length === 0) {
          response.agent_thoughts.push(thought)
        }
        else {
          const lastThought = response.agent_thoughts[response.agent_thoughts.length - 1]
          // thought changed but still the same thought, so update.
          if (lastThought.id === thought.id) {
            thought.thought = lastThought.thought
            thought.message_files = lastThought.message_files
            responseItem.agent_thoughts![response.agent_thoughts.length - 1] = thought
          }
          else {
            responseItem.agent_thoughts!.push(thought)
          }
        }
        // has switched to other conversation
        if (prevTempNewConversationId !== getCurrConversationId()) {
          setIsResponsingConCurrCon(false)
          return false
        }

        updateCurrentQA({
          responseItem,
          questionId,
          placeholderAnswerId,
          questionItem,
        })
      },
      onMessageEnd: (messageEnd) => {
        if (messageEnd.metadata?.annotation_reply) {
          responseItem.id = messageEnd.id
          responseItem.annotation = ({
            id: messageEnd.metadata.annotation_reply.id,
            authorName: messageEnd.metadata.annotation_reply.account.name,
          } as AnnotationType)
          const newListWithAnswer = produce(
            getChatList().filter(item => item.id !== responseItem.id && item.id !== placeholderAnswerId),
            (draft) => {
              if (!draft.find(item => item.id === questionId))
                draft.push({ ...questionItem })

              draft.push({
                ...responseItem,
              })
            })
          setChatList(newListWithAnswer)
          return
        }
        // not support show citation
        // responseItem.citation = messageEnd.retriever_resources
        if (!isInstalledApp)
          return
        const newListWithAnswer = produce(
          getChatList().filter(item => item.id !== responseItem.id && item.id !== placeholderAnswerId),
          (draft) => {
            if (!draft.find(item => item.id === questionId))
              draft.push({ ...questionItem })

            draft.push({ ...responseItem })
          })
        setChatList(newListWithAnswer)
      },
      onMessageReplace: (messageReplace) => {
        if (isInstalledApp) {
          responseItem.content = messageReplace.answer
        }
        else {
          setChatList(produce(
            getChatList(),
            (draft) => {
              const current = draft.find(item => item.id === messageReplace.id)

              if (current)
                current.content = messageReplace.answer
            },
          ))
        }
      },
      onError() {
        setResponsingFalse()
        // role back placeholder answer
        setChatList(produce(getChatList(), (draft) => {
          draft.splice(draft.findIndex(item => item.id === placeholderAnswerId), 1)
        }))
      },
    }, isInstalledApp, installedAppInfo?.id)
  }

  const handleFeedback = async (messageId: string, feedback: Feedbacktype) => {
    await updateFeedback({ url: `/messages/${messageId}/feedbacks`, body: { rating: feedback.rating } }, isInstalledApp, installedAppInfo?.id)
    const newChatList = chatList.map((item) => {
      if (item.id === messageId) {
        return {
          ...item,
          feedback,
        }
      }
      return item
    })
    setChatList(newChatList)
    notify({ type: 'success', message: t('common.api.success') })
  }

  const handleReload = () => {
    setCurrConversationId('-1', appId, false)
    setChatNotStarted()
    setShouldReload(false)
    createNewChat()
  }

  const handleConversationIdChange = (id: string) => {
    if (id === '-1') {
      createNewChat()
      setConversationIdChangeBecauseOfNew(true)
    }
    else {
      setConversationIdChangeBecauseOfNew(false)
    }
    // trigger handleConversationSwitch
    setCurrConversationId(id, appId)
    setIsShowSuggestion(false)
  }

  const difyIcon = (
    <LogoHeader />
  )

  if (appUnavailable)
    return <AppUnavailable isUnknwonReason={isUnknwonReason} />

  if (!appId || !siteInfo || !promptConfig) {
    return <div className='flex h-screen w-full'>
      <Loading type='app' />
    </div>
  }

  return (
    <div>
      <Header
        title={siteInfo.title}
        icon=''
        customerIcon={difyIcon}
        icon_background={siteInfo.icon_background}
        isEmbedScene={true}
        isMobile={isMobile}
        onCreateNewChat={() => handleConversationIdChange('-1')}
      />

      <div className={'flex bg-white overflow-hidden'}>
        <div className={cn(
          isInstalledApp ? 'h-full' : 'h-[calc(100vh_-_3rem)]',
          'flex-grow flex flex-col overflow-y-auto',
        )
        }>
          <ConfigScene
            // conversationName={conversationName}
            hasSetInputs={hasSetInputs}
            isPublicVersion={isPublicVersion}
            siteInfo={siteInfo}
            promptConfig={promptConfig}
            onStartChat={handleStartChat}
            canEditInputs={canEditInputs}
            savedInputs={currInputs as Record<string, any>}
            onInputsChange={setCurrInputs}
            plan={plan}
            canReplaceLogo={canReplaceLogo}
            customConfig={customConfig}
          ></ConfigScene>
          {
            shouldReload && (
              <div className='flex items-center justify-between mb-5 px-4 py-2 bg-[#FEF0C7]'>
                <div className='flex items-center text-xs font-medium text-[#DC6803]'>
                  <AlertTriangle className='mr-2 w-4 h-4' />
                  {t('share.chat.temporarySystemIssue')}
                </div>
                <div
                  className='flex items-center px-3 h-7 bg-white shadow-xs rounded-md text-xs font-medium text-gray-700 cursor-pointer'
                  onClick={handleReload}
                >
                  {t('share.chat.tryToSolve')}
                </div>
              </div>
            )
          }
          {
            hasSetInputs && (
              <div className={cn(doShowSuggestion ? 'pb-[140px]' : (isResponsing ? 'pb-[113px]' : 'pb-[76px]'), 'relative grow h-[200px] pc:w-[794px] max-w-full mobile:w-full mx-auto mb-3.5 overflow-hidden')}>
                <div className='h-full overflow-y-auto' ref={chatListDomRef}>
                  <Chat
                    chatList={chatList}
                    query={userQuery}
                    onQueryChange={setUserQuery}
                    onSend={handleSend}
                    isHideFeedbackEdit
                    onFeedback={handleFeedback}
                    isResponsing={isResponsing}
                    canStopResponsing={!!messageTaskId && isResponsingConIsCurrCon}
                    abortResponsing={async () => {
                      await stopChatMessageResponding(appId, messageTaskId, isInstalledApp, installedAppInfo?.id)
                      setHasStopResponded(true)
                      setResponsingFalse()
                    }}
                    checkCanSend={checkCanSend}
                    controlFocus={controlFocus}
                    isShowSuggestion={doShowSuggestion}
                    suggestionList={suggestQuestions}
                    displayScene='web'
                    isShowSpeechToText={speechToTextConfig?.enabled}
                    isShowTextToSpeech={textToSpeechConfig?.enabled}
                    isShowCitation={citationConfig?.enabled && isInstalledApp}
                    answerIcon={<LogoAvatar className='relative shrink-0' />}
                    visionConfig={visionConfig}
                    allToolIcons={appMeta?.tool_icons || {}}
                  />
                </div>
              </div>)
          }

          {/* {isShowConfirm && (
            <Confirm
              title={t('share.chat.deleteConversation.title')}
              content={t('share.chat.deleteConversation.content')}
              isShow={isShowConfirm}
              onClose={hideConfirm}
              onConfirm={didDelete}
              onCancel={hideConfirm}
            />
          )} */}
        </div>
      </div>
    </div>
  )
}
export default React.memo(Main)
