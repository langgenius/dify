/* eslint-disable @typescript-eslint/no-use-before-define */
'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import cn from 'classnames'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import produce, { setAutoFreeze } from 'immer'
import { useBoolean, useGetState } from 'ahooks'
import AppUnavailable from '../../base/app-unavailable'
import { checkOrSetAccessToken } from '../utils'
import { addFileInfos, sortAgentSorts } from '../../tools/utils'
import useConversation from './hooks/use-conversation'
import { ToastContext } from '@/app/components/base/toast'
import Sidebar from '@/app/components/share/chat/sidebar'
import ConfigSence from '@/app/components/share/chat/config-scence'
import Header from '@/app/components/share/header'
import {
  delConversation,
  fetchAppInfo,
  fetchAppMeta,
  fetchAppParams,
  fetchChatList,
  fetchConversations,
  fetchSuggestedQuestions,
  generationConversationName,
  pinConversation,
  sendChatMessage,
  stopChatMessageResponding,
  unpinConversation,
  updateFeedback,
} from '@/service/share'
import type { AppMeta, ConversationItem, SiteInfo } from '@/models/share'

import type {
  CitationConfig,
  PromptConfig,
  SpeechToTextConfig,
  SuggestedQuestionsAfterAnswerConfig,
  TextToSpeechConfig,
} from '@/models/debug'
import type { Feedbacktype, IChatItem } from '@/app/components/app/chat/type'
import Chat from '@/app/components/app/chat'
import { changeLanguage } from '@/i18n/i18next-config'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import Loading from '@/app/components/base/loading'
import { replaceStringWithValues } from '@/app/components/app/configuration/prompt-value-panel'
import { userInputsFormToPromptVariables } from '@/utils/model-config'
import type { InstalledApp } from '@/models/explore'
import Confirm from '@/app/components/base/confirm'
import type { VisionFile, VisionSettings } from '@/types/app'
import { Resolution, TransferMethod } from '@/types/app'
import { fetchFileUploadConfig } from '@/service/common'
import type { Annotation as AnnotationType } from '@/models/log'

export type IMainProps = {
  isInstalledApp?: boolean
  installedAppInfo?: InstalledApp
  isSupportPlugin?: boolean
}

