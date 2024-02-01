import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { useLocalStorageState } from 'ahooks'
import type {
  ChatConfig,
  ChatItem,
} from '../types'
import { CONVERSATION_ID_INFO } from '../constants'
import {
  fetchAppInfo,
  fetchAppMeta,
  fetchAppParams,
  fetchChatList,
  fetchConversations,
} from '@/service/share'
import type { InstalledApp } from '@/models/explore'
import type { AppData } from '@/models/share'
import { addFileInfos, sortAgentSorts } from '@/app/components/tools/utils'
import { useToastContext } from '@/app/components/base/toast'

export const useChatWithHistory = (installedAppInfo?: InstalledApp) => {
  const isInstalledApp = useMemo(() => !!installedAppInfo, [installedAppInfo])
  const { data: appInfo } = useSWR(installedAppInfo ? null : 'appInfo', fetchAppInfo)

  const appData = useMemo(() => {
    if (isInstalledApp) {
      const { id, app } = installedAppInfo!
      return {
        app_id: id,
        site: { title: app.name, icon: app.icon, icon_background: app.icon_background, prompt_public: false, copyright: '' },
        plan: 'basic',
      } as AppData
    }

    return appInfo
  }, [isInstalledApp, installedAppInfo, appInfo])
  const [conversationIdInfo, setConversationIdInfo] = useLocalStorageState<Record<string, string>>(CONVERSATION_ID_INFO, {
    defaultValue: {},
  })
  const currentConversationId = useMemo(() => {
    return conversationIdInfo?.[appData?.app_id || ''] || ''
  }, [appData, conversationIdInfo])

  const [showConfigPanel, setShowConfigPanel] = useState(!currentConversationId)
  const handleCurrentConversationIdChange = useCallback((newConversationId: string) => {
    if (appData?.app_id) {
      setConversationIdInfo({
        ...conversationIdInfo,
        [appData?.app_id || '']: newConversationId,
      })
    }
  }, [appData, conversationIdInfo, setConversationIdInfo])
  const { data: appParams } = useSWR(['appParams', isInstalledApp, appData?.app_id], () => fetchAppParams(isInstalledApp, appData?.app_id))
  const { data: appMeta } = useSWR(['appMeta', isInstalledApp, appData?.app_id], () => fetchAppMeta(isInstalledApp, appData?.app_id))
  const { data: appPinnedConversationData } = useSWR(['appConversationData', isInstalledApp, appData?.app_id, true], () => fetchConversations(isInstalledApp, appData?.app_id, undefined, true, 100))
  const { data: appConversationData } = useSWR(['appConversationData', isInstalledApp, appData?.app_id, false], () => fetchConversations(isInstalledApp, appData?.app_id, undefined, false, 100))
  const { data: appChatListData, isLoading: appChatListDataLoading } = useSWR(currentConversationId ? ['appChatList', currentConversationId, isInstalledApp, appData?.app_id] : null, () => fetchChatList(currentConversationId, isInstalledApp, appData?.app_id))

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
  const [newConversationInputs, setNewConversationInputs] = useState<Record<string, any>>({})
  const inputsForms = useMemo(() => {
    return (appParams?.user_input_form || []).filter((item: any) => item.paragraph || item.select || item['text-input']).map((item: any) => {
      if (item.paragraph) {
        return {
          ...item.paragraph,
          type: 'paragraph',
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
    setNewConversationInputs(conversationInputs)
  }, [inputsForms])
  const conversationList = useMemo(() => {
    const data = appConversationData?.data || []

    if (showNewConversationItemInList && data[0]?.id !== '') {
      data.unshift({
        id: '',
        name: t('share.chat.newChatDefaultName'),
        inputs: {},
        introduction: '',
      })
    }
    return data
  }, [appConversationData, showNewConversationItemInList, t])
  const currentConversationItem = useMemo(() => {
    let coversationItem = conversationList.find(item => item.id === currentConversationId)

    if (!coversationItem && pinnedConversationList.length)
      coversationItem = pinnedConversationList.find(item => item.id === currentConversationId)

    return coversationItem
  }, [conversationList, currentConversationId, pinnedConversationList])

  const handleNewConversation = useCallback(() => {
    if (currentConversationId) {
      handleCurrentConversationIdChange('')
      setShowConfigPanel(true)
      setShowNewConversationItemInList(true)
    }
  }, [
    currentConversationId,
    handleCurrentConversationIdChange,
    setShowConfigPanel,
    setShowNewConversationItemInList,
  ])
  const { notify } = useToastContext()
  const handleStartChat = useCallback(() => {
    if (inputsForms.length) {
      for (let i = 0; i < inputsForms.length; i += 1) {
        const item = inputsForms[i]

        if (item.required && !newConversationInputs[item.variable]) {
          notify({
            type: 'error',
            message: t('appDebug.errorMessage.valueOfVarRequired', { key: item.variable }),
          })
          return
        }
      }
    }
    setShowConfigPanel(false)
    setShowNewConversationItemInList(true)
  }, [
    setShowConfigPanel,
    setShowNewConversationItemInList,
    notify,
    t,
    newConversationInputs,
    inputsForms,
  ])

  return {
    currentConversationId,
    currentConversationItem,
    handleCurrentConversationIdChange,
    appData,
    appParams: appParams || {} as ChatConfig,
    appMeta,
    appPinnedConversationData,
    appConversationData,
    appChatListData,
    appChatListDataLoading,
    appPrevChatList,
    pinnedConversationList,
    conversationList,
    showConfigPanel,
    setShowConfigPanel,
    setShowNewConversationItemInList,
    newConversationInputs,
    setNewConversationInputs,
    inputsForms,
    handleNewConversation,
    handleStartChat,
  }
}
