/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-use-before-define */
'use client'
import type { FC } from 'react'
import React, { useEffect, useRef, useState } from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import produce from 'immer'
import { useBoolean, useGetState } from 'ahooks'
import AppUnavailable from '../../base/app-unavailable'
import useConversation from './hooks/use-conversation'
import s from './style.module.css'
import Init from './init'
import { ToastContext } from '@/app/components/base/toast'
import Sidebar from '@/app/components/share/chat/sidebar'
import {
  delConversation,
  fetchAppParams,
  fetchChatList,
  fetchConversations,
  fetchSuggestedQuestions,
  pinConversation,
  sendChatMessage,
  stopChatMessageResponding,
  unpinConversation,
  updateFeedback,
} from '@/service/universal-chat'
import type { ConversationItem, SiteInfo } from '@/models/share'
import type { PromptConfig, SuggestedQuestionsAfterAnswerConfig } from '@/models/debug'
import type { Feedbacktype, IChatItem } from '@/app/components/app/chat/type'
import Chat from '@/app/components/app/chat'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import Loading from '@/app/components/base/loading'
import { replaceStringWithValues } from '@/app/components/app/configuration/prompt-value-panel'
import { userInputsFormToPromptVariables } from '@/utils/model-config'
import Confirm from '@/app/components/base/confirm'
import type { DataSet } from '@/models/datasets'
import ConfigSummary from '@/app/components/explore/universal-chat/config-view/summary'
import { fetchDatasets } from '@/service/datasets'
import ItemOperation from '@/app/components/explore/item-operation'

const APP_ID = 'universal-chat'
const DEFAULT_MODEL_ID = 'gpt-3.5-turbo' // gpt-4, claude-2
const DEFAULT_PLUGIN = {
  google_search: false,
  web_reader: true,
  wikipedia: true,
}
const CONFIG_KEY = 'universal-chat-config'
type CONFIG = {
  modelId: string
  plugin: {
    google_search: boolean
    web_reader: boolean
    wikipedia: boolean
  }
}
let prevConfig: null | CONFIG = localStorage.getItem(CONFIG_KEY) ? JSON.parse(localStorage.getItem(CONFIG_KEY) as string) as CONFIG : null
const setPrevConfig = (config: CONFIG) => {
  prevConfig = config
  localStorage.setItem(CONFIG_KEY, JSON.stringify(prevConfig))
}
const getInitConfig = (type: 'model' | 'plugin') => {
  if (type === 'model')
    return prevConfig?.modelId || DEFAULT_MODEL_ID

  if (type === 'plugin')
    return prevConfig?.plugin || DEFAULT_PLUGIN
}

export type IMainProps = {}

