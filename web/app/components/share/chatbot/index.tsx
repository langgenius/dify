/* eslint-disable @typescript-eslint/no-use-before-define */
'use client'
import type { FC } from 'react'
import React, { useEffect, useRef, useState } from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import produce from 'immer'
import { useBoolean, useGetState } from 'ahooks'
import { checkOrSetAccessToken } from '../utils'
import AppUnavailable from '../../base/app-unavailable'
import useConversation from './hooks/use-conversation'
import s from './style.module.css'
import { ToastContext } from '@/app/components/base/toast'
import Sidebar from '@/app/components/share/chatbot/sidebar'
import ConfigScene from '@/app/components/share/chatbot/config-scence'
import Header from '@/app/components/share/header'
import { /* delConversation, */ fetchAppInfo, fetchAppParams, fetchChatList, fetchConversations, fetchSuggestedQuestions, pinConversation, sendChatMessage, stopChatMessageResponding, unpinConversation, updateFeedback } from '@/service/share'
import type { ConversationItem, SiteInfo } from '@/models/share'
import type { PromptConfig, SuggestedQuestionsAfterAnswerConfig } from '@/models/debug'
import type { Feedbacktype, IChatItem } from '@/app/components/app/chat'
import Chat from '@/app/components/app/chat'
import { changeLanguage } from '@/i18n/i18next-config'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import Loading from '@/app/components/base/loading'
import { replaceStringWithValues } from '@/app/components/app/configuration/prompt-value-panel'
import { userInputsFormToPromptVariables } from '@/utils/model-config'
import type { InstalledApp } from '@/models/explore'
// import Confirm from '@/app/components/base/confirm'

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
  // in mobile, show sidebar by click button
  const [isShowSidebar, { setTrue: showSidebar, setFalse: hideSidebar }] = useBoolean(false)
  // Can Use metadata(https://beta.nextjs.org/docs/api-reference/metadata) to set title. But it only works in server side client.
  useEffect(() => {
    if (siteInfo?.title) {
      if (plan !== 'basic')
        document.title = `${siteInfo.title}`
      else
        document.title = `${siteInfo.title} - Powered by Dify`
    }
  }, [siteInfo?.title, plan])

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
    await pinConversation(isInstalledApp, installedAppInfo?.id, id)
    notify({ type: 'success', message: t('common.api.success') })
    noticeUpdateList()
  }

  const handleUnpin = async (id: string) => {
    await unpinConversation(isInstalledApp, installedAppInfo?.id, id)
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

  // const didDelete = async () => {
  //   await delConversation(isInstalledApp, installedAppInfo?.id, toDeleteConversationId)
  //   notify({ type: 'success', message: t('common.api.success') })
  //   hideConfirm()
  //   if (currConversationId === toDeleteConversationId)
  //     handleConversationIdChange('-1')

  //   noticeUpdateList()
  // }

  const [suggestedQuestionsAfterAnswerConfig, setSuggestedQuestionsAfterAnswerConfig] = useState<SuggestedQuestionsAfterAnswerConfig | null>(null)
  const [speechToTextConfig, setSpeechToTextConfig] = useState<SuggestedQuestionsAfterAnswerConfig | null>(null)

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
          })
          newChatList.push({
            id: item.id,
            content: item.answer,
            feedback: item.feedback,
            isAnswer: true,
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

    // console.log(isPublicVersion)
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
      : fetchAppInfo(), fetchAllConversations(), fetchAppParams(isInstalledApp, installedAppInfo?.id)])
  }

  // init
  useEffect(() => {
    (async () => {
      try {
        const [appData, conversationData, appParams]: any = await fetchInitData()
        const { app_id: appId, site: siteInfo, plan }: any = appData
        setAppId(appId)
        setPlan(plan)
        const tempIsPublicVersion = siteInfo.prompt_public
        setIsPublicVersion(tempIsPublicVersion)
        const prompt_template = ''
        // handle current conversation id
        const { data: allConversations } = conversationData as { data: ConversationItem[]; has_more: boolean }
        const _conversationId = getConversationIdFromStorage(appId)
        const isNotNewConversation = allConversations.some(item => item.id === _conversationId)
        setAllConversationList(allConversations)
        // fetch new conversation info
        const { user_input_form, opening_statement: introduction, suggested_questions_after_answer, speech_to_text }: any = appParams
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

  const handleSend = async (message: string) => {
    if (isResponsing) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForResponse') })
      return
    }
    const data = {
      inputs: currInputs,
      query: message,
      conversation_id: isNewConversation ? null : currConversationId,
    }

    // qustion
    const questionId = `question-${Date.now()}`
    const questionItem = {
      id: questionId,
      content: message,
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
    const responseItem = {
      id: `${Date.now()}`,
      content: '',
      isAnswer: true,
    }

    let tempNewConversationId = ''

    setHasStopResponded(false)
    setResponsingTrue()
    setIsShowSuggestion(false)
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
        // closesure new list is outdated.
        const newListWithAnswer = produce(
          getChatList().filter(item => item.id !== responseItem.id && item.id !== placeholderAnswerId),
          (draft) => {
            if (!draft.find(item => item.id === questionId))
              draft.push({ ...questionItem })

            draft.push({ ...responseItem })
          })
        setChatList(newListWithAnswer)
      },
      async onCompleted(hasError?: boolean) {
        setResponsingFalse()
        if (hasError)
          return

        if (getConversationIdChangeBecauseOfNew()) {
          const { data: allConversations }: any = await fetchAllConversations()
          setAllConversationList(allConversations)
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

  const renderSidebar = () => {
    if (!appId || !siteInfo || !promptConfig)
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
        copyRight={siteInfo.copyright || siteInfo.title}
        isInstalledApp={isInstalledApp}
        installedAppId={installedAppInfo?.id}
        siteInfo={siteInfo}
        onPin={handlePin}
        onUnpin={handleUnpin}
        controlUpdateList={controlUpdateConversationList}
        onDelete={handleDelete}
      />
    )
  }

  const difyIcon = (
    <div className={s.difyHeader}></div>
  )

  if (appUnavailable)
    return <AppUnavailable isUnknwonReason={isUnknwonReason} />

  if (!appId || !siteInfo || !promptConfig)
    return <Loading type='app' />

  return (
    <div>
      <Header
        title={siteInfo.title}
        icon=''
        customerIcon={difyIcon}
        icon_background={siteInfo.icon_background}
        isEmbedScene={true}
        isMobile={isMobile}
      // onShowSideBar={showSidebar}
      // onCreateNewChat={() => handleConversationIdChange('-1')}
      />

      <div className={'flex bg-white overflow-hidden'}>
        {/* sidebar */}
        {/* {!isMobile && renderSidebar()} */}
        {/* {isMobile && isShowSidebar && (
          <div className='fixed inset-0 z-50'
            style={{ backgroundColor: 'rgba(35, 56, 118, 0.2)' }}
            onClick={hideSidebar}
          >
            <div className='inline-block' onClick={e => e.stopPropagation()}>
              {renderSidebar()}
            </div>
          </div>
        )} */}
        {/* main */}
        <div className={cn(
          isInstalledApp ? s.installedApp : 'h-[calc(100vh_-_3rem)]',
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
          ></ConfigScene>

          {
            hasSetInputs && (
              <div className={cn(doShowSuggestion ? 'pb-[140px]' : (isResponsing ? 'pb-[113px]' : 'pb-[76px]'), 'relative grow h-[200px] pc:w-[794px] max-w-full mobile:w-full mx-auto mb-3.5 overflow-hidden')}>
                <div className='h-full overflow-y-auto' ref={chatListDomRef}>
                  <Chat
                    chatList={chatList}
                    onSend={handleSend}
                    isHideFeedbackEdit
                    onFeedback={handleFeedback}
                    isResponsing={isResponsing}
                    canStopResponsing={!!messageTaskId}
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
                    answerIconClassName={s.difyIcon}
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
