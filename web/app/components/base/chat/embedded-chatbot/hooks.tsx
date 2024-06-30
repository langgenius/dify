import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { useLocalStorageState } from 'ahooks'
import produce from 'immer'
import type {
  ChatConfig,
  ChatItem,
  Feedback,
} from '../types'
import { CONVERSATION_ID_INFO } from '../constants'
import {
  fetchAppInfo,
  fetchAppMeta,
  fetchAppParams,
  fetchChatList,
  fetchConversations,
  generationConversationName,
  updateFeedback,
} from '@/service/share'
import type {
  // AppData,
  ConversationItem,
} from '@/models/share'
import { addFileInfos, sortAgentSorts } from '@/app/components/tools/utils'
import { useToastContext } from '@/app/components/base/toast'
import { changeLanguage } from '@/i18n/i18next-config'

export const useEmbeddedChatbot = () => {
  const isInstalledApp = false
  const { data: appInfo, isLoading: appInfoLoading, error: appInfoError } = useSWR('appInfo', fetchAppInfo)

  const appData = useMemo(() => {
    return appInfo
  }, [appInfo])
  const appId = useMemo(() => appData?.app_id, [appData])

  useEffect(() => {
    if (appInfo?.site.default_language)
      changeLanguage(appInfo.site.default_language)
  }, [appInfo])

  const [conversationIdInfo, setConversationIdInfo] = useLocalStorageState<Record<string, string>>(CONVERSATION_ID_INFO, {
    defaultValue: {},
  })
  const currentConversationId = useMemo(() => conversationIdInfo?.[appId || ''] || '', [appId, conversationIdInfo])
  const handleConversationIdInfoChange = useCallback((changeConversationId: string) => {
    if (appId) {
      setConversationIdInfo({
        ...conversationIdInfo,
        [appId || '']: changeConversationId,
      })
    }
  }, [appId, conversationIdInfo, setConversationIdInfo])
  const [showConfigPanelBeforeChat, setShowConfigPanelBeforeChat] = useState(true)

  const [newConversationId, setNewConversationId] = useState('')
  const chatShouldReloadKey = useMemo(() => {
    if (currentConversationId === newConversationId)
      return ''

    return currentConversationId
  }, [currentConversationId, newConversationId])

  const { data: appParams } = useSWR(['appParams', isInstalledApp, appId], () => fetchAppParams(isInstalledApp, appId))
  const { data: appMeta } = useSWR(['appMeta', isInstalledApp, appId], () => fetchAppMeta(isInstalledApp, appId))
  const { data: appPinnedConversationData } = useSWR(['appConversationData', isInstalledApp, appId, true], () => fetchConversations(isInstalledApp, appId, undefined, true, 100))
  const { data: appConversationData, isLoading: appConversationDataLoading, mutate: mutateAppConversationData } = useSWR(['appConversationData', isInstalledApp, appId, false], () => fetchConversations(isInstalledApp, appId, undefined, false, 100))
  const { data: appChatListData, isLoading: appChatListDataLoading } = useSWR(chatShouldReloadKey ? ['appChatList', chatShouldReloadKey, isInstalledApp, appId] : null, () => fetchChatList(chatShouldReloadKey, isInstalledApp, appId))

  const appPrevChatList = useMemo(() => {
    const data = appChatListData?.data || []
    const chatList: ChatItem[] = []

    if (currentConversationId && data.length) {
      data.forEach((item: any) => {
        chatList.push({
          id: `question-${item.id}`,
          content: item.query,
          isAnswer: false,
          message_files: item.message_files?.filter((file: any) => file.belongs_to === 'user') || [],
        })
        chatList.push({
          id: item.id,
          content: item.answer,
          agent_thoughts: addFileInfos(item.agent_thoughts ? sortAgentSorts(item.agent_thoughts) : item.agent_thoughts, item.message_files),
          feedback: item.feedback,
          isAnswer: true,
          citation: item.retriever_resources,
          message_files: item.message_files?.filter((file: any) => file.belongs_to === 'assistant') || [],
        })
      })
    }

    return chatList
  }, [appChatListData, currentConversationId])

  const [showNewConversationItemInList, setShowNewConversationItemInList] = useState(false)

  const pinnedConversationList = useMemo(() => {
    return appPinnedConversationData?.data || []
  }, [appPinnedConversationData])
  const { t } = useTranslation()
  const newConversationInputsRef = useRef<Record<string, any>>({})
  const [newConversationInputs, setNewConversationInputs] = useState<Record<string, any>>({})
  const handleNewConversationInputsChange = useCallback((newInputs: Record<string, any>) => {
    newConversationInputsRef.current = newInputs
    setNewConversationInputs(newInputs)
  }, [])
  const inputsForms = useMemo(() => {
    return (appParams?.user_input_form || []).filter((item: any) => item.paragraph || item.select || item['text-input'] || item.number).map((item: any) => {
      if (item.paragraph) {
        return {
          ...item.paragraph,
          type: 'paragraph',
        }
      }
      if (item.number) {
        return {
          ...item.number,
          type: 'number',
        }
      }
      if (item.select) {
        return {
          ...item.select,
          type: 'select',
        }
      }

      return {
        ...item['text-input'],
        type: 'text-input',
      }
    })
  }, [appParams])
  useEffect(() => {
    const conversationInputs: Record<string, any> = {}

    inputsForms.forEach((item: any) => {
      conversationInputs[item.variable] = item.default || ''
    })
    handleNewConversationInputsChange(conversationInputs)
  }, [handleNewConversationInputsChange, inputsForms])

  const { data: newConversation } = useSWR(newConversationId ? [isInstalledApp, appId, newConversationId] : null, () => generationConversationName(isInstalledApp, appId, newConversationId), { revalidateOnFocus: false })
  const [originConversationList, setOriginConversationList] = useState<ConversationItem[]>([])
  useEffect(() => {
    if (appConversationData?.data && !appConversationDataLoading)
      setOriginConversationList(appConversationData?.data)
  }, [appConversationData, appConversationDataLoading])
  const conversationList = useMemo(() => {
    const data = originConversationList.slice()

    if (showNewConversationItemInList && data[0]?.id !== '') {
      data.unshift({
        id: '',
        name: t('share.chat.newChatDefaultName'),
        inputs: {},
        introduction: '',
      })
    }
    return data
  }, [originConversationList, showNewConversationItemInList, t])

  useEffect(() => {
    if (newConversation) {
      setOriginConversationList(produce((draft) => {
        const index = draft.findIndex(item => item.id === newConversation.id)

        if (index > -1)
          draft[index] = newConversation
        else
          draft.unshift(newConversation)
      }))
    }
  }, [newConversation])

  const currentConversationItem = useMemo(() => {
    let conversationItem = conversationList.find(item => item.id === currentConversationId)

    if (!conversationItem && pinnedConversationList.length)
      conversationItem = pinnedConversationList.find(item => item.id === currentConversationId)

    return conversationItem
  }, [conversationList, currentConversationId, pinnedConversationList])

  const { notify } = useToastContext()
  const checkInputsRequired = useCallback((silent?: boolean) => {
    if (inputsForms.length) {
      for (let i = 0; i < inputsForms.length; i += 1) {
        const item = inputsForms[i]

        if (item.required && !newConversationInputsRef.current[item.variable]) {
          if (!silent) {
            notify({
              type: 'error',
              message: t('appDebug.errorMessage.valueOfVarRequired', { key: item.variable }),
            })
          }
          return
        }
      }
      return true
    }

    return true
  }, [inputsForms, notify, t])
  const handleStartChat = useCallback(() => {
    if (checkInputsRequired()) {
      setShowConfigPanelBeforeChat(false)
      setShowNewConversationItemInList(true)
    }
  }, [setShowConfigPanelBeforeChat, setShowNewConversationItemInList, checkInputsRequired])
  const currentChatInstanceRef = useRef<{ handleStop: () => void }>({ handleStop: () => { } })
  const handleChangeConversation = useCallback((conversationId: string) => {
    currentChatInstanceRef.current.handleStop()
    setNewConversationId('')
    handleConversationIdInfoChange(conversationId)

    if (conversationId === '' && !checkInputsRequired(true))
      setShowConfigPanelBeforeChat(true)
    else
      setShowConfigPanelBeforeChat(false)
  }, [handleConversationIdInfoChange, setShowConfigPanelBeforeChat, checkInputsRequired])
  const handleNewConversation = useCallback(() => {
    currentChatInstanceRef.current.handleStop()
    setNewConversationId('')

    if (showNewConversationItemInList) {
      handleChangeConversation('')
    }
    else if (currentConversationId) {
      handleConversationIdInfoChange('')
      setShowConfigPanelBeforeChat(true)
      setShowNewConversationItemInList(true)
      handleNewConversationInputsChange({})
    }
  }, [handleChangeConversation, currentConversationId, handleConversationIdInfoChange, setShowConfigPanelBeforeChat, setShowNewConversationItemInList, showNewConversationItemInList, handleNewConversationInputsChange])

  const handleNewConversationCompleted = useCallback((newConversationId: string) => {
    setNewConversationId(newConversationId)
    handleConversationIdInfoChange(newConversationId)
    setShowNewConversationItemInList(false)
    mutateAppConversationData()
  }, [mutateAppConversationData, handleConversationIdInfoChange])

  const handleFeedback = useCallback(async (messageId: string, feedback: Feedback) => {
    await updateFeedback({ url: `/messages/${messageId}/feedbacks`, body: { rating: feedback.rating } }, isInstalledApp, appId)
    notify({ type: 'success', message: t('common.api.success') })
  }, [isInstalledApp, appId, t, notify])

  return {
    appInfoError,
    appInfoLoading,
    isInstalledApp,
    appId,
    currentConversationId,
    currentConversationItem,
    handleConversationIdInfoChange,
    appData,
    appParams: appParams || {} as ChatConfig,
    appMeta,
    appPinnedConversationData,
    appConversationData,
    appConversationDataLoading,
    appChatListData,
    appChatListDataLoading,
    appPrevChatList,
    pinnedConversationList,
    conversationList,
    showConfigPanelBeforeChat,
    setShowConfigPanelBeforeChat,
    setShowNewConversationItemInList,
    newConversationInputs,
    handleNewConversationInputsChange,
    inputsForms,
    handleNewConversation,
    handleStartChat,
    handleChangeConversation,
    handleNewConversationCompleted,
    newConversationId,
    chatShouldReloadKey,
    handleFeedback,
    currentChatInstanceRef,
  }
}