const Main: FC<IMainProps> = ({
  isInstalledApp = false,
  installedAppInfo,
}) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
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
  // in mobile, show sidebar by click button
  const [isShowSidebar, { setTrue: showSidebar, setFalse: hideSidebar }] = useBoolean(false)
  // Can Use metadata(https://beta.nextjs.org/docs/api-reference/metadata) to set title. But it only works in server side client.
  useEffect(() => {
    if (siteInfo?.title) {
      if (canReplaceLogo)
        document.title = `${siteInfo.title}`
      else
        document.title = `${siteInfo.title} - Powered by Dify`
    }
  }, [siteInfo?.title, canReplaceLogo])

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
    existConversationInfo,
    setExistConversationInfo,
  } = useConversation()
  const [suggestedQuestions, setSuggestQuestions] = useState<string[]>([])
  const [hasMore, setHasMore] = useState<boolean>(true)
  const [hasPinnedMore, setHasPinnedMore] = useState<boolean>(true)
  const [isShowSuggestion, setIsShowSuggestion] = useState(false)
  const onMoreLoaded = useCallback(({ data: conversations, has_more }: any) => {
    setHasMore(has_more)
    if (isClearConversationList) {
      setConversationList(conversations)
      clearConversationListFalse()
    }
    else {
      setConversationList([...conversationList, ...conversations])
    }
  }, [conversationList, setConversationList, isClearConversationList, clearConversationListFalse])
  const onPinnedMoreLoaded = useCallback(({ data: conversations, has_more }: any) => {
    setHasPinnedMore(has_more)
    if (isClearPinnedConversationList) {
      setPinnedConversationList(conversations)
      clearPinnedConversationListFalse()
    }
    else {
      setPinnedConversationList([...pinnedConversationList, ...conversations])
    }
  }, [pinnedConversationList, setPinnedConversationList, isClearPinnedConversationList, clearPinnedConversationListFalse])
  const [controlUpdateConversationList, setControlUpdateConversationList] = useState(0)
  const noticeUpdateList = useCallback(() => {
    setHasMore(true)
    clearConversationListTrue()

    setHasPinnedMore(true)
    clearPinnedConversationListTrue()

    setControlUpdateConversationList(Date.now())
  }, [clearConversationListTrue, clearPinnedConversationListTrue])
  const handlePin = useCallback(async (id: string) => {
    await pinConversation(isInstalledApp, installedAppInfo?.id, id)
    notify({ type: 'success', message: t('common.api.success') })
    noticeUpdateList()
  }, [isInstalledApp, installedAppInfo?.id, t, notify, noticeUpdateList])

  const handleUnpin = useCallback(async (id: string) => {
    await unpinConversation(isInstalledApp, installedAppInfo?.id, id)
    notify({ type: 'success', message: t('common.api.success') })
    noticeUpdateList()
  }, [isInstalledApp, installedAppInfo?.id, t, notify, noticeUpdateList])
  const [isShowConfirm, { setTrue: showConfirm, setFalse: hideConfirm }] = useBoolean(false)
  const [toDeleteConversationId, setToDeleteConversationId] = useState('')
  const handleDelete = useCallback((id: string) => {
    setToDeleteConversationId(id)
    hideSidebar() // mobile
    showConfirm()
  }, [hideSidebar, showConfirm])

  const didDelete = async () => {
    await delConversation(isInstalledApp, installedAppInfo?.id, toDeleteConversationId)
    notify({ type: 'success', message: t('common.api.success') })
    hideConfirm()
    if (currConversationId === toDeleteConversationId)
      handleConversationIdChange('-1')

    noticeUpdateList()
  }

  const [suggestedQuestionsAfterAnswerConfig, setSuggestedQuestionsAfterAnswerConfig] = useState<SuggestedQuestionsAfterAnswerConfig | null>(null)
  const [speechToTextConfig, setSpeechToTextConfig] = useState<SpeechToTextConfig | null>(null)
  const [textToSpeechConfig, setTextToSpeechConfig] = useState<TextToSpeechConfig | null>(null)
  const [citationConfig, setCitationConfig] = useState<CitationConfig | null>(null)
  const [chatList, setChatList, getChatList] = useGetState<IChatItem[]>([])
  const chatListDomRef = useRef<HTMLDivElement>(null)
  const [isResponding, { setTrue: setRespondingTrue, setFalse: setRespondingFalse }] = useBoolean(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [conversationIdChangeBecauseOfNew, setConversationIdChangeBecauseOfNew, getConversationIdChangeBecauseOfNew] = useGetState(false)
  const [isChatStarted, { setTrue: setChatStarted, setFalse: setChatNotStarted }] = useBoolean(false)
  const conversationIntroduction = currConversationInfo?.introduction || ''
  const createNewChat = useCallback(async () => {
    // if new chat is already exist, do not create new chat
    abortController?.abort()
    setRespondingFalse()
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
  }, [
    abortController,
    setRespondingFalse,
    setConversationList,
    conversationList,
    newConversationInputs,
    conversationIntroduction,
    t,
  ])
  const handleStartChat = useCallback((inputs: Record<string, any>) => {
    createNewChat()
    setConversationIdChangeBecauseOfNew(true)
    setCurrInputs(inputs)
    setChatStarted()
    // parse variables in introduction
    setChatList(generateNewChatListWithOpenstatement('', inputs))
  }, [
    createNewChat,
    setConversationIdChangeBecauseOfNew,
    setCurrInputs,
    setChatStarted,
    setChatList,
  ])
  const hasSetInputs = (() => {
    if (!isNewConversation)
      return true

    return isChatStarted
  })()

  const conversationName = currConversationInfo?.name || t('share.chat.newChatDefaultName') as string
  const [controlChatUpdateAllConversation, setControlChatUpdateAllConversation] = useState(0)

  // onData change thought (the produce obj). https://github.com/immerjs/immer/issues/576
  useEffect(() => {
    setAutoFreeze(false)
    return () => {
      setAutoFreeze(true)
    }
  }, [])

  useEffect(() => {
    (async () => {
      if (controlChatUpdateAllConversation && !isNewConversation) {
        const { data: allConversations } = await fetchAllConversations() as { data: ConversationItem[]; has_more: boolean }
        const item = allConversations.find(item => item.id === currConversationId)
        setAllConversationList(allConversations)
        if (item) {
          setExistConversationInfo({
            ...existConversationInfo,
            name: item?.name || '',
          } as any)
        }
      }
    })()
  }, [controlChatUpdateAllConversation])

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
    if (!isNewConversation && !conversationIdChangeBecauseOfNew) {
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
  useEffect(() => {
    // scroll to bottom
    if (chatListDomRef.current)
      chatListDomRef.current.scrollTop = chatListDomRef.current.scrollHeight
  }, [chatList, currConversationId])
  // user can not edit inputs if user had send message
  const canEditInpus = !chatList.some(item => item.isAnswer === false) && isNewConversation

  const handleConversationIdChange = useCallback((id: string) => {
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
    hideSidebar()
  }, [
    appId,
    createNewChat,
    hideSidebar,
    setCurrConversationId,
    setIsShowSuggestion,
    setConversationIdChangeBecauseOfNew,
  ])

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
      isOpeningStatement: true,
      suggestedQuestions: openingSuggestedQuestions,
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
          icon: installedAppInfo?.app.icon,
          icon_background: installedAppInfo?.app.icon_background,
          prompt_public: false,
          copyright: '',
        },
        plan: 'basic',
      }
      : fetchAppInfo(), fetchAllConversations(), fetchAppParams(isInstalledApp, installedAppInfo?.id), fetchAppMeta(isInstalledApp, installedAppInfo?.id)])
  }

  const { data: fileUploadConfigResponse } = useSWR(isInstalledApp ? { url: '/files/upload' } : null, fetchFileUploadConfig)

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
        const { user_input_form, opening_statement: introduction, suggested_questions, suggested_questions_after_answer, speech_to_text, text_to_speech, retriever_resource, file_upload, sensitive_word_avoidance }: any = appParams
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
        setOpeningSuggestedQuestions(suggested_questions || [])

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

  const logError = useCallback((message: string) => {
    notify({ type: 'error', message })
  }, [notify])

  const checkCanSend = useCallback(() => {
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
  }, [currConversationId, currInputs, promptConfig, t, logError])

  const [controlFocus, setControlFocus] = useState(0)
  const doShowSuggestion = isShowSuggestion && !isResponding
  const [openingSuggestedQuestions, setOpeningSuggestedQuestions] = useState<string[]>([])
  const [messageTaskId, setMessageTaskId] = useState('')
  const [hasStopResponded, setHasStopResponded, getHasStopResponded] = useGetState(false)
  const [isRespondingConIsCurrCon, setIsRespondingConCurrCon, getIsRespondingConIsCurrCon] = useGetState(true)
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
    if (isResponding) {
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
    setRespondingTrue()
    setIsShowSuggestion(false)
    setIsRespondingConCurrCon(true)
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
          setIsRespondingConCurrCon(false)
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
        if (getIsRespondingConIsCurrCon() && suggestedQuestionsAfterAnswerConfig?.enabled && !getHasStopResponded()) {
          const { data }: any = await fetchSuggestedQuestions(responseItem.id, isInstalledApp, installedAppInfo?.id)
          setSuggestQuestions(data)
          setIsShowSuggestion(true)
        }
        setRespondingFalse()
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
          setIsRespondingConCurrCon(false)
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
        setRespondingFalse()
        // role back placeholder answer
        setChatList(produce(getChatList(), (draft) => {
          draft.splice(draft.findIndex(item => item.id === placeholderAnswerId), 1)
        }))
      },
    }, isInstalledApp, installedAppInfo?.id)
  }

  const handleFeedback = useCallback(async (messageId: string, feedback: Feedbacktype) => {
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
  }, [isInstalledApp, installedAppInfo?.id, chatList, t, notify, setChatList])

  const handleListChanged = useCallback((list: ConversationItem[]) => {
    setConversationList(list)
    setControlChatUpdateAllConversation(Date.now())
  }, [setConversationList, setControlChatUpdateAllConversation])
  const handlePinnedListChanged = useCallback((list: ConversationItem[]) => {
    setPinnedConversationList(list)
    setControlChatUpdateAllConversation(Date.now())
  }, [setPinnedConversationList, setControlChatUpdateAllConversation])
  const handleStartChatOnSidebar = useCallback(() => {
    handleConversationIdChange('-1')
  }, [handleConversationIdChange])

  const renderSidebar = () => {
    if (!appId || !siteInfo || !promptConfig)
      return null
    return (
      <Sidebar
        list={conversationList}
        onListChanged={handleListChanged}
        isClearConversationList={isClearConversationList}
        pinnedList={pinnedConversationList}
        onPinnedListChanged={handlePinnedListChanged}
        isClearPinnedConversationList={isClearPinnedConversationList}
        onMoreLoaded={onMoreLoaded}
        onPinnedMoreLoaded={onPinnedMoreLoaded}
        isNoMore={!hasMore}
        isPinnedNoMore={!hasPinnedMore}
        onCurrentIdChange={handleConversationIdChange}
        currentId={currConversationId}
        copyRight={siteInfo.copyright || siteInfo.title}
        isInstalledApp={isInstalledApp}
        installedAppId={installedAppInfo?.id}
        siteInfo={siteInfo}
        onPin={handlePin}
        onUnpin={handleUnpin}
        controlUpdateList={controlUpdateConversationList}
        onDelete={handleDelete}
        onStartChat={handleStartChatOnSidebar}
      />
    )
  }

  const handleAbortResponding = useCallback(async () => {
    await stopChatMessageResponding(appId, messageTaskId, isInstalledApp, installedAppInfo?.id)
    setHasStopResponded(true)
    setRespondingFalse()
  }, [appId, messageTaskId, isInstalledApp, installedAppInfo?.id])

  if (appUnavailable)
    return <AppUnavailable isUnknwonReason={isUnknwonReason} />

  if (!appId || !siteInfo || !promptConfig) {
    return <div className='flex h-screen w-full'>
      <Loading type='app' />
    </div>
  }

  return (
    <div className='bg-gray-100 h-full flex flex-col'>
      {!isInstalledApp && (
        <Header
          title={siteInfo.title}
          icon={siteInfo.icon || ''}
          icon_background={siteInfo.icon_background || ''}
          isMobile={isMobile}
          onShowSideBar={showSidebar}
          onCreateNewChat={handleStartChatOnSidebar}
        />
      )}

      <div
        className={cn(
          'flex rounded-t-2xl bg-white overflow-hidden h-full w-full',
          isInstalledApp && 'rounded-b-2xl',
        )}
        style={isInstalledApp
          ? {
            boxShadow: '0px 12px 16px -4px rgba(16, 24, 40, 0.08), 0px 4px 6px -2px rgba(16, 24, 40, 0.03)',
          }
          : {}}
      >
        {/* sidebar */}
        {!isMobile && renderSidebar()}
        {isMobile && isShowSidebar && (
          <div className='fixed inset-0 z-50'
            style={{ backgroundColor: 'rgba(35, 56, 118, 0.2)' }}
            onClick={hideSidebar}
          >
            <div className='inline-block' onClick={e => e.stopPropagation()}>
              {renderSidebar()}
            </div>
          </div>
        )}
        {/* main */}
        <div className={cn(
          'h-full flex-grow flex flex-col overflow-y-auto',
        )
        }>
          <ConfigSence
            conversationName={conversationName}
            hasSetInputs={hasSetInputs}
            isPublicVersion={isPublicVersion}
            siteInfo={siteInfo}
            promptConfig={promptConfig}
            onStartChat={handleStartChat}
            canEidtInpus={canEditInpus}
            savedInputs={currInputs as Record<string, any>}
            onInputsChange={setCurrInputs}
            plan={plan}
            canReplaceLogo={canReplaceLogo}
            customConfig={customConfig}
          ></ConfigSence>

          {
            hasSetInputs && (
              <div className={cn(doShowSuggestion ? 'pb-[140px]' : (isResponding ? 'pb-[113px]' : 'pb-[76px]'), 'relative grow h-[200px] pc:w-[794px] max-w-full mobile:w-full mx-auto mb-3.5 overflow-hidden')}>
                <div className='h-full overflow-y-auto' ref={chatListDomRef}>
                  <Chat
                    chatList={chatList}
                    query={userQuery}
                    onQueryChange={setUserQuery}
                    onSend={handleSend}
                    isHideFeedbackEdit
                    onFeedback={handleFeedback}
                    isResponding={isResponding}
                    canStopResponding={!!messageTaskId && isRespondingConIsCurrCon}
                    abortResponding={handleAbortResponding}
                    checkCanSend={checkCanSend}
                    controlFocus={controlFocus}
                    isShowSuggestion={doShowSuggestion}
                    suggestionList={suggestedQuestions}
                    isShowSpeechToText={speechToTextConfig?.enabled}
                    isShowTextToSpeech={textToSpeechConfig?.enabled}
                    isShowCitation={citationConfig?.enabled}
                    visionConfig={{
                      ...visionConfig,
                      image_file_size_limit: fileUploadConfigResponse ? fileUploadConfigResponse.image_file_size_limit : visionConfig.image_file_size_limit,
                    }}
                    allToolIcons={appMeta?.tool_icons || {}}
                  />
                </div>
              </div>)
          }

          {isShowConfirm && (
            <Confirm
              title={t('share.chat.deleteConversation.title')}
              content={t('share.chat.deleteConversation.content')}
              isShow={isShowConfirm}
              onClose={hideConfirm}
              onConfirm={didDelete}
              onCancel={hideConfirm}
            />
          )}
        </div>
      </div>
    </div>
  )
}
export default React.memo(Main)