const Main: FC<IMainProps> = () => {
  const { t } = useTranslation()
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  useEffect(() => {
    document.title = `${t('explore.sidebar.chat')} -  Dify`
  }, [])
  /*
  * app info
  */
  const [appUnavailable, setAppUnavailable] = useState<boolean>(false)
  const [isUnknwonReason, setIsUnknwonReason] = useState<boolean>(false)
  const siteInfo: SiteInfo = (
    {
      title: 'universal Chatbot',
      icon: '',
      icon_background: '',
      description: '',
      default_language: 'en', // TODO
      prompt_public: true,
    }
  )
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null)
  const [inited, setInited] = useState<boolean>(false)
  // in mobile, show sidebar by click button
  const [isShowSidebar, { setTrue: showSidebar, setFalse: hideSidebar }] = useBoolean(false)
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
  const handlePin = async (id: string) => {
    await pinConversation(id)
    setControlItemOpHide(Date.now())
    notify({ type: 'success', message: t('common.api.success') })
    noticeUpdateList()
  }

  const handleUnpin = async (id: string) => {
    await unpinConversation(id)
    setControlItemOpHide(Date.now())
    notify({ type: 'success', message: t('common.api.success') })
    noticeUpdateList()
  }
  const [isShowConfirm, { setTrue: showConfirm, setFalse: hideConfirm }] = useBoolean(false)
  const [toDeleteConversationId, setToDeleteConversationId] = useState('')
  const handleDelete = (id: string) => {
    setToDeleteConversationId(id)
    hideSidebar() // mobile
    showConfirm()
  }

  const didDelete = async () => {
    await delConversation(toDeleteConversationId)
    setControlItemOpHide(Date.now())
    notify({ type: 'success', message: t('common.api.success') })
    hideConfirm()
    if (currConversationId === toDeleteConversationId)
      handleConversationIdChange('-1')

    noticeUpdateList()
  }

  const [suggestedQuestionsAfterAnswerConfig, setSuggestedQuestionsAfterAnswerConfig] = useState<SuggestedQuestionsAfterAnswerConfig | null>(null)
  const [speechToTextConfig, setSpeechToTextConfig] = useState<SuggestedQuestionsAfterAnswerConfig | null>(null)

  const [conversationIdChangeBecauseOfNew, setConversationIdChangeBecauseOfNew, getConversationIdChangeBecauseOfNew] = useGetState(false)

  const conversationName = currConversationInfo?.name || t('share.chat.newChatDefaultName') as string
  const conversationIntroduction = currConversationInfo?.introduction || ''

  const handleConversationSwitch = async () => {
    if (!inited)
      return

    // update inputs of current conversation
    let notSyncToStateIntroduction = ''
    let notSyncToStateInputs: Record<string, any> | undefined | null = {}
    // debugger
    if (!isNewConversation) {
      const item = allConversationList.find(item => item.id === currConversationId) as any
      notSyncToStateInputs = item?.inputs || {}
      // setCurrInputs(notSyncToStateInputs)
      notSyncToStateIntroduction = item?.introduction || ''
      setExistConversationInfo({
        name: item?.name || '',
        introduction: notSyncToStateIntroduction,
      })
      const modelConfig = item?.model_config
      if (modelConfig) {
        setModeId(modelConfig.model_id)
        const pluginConfig: Record<string, boolean> = {}
        const datasetIds: string[] = []
        modelConfig.agent_mode.tools.forEach((item: any) => {
          const pluginName = Object.keys(item)[0]
          if (pluginName === 'dataset')
            datasetIds.push(item.dataset.id)
          else
            pluginConfig[pluginName] = item[pluginName].enabled
        })
        setPlugins(pluginConfig)
        if (datasetIds.length > 0) {
          const { data } = await fetchDatasets({ url: '/datasets', params: { page: 1, ids: datasetIds } })
          setDateSets(data)
        }
        else {
          setDateSets([])
        }
      }
      else {
        configSetDefaultValue()
      }
    }
    else {
      configSetDefaultValue()
      notSyncToStateInputs = newConversationInputs
      setCurrInputs(notSyncToStateInputs)
    }

    // update chat list of current conversation
    if (!isNewConversation && !conversationIdChangeBecauseOfNew) {
      fetchChatList(currConversationId).then((res: any) => {
        const { data } = res
        const newChatList: IChatItem[] = generateNewChatListWithOpenstatement(notSyncToStateIntroduction, notSyncToStateInputs)

        data.forEach((item: any) => {
          newChatList.push({
            id: `question-${item.id}`,
            content: item.query,
            isAnswer: false,
          })
          newChatList.push({
            ...item,
            id: item.id,
            content: item.answer,
            feedback: item.feedback,
            isAnswer: true,
          })
        })
        setChatList(newChatList)
        setErrorHappened(false)
      })
    }

    if (isNewConversation) {
      setChatList(generateNewChatListWithOpenstatement())
      setErrorHappened(false)
    }

    setControlFocus(Date.now())
  }

  useEffect(() => {
    handleConversationSwitch()
  }, [currConversationId, inited])

  const handleConversationIdChange = (id: string) => {
    if (id === '-1') {
      createNewChat()
      setConversationIdChangeBecauseOfNew(true)
    }
    else {
      setConversationIdChangeBecauseOfNew(false)
    }
    // trigger handleConversationSwitch
    setCurrConversationId(id, APP_ID)
    setIsShowSuggestion(false)
    hideSidebar()
  }

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
    configSetDefaultValue()
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
      isOpeningStatement: true,
    }
    if (caculatedIntroduction)
      return [openstatement]

    return []
  }

  const fetchAllConversations = () => {
    return fetchConversations(undefined, undefined, 100)
  }

  const fetchInitData = async () => {
    return Promise.all([fetchAllConversations(), fetchAppParams()])
  }

  // init
  useEffect(() => {
    (async () => {
      try {
        const [conversationData, appParams]: any = await fetchInitData()
        const prompt_template = ''
        // handle current conversation id
        const { data: allConversations } = conversationData as { data: ConversationItem[]; has_more: boolean }
        const _conversationId = getConversationIdFromStorage(APP_ID)
        const isNotNewConversation = allConversations.some(item => item.id === _conversationId)
        setAllConversationList(allConversations)
        // fetch new conversation info
        const { user_input_form, opening_statement: introduction, suggested_questions_after_answer, speech_to_text }: any = appParams
        const prompt_variables = userInputsFormToPromptVariables(user_input_form)

        setNewConversationInfo({
          name: t('share.chat.newChatDefaultName'),
          introduction,
        })
        setPromptConfig({
          prompt_template,
          prompt_variables,
        } as PromptConfig)
        setSuggestedQuestionsAfterAnswerConfig(suggested_questions_after_answer)
        setSpeechToTextConfig(speech_to_text)

        if (isNotNewConversation)
          setCurrConversationId(_conversationId, APP_ID, false)

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

    let hasEmptyInput = false
    const requiredVars = prompt_variables?.filter(({ key, name, required }) => {
      const res = (!key || !key.trim()) || (!name || !name.trim()) || (required || required === undefined || required === null)
      return res
    }) || [] // compatible with old version
    requiredVars.forEach(({ key }) => {
      if (hasEmptyInput)
        return

      if (!inputs?.[key])
        hasEmptyInput = true
    })

    if (hasEmptyInput) {
      logError(t('appDebug.errorMessage.valueOfVarRequired'))
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
  const [errorHappened, setErrorHappened] = useState(false)
  const [isResponsingConIsCurrCon, setIsResponsingConCurrCon, getIsResponsingConIsCurrCon] = useGetState(true)
  const handleSend = async (message: string) => {
    if (isNewConversation) {
      setPrevConfig({
        modelId,
        plugin: plugins as any,
      })
    }

    if (isResponsing) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForResponse') })
      return
    }
    const formattedPlugins = Object.keys(plugins).map(key => ({
      [key]: {
        enabled: plugins[key],
      },
    }))
    const formattedDataSets = dataSets.map(({ id }) => {
      return {
        dataset: {
          enabled: true,
          id,
        },
      }
    })
    const data = {
      query: message,
      conversation_id: isNewConversation ? null : currConversationId,
      model: modelId,
      tools: [...formattedPlugins, ...formattedDataSets],
    }

    // qustion
    const questionId = `question-${Date.now()}`
    const questionItem = {
      id: questionId,
      content: message,
      agent_thoughts: [],
      isAnswer: false,
    }

    const placeholderAnswerId = `answer-placeholder-${Date.now()}`
    const placeholderAnswerItem = {
      id: placeholderAnswerId,
      content: '',
      isAnswer: true,
    }

    const newList = [...getChatList(), questionItem, placeholderAnswerItem]
    setChatList(newList)

    // answer
    const responseItem: IChatItem = {
      id: `${Date.now()}`,
      content: '',
      agent_thoughts: [],
      isAnswer: true,
    }

    const prevTempNewConversationId = getCurrConversationId() || '-1'
    let tempNewConversationId = prevTempNewConversationId

    setHasStopResponded(false)
    setResponsingTrue()
    setErrorHappened(false)
    setIsShowSuggestion(false)
    setIsResponsingConCurrCon(true)

    sendChatMessage(data, {
      getAbortController: (abortController) => {
        setAbortController(abortController)
      },
      onData: (message: string, isFirstMessage: boolean, { conversationId: newConversationId, messageId, taskId }: any) => {
        responseItem.content = responseItem.content + message
        responseItem.id = messageId
        if (isFirstMessage && newConversationId)
          tempNewConversationId = newConversationId

        setMessageTaskId(taskId)
        // has switched to other conversation
        if (prevTempNewConversationId !== getCurrConversationId()) {
          setIsResponsingConCurrCon(false)
          return
        }

        // closesure new list is outdated.
        const newListWithAnswer = produce(
          getChatList().filter(item => item.id !== responseItem.id && item.id !== placeholderAnswerId),
          (draft) => {
            if (!draft.find(item => item.id === questionId))
              draft.push({ ...questionItem } as any)

            draft.push({ ...responseItem })
          })

        setChatList(newListWithAnswer)
      },
      async onCompleted(hasError?: boolean) {
        if (hasError) {
          setResponsingFalse()
          return
        }

        if (getConversationIdChangeBecauseOfNew()) {
          const { data: allConversations }: any = await fetchAllConversations()
          setAllConversationList(allConversations)
          noticeUpdateList()
        }
        setConversationIdChangeBecauseOfNew(false)
        resetNewConversationInputs()
        setCurrConversationId(tempNewConversationId, APP_ID, true)
        if (getIsResponsingConIsCurrCon() && suggestedQuestionsAfterAnswerConfig?.enabled && !getHasStopResponded()) {
          const { data }: any = await fetchSuggestedQuestions(responseItem.id)
          setSuggestQuestions(data)
          setIsShowSuggestion(true)
        }
        setResponsingFalse()
      },
      onThought(thought) {
        // thought finished then start to return message. Warning: use push agent_thoughts.push would caused problem when the thought is more then 2
        responseItem.id = thought.message_id;
        (responseItem as any).agent_thoughts = [...(responseItem as any).agent_thoughts, thought] // .push(thought)
        // has switched to other conversation

        if (prevTempNewConversationId !== getCurrConversationId()) {
          setIsResponsingConCurrCon(false)
          return
        }
        const newListWithAnswer = produce(
          getChatList().filter(item => item.id !== responseItem.id && item.id !== placeholderAnswerId),
          (draft) => {
            if (!draft.find(item => item.id === questionId))
              draft.push({ ...questionItem })
            draft.push({ ...responseItem })
          })
        setChatList(newListWithAnswer)
      },
      onError() {
        setErrorHappened(true)
        // role back placeholder answer
        setChatList(produce(getChatList(), (draft) => {
          draft.splice(draft.findIndex(item => item.id === placeholderAnswerId), 1)
        }))
        setResponsingFalse()
      },
    })
  }

  const handleFeedback = async (messageId: string, feedback: Feedbacktype) => {
    await updateFeedback({ url: `/messages/${messageId}/feedbacks`, body: { rating: feedback.rating } })
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

  const renderSidebar = () => {
    if (!APP_ID || !promptConfig)
      return null
    return (
      <Sidebar
        list={conversationList}
        isClearConversationList={isClearConversationList}
        pinnedList={pinnedConversationList}
        isClearPinnedConversationList={isClearPinnedConversationList}
        onMoreLoaded={onMoreLoaded}
        onPinnedMoreLoaded={onPinnedMoreLoaded}
        isNoMore={!hasMore}
        isPinnedNoMore={!hasPinnedMore}
        onCurrentIdChange={handleConversationIdChange}
        currentId={currConversationId}
        copyRight={''}
        isInstalledApp={false}
        isUniversalChat
        installedAppId={''}
        siteInfo={siteInfo}
        onPin={handlePin}
        onUnpin={handleUnpin}
        controlUpdateList={controlUpdateConversationList}
        onDelete={handleDelete}
      />
    )
  }

  const [modelId, setModeId] = useState<string>(getInitConfig('model') as string)
  // const currModel = MODEL_LIST.find(item => item.id === modelId)

  const [plugins, setPlugins] = useState<Record<string, boolean>>(getInitConfig('plugin') as Record<string, boolean>)
  const handlePluginsChange = (key: string, value: boolean) => {
    setPlugins({
      ...plugins,
      [key]: value,
    })
  }
  const [dataSets, setDateSets] = useState<DataSet[]>([])
  const configSetDefaultValue = () => {
    setModeId(getInitConfig('model') as string)
    setPlugins(getInitConfig('plugin') as any)
    setDateSets([])
  }
  const isCurrConversationPinned = !!pinnedConversationList.find(item => item.id === currConversationId)
  const [controlItemOpHide, setControlItemOpHide] = useState(0)
  if (appUnavailable)
    return <AppUnavailable isUnknwonReason={isUnknwonReason} />

  if (!promptConfig)
    return <Loading type='app' />

  return (
    <div className='bg-gray-100'>
      <div
        className={cn(
          'flex rounded-t-2xl bg-white overflow-hidden rounded-b-2xl',
        )}
        style={{
          boxShadow: '0px 12px 16px -4px rgba(16, 24, 40, 0.08), 0px 4px 6px -2px rgba(16, 24, 40, 0.03)',
        }}
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
          s.installedApp,
          'flex-grow flex flex-col overflow-y-auto',
        )
        }>
          {(!isNewConversation || isResponsing || errorHappened) && (
            <div className='mb-5 antialiased font-sans shrink-0 relative mobile:min-h-[48px] tablet:min-h-[64px]'>
              <div className='absolute z-10 top-0 left-0 right-0 flex items-center justify-between border-b border-gray-100 mobile:h-12 tablet:h-16 px-8 bg-white'>
                <div className='text-gray-900'>{conversationName}</div>
                <div className='flex items-center shrink-0 ml-2 space-x-2'>
                  <ConfigSummary
                    modelId={modelId}
                    plugins={plugins}
                    dataSets={dataSets}
                  />
                  <div className={cn('flex w-8 h-8 justify-center items-center shrink-0 rounded-lg border border-gray-200')} onClick={e => e.stopPropagation()}>
                    <ItemOperation
                      key={controlItemOpHide}
                      className='!w-8 !h-8'
                      isPinned={isCurrConversationPinned}
                      togglePin={() => isCurrConversationPinned ? handleUnpin(currConversationId) : handlePin(currConversationId)}
                      isShowDelete
                      onDelete={() => handleDelete(currConversationId)}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className={cn(doShowSuggestion ? 'pb-[140px]' : (isResponsing ? 'pb-[113px]' : 'pb-[76px]'), 'relative grow h-[200px] pc:w-[794px] max-w-full mobile:w-full mx-auto  mb-3.5 overflow-hidden')}>
            <div className={cn('pc:w-[794px] max-w-full mobile:w-full mx-auto h-full overflow-y-auto')} ref={chatListDomRef}>
              <Chat
                isShowConfigElem={isNewConversation && chatList.length === 0}
                configElem={<Init
                  modelId={modelId}
                  onModelChange={setModeId}
                  plugins={plugins}
                  onPluginChange={handlePluginsChange}
                  dataSets={dataSets}
                  onDataSetsChange={setDateSets}
                />}
                chatList={chatList}
                onSend={handleSend}
                isHideFeedbackEdit
                onFeedback={handleFeedback}
                isResponsing={isResponsing}
                canStopResponsing={!!messageTaskId && isResponsingConIsCurrCon}
                abortResponsing={async () => {
                  await stopChatMessageResponding(messageTaskId)
                  setHasStopResponded(true)
                  setResponsingFalse()
                }}
                checkCanSend={checkCanSend}
                controlFocus={controlFocus}
                isShowSuggestion={doShowSuggestion}
                suggestionList={suggestQuestions}
                isShowSpeechToText={speechToTextConfig?.enabled}
                dataSets={dataSets}
              />
            </div>
          </div>

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
