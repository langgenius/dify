'use client'
import type { FC } from 'react'
import React, { useEffect, useState, useRef } from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import produce from 'immer'
import { useBoolean, useGetState } from 'ahooks'
import useConversation from './hooks/use-conversation'
import { ToastContext } from '@/app/components/base/toast'
import Sidebar from '@/app/components/share/chat/sidebar'
import ConfigSence from '@/app/components/share/chat/config-scence'
import Header from '@/app/components/share/header'
import { fetchAppInfo, fetchAppParams, fetchChatList, fetchConversations, sendChatMessage, updateFeedback, fetchSuggestedQuestions } from '@/service/share'
import type { ConversationItem, SiteInfo } from '@/models/share'
import type { PromptConfig } from '@/models/debug'
import type { Feedbacktype, IChatItem } from '@/app/components/app/chat'
import Chat from '@/app/components/app/chat'
import { changeLanguage } from '@/i18n/i18next-config'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import Loading from '@/app/components/base/loading'
import { replaceStringWithValues } from '@/app/components/app/configuration/prompt-value-panel'
import AppUnavailable from '../../base/app-unavailable'
import { userInputsFormToPromptVariables } from '@/utils/model-config'
import { SuggestedQuestionsAfterAnswerConfig } from '@/models/debug'
import { InstalledApp } from '@/models/explore'

import s from './style.module.css'

export type IMainProps = {
  isInstalledApp?: boolean,
  installedAppInfo? : InstalledApp
}

const Main: FC<IMainProps> = ({
  isInstalledApp = false,
  installedAppInfo
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
  const {
    conversationList,
    setConversationList,
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
    setExistConversationInfo
  } = useConversation()
  const [hasMore, setHasMore] = useState<boolean>(false)
  const onMoreLoaded = ({ data: conversations, has_more }: any) => {
    setHasMore(has_more)
    setConversationList([...conversationList, ...conversations])
  }
  const [suggestedQuestionsAfterAnswerConfig, setSuggestedQuestionsAfterAnswerConfig] = useState<SuggestedQuestionsAfterAnswerConfig | null>(null)

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
    if (!isNewConversation) {
      return true
    }
    return isChatStarted
  })()

  const conversationName = currConversationInfo?.name || t('share.chat.newChatDefaultName') as string
  const conversationIntroduction = currConversationInfo?.introduction || ''

  const handleConversationSwitch = () => {
    if (!inited) return
    if (!appId) {
      // wait for appId
      setTimeout(handleConversationSwitch, 100)
      return
    }

    // update inputs of current conversation
    let notSyncToStateIntroduction = ''
    let notSyncToStateInputs: Record<string, any> | undefined | null = {}
    if (!isNewConversation) {
      const item = conversationList.find(item => item.id === currConversationId)
      notSyncToStateInputs = item?.inputs || {}
      setCurrInputs(notSyncToStateInputs)
      notSyncToStateIntroduction = item?.introduction || ''
      setExistConversationInfo({
        name: item?.name || '',
        introduction: notSyncToStateIntroduction,
      })
    } else {
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

    if (isNewConversation && isChatStarted) {
      setChatList(generateNewChatListWithOpenstatement())
    }

    setControlFocus(Date.now())
  }
  useEffect(handleConversationSwitch, [currConversationId, inited])

  const handleConversationIdChange = (id: string) => {
    if (id === '-1') {
      createNewChat()
      setConversationIdChangeBecauseOfNew(true)
    } else {
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
    if (chatListDomRef.current) {
      chatListDomRef.current.scrollTop = chatListDomRef.current.scrollHeight
    }
  }, [chatList, currConversationId])
  // user can not edit inputs if user had send message
  const canEditInpus = !chatList.some(item => item.isAnswer === false) && isNewConversation
  const createNewChat = () => {
    // if new chat is already exist, do not create new chat
    abortController?.abort()
    setResponsingFalse()
    if (conversationList.some(item => item.id === '-1')) {
      return
    }
    setConversationList(produce(conversationList, draft => {
      draft.unshift({
        id: '-1',
        name: t('share.chat.newChatDefaultName'),
        inputs: newConversationInputs,
        introduction: conversationIntroduction
      })
    }))
  }

  // sometime introduction is not applied to state
  const generateNewChatListWithOpenstatement = (introduction?: string, inputs?: Record<string, any> | null) => {
    let caculatedIntroduction = introduction || conversationIntroduction || ''
    const caculatedPromptVariables = inputs || currInputs || null
    if (caculatedIntroduction && caculatedPromptVariables) {
      caculatedIntroduction = replaceStringWithValues(caculatedIntroduction, promptConfig?.prompt_variables || [], caculatedPromptVariables)
    }
    // console.log(isPublicVersion)
    const openstatement = {
      id: `${Date.now()}`,
      content: caculatedIntroduction,
      isAnswer: true,
      feedbackDisabled: true,
      isOpeningStatement: isPublicVersion
    }
    if (caculatedIntroduction) {
      return [openstatement]
    }
    return []
  }

  const fetchInitData = () => {
    return Promise.all([isInstalledApp ? {
      app_id: installedAppInfo?.id, 
      site: {
        title: installedAppInfo?.app.name,
        prompt_public: false,
        copyright: ''
      },
      plan: 'basic',
    }: fetchAppInfo(), fetchConversations(isInstalledApp, installedAppInfo?.id), fetchAppParams(isInstalledApp, installedAppInfo?.id)])
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
        const { data: conversations, has_more } = conversationData as { data: ConversationItem[], has_more: boolean }
        const _conversationId = getConversationIdFromStorage(appId)
        const isNotNewConversation = conversations.some(item => item.id === _conversationId)
        setHasMore(has_more)
        // fetch new conversation info
        const { user_input_form, opening_statement: introduction, suggested_questions_after_answer }: any = appParams
        const prompt_variables = userInputsFormToPromptVariables(user_input_form)
        if(siteInfo.default_language) {
          changeLanguage(siteInfo.default_language)
        }
        setNewConversationInfo({
          name: t('share.chat.newChatDefaultName'),
          introduction,
        })
        setSiteInfo(siteInfo as SiteInfo)
        setPromptConfig({
          prompt_template,
          prompt_variables: prompt_variables,
        } as PromptConfig)
        setSuggestedQuestionsAfterAnswerConfig(suggested_questions_after_answer)

        setConversationList(conversations as ConversationItem[])

        if (isNotNewConversation) {
          setCurrConversationId(_conversationId, appId, false)
        }
        setInited(true)
      } catch (e: any) {
        if (e.status === 404) {
          setAppUnavailable(true)
        } else {
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
    const prompt_variables = promptConfig?.prompt_variables
    const inputs = currInputs
    if (!inputs || !prompt_variables || prompt_variables?.length === 0) {
      return true
    }
    let hasEmptyInput = false
    const requiredVars = prompt_variables?.filter(({ key, name, required }) => {
      const res = (!key || !key.trim()) || (!name || !name.trim()) || (required || required === undefined || required === null)
      return res
    }) || [] // compatible with old version
    requiredVars.forEach(({ key }) => {
      if (hasEmptyInput) {
        return
      }
      if (!inputs?.[key]) {
        hasEmptyInput = true
      }
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

    setResponsingTrue()
    setIsShowSuggestion(false)
    sendChatMessage(data, {
      getAbortController: (abortController) => {
        setAbortController(abortController)
      },
      onData: (message: string, isFirstMessage: boolean, { conversationId: newConversationId, messageId }: any) => {
        responseItem.content = responseItem.content + message
        responseItem.id = messageId
        if (isFirstMessage && newConversationId) {
          tempNewConversationId = newConversationId
        }

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
        if (hasError) {
          return
        }
        let currChatList = conversationList
        if (getConversationIdChangeBecauseOfNew()) {
          const { data: conversations, has_more }: any = await fetchConversations(isInstalledApp, installedAppInfo?.id)
          setHasMore(has_more)
          setConversationList(conversations as ConversationItem[])
          currChatList = conversations
        }
        setConversationIdChangeBecauseOfNew(false)
        resetNewConversationInputs()
        setChatNotStarted()
        setCurrConversationId(tempNewConversationId, appId, true)
        if (suggestedQuestionsAfterAnswerConfig?.enabled) {
          const { data }: any = await fetchSuggestedQuestions(responseItem.id, isInstalledApp, installedAppInfo?.id)
          setSuggestQuestions(data)
          setIsShowSuggestion(true)
        }
      },
      onError() {
        setResponsingFalse()
        // role back placeholder answer
        setChatList(produce(getChatList(), draft => {
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
        onMoreLoaded={onMoreLoaded}
        isNoMore={!hasMore}
        onCurrentIdChange={handleConversationIdChange}
        currentId={currConversationId}
        copyRight={siteInfo.copyright || siteInfo.title}
        isInstalledApp={isInstalledApp}
        installedAppId={installedAppInfo?.id}
        siteInfo={siteInfo}
      />
    )
  }

  if (appUnavailable)
    return <AppUnavailable isUnknwonReason={isUnknwonReason} />

  if (!appId || !siteInfo || !promptConfig)
    return <Loading type='app' />

  return (
    <div className='bg-gray-100'>
      {!isInstalledApp && (
        <Header
          title={siteInfo.title}
          icon={siteInfo.icon || ''}
          icon_background={siteInfo.icon_background}
          isMobile={isMobile}
          onShowSideBar={showSidebar}
          onCreateNewChat={() => handleConversationIdChange('-1')}
        />
      )}
      
      {/* {isNewConversation ? 'new' : 'exist'}
        {JSON.stringify(newConversationInputs ? newConversationInputs : {})}
        {JSON.stringify(existConversationInputs ? existConversationInputs : {})} */}
      <div 
        className={cn(
          "flex rounded-t-2xl bg-white overflow-hidden",
          isInstalledApp && 'rounded-b-2xl',
        )}
        style={isInstalledApp ? {
          boxShadow: '0px 12px 16px -4px rgba(16, 24, 40, 0.08), 0px 4px 6px -2px rgba(16, 24, 40, 0.03)'
        } : {}}
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
          isInstalledApp ? s.installedApp : 'h-[calc(100vh_-_3rem)]',
          'flex-grow flex flex-col overflow-y-auto'
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
          ></ConfigSence>

          {
            hasSetInputs && (
              <div className={cn(doShowSuggestion ? 'pb-[140px]' : 'pb-[66px]', 'relative grow h-[200px] pc:w-[794px] max-w-full mobile:w-full mx-auto mb-3.5 overflow-hidden')}>
                <div className='h-full overflow-y-auto' ref={chatListDomRef}>
                  <Chat
                    chatList={chatList}
                    onSend={handleSend}
                    isHideFeedbackEdit
                    onFeedback={handleFeedback}
                    isResponsing={isResponsing}
                    abortResponsing={() => {
                      abortController?.abort()
                      setResponsingFalse()
                    }}
                    checkCanSend={checkCanSend}
                    controlFocus={controlFocus}
                    isShowSuggestion={doShowSuggestion}
                    suggestionList={suggestQuestions}
                  />
                </div>
              </div>)
          }
        </div>
      </div>
    </div>
  )
}
export default React.memo(Main)
