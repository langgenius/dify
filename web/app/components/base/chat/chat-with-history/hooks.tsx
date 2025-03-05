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
  Callback,
  ChatConfig,
  ChatItem,
  Feedback,
} from '../types'
import { CONVERSATION_ID_INFO } from '../constants'
import { buildChatItemTree } from '../utils'
import { addFileInfos, sortAgentSorts } from '../../../tools/utils'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import {
  delConversation,
  fetchAppInfo,
  fetchAppMeta,
  fetchAppParams,
  fetchChatList,
  fetchConversations,
  generationConversationName,
  pinConversation,
  renameConversation,
  unpinConversation,
  updateFeedback,
} from '@/service/share'
import type { InstalledApp } from '@/models/explore'
import type {
  AppData,
  ConversationItem,
} from '@/models/share'
import { useToastContext } from '@/app/components/base/toast'
import { changeLanguage } from '@/i18n/i18next-config'
import { useAppFavicon } from '@/hooks/use-app-favicon'
import { InputVarType } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'

function getFormattedChatList(messages: any[]) {
  const newChatList: ChatItem[] = []
  messages.forEach((item) => {
    const questionFiles = item.message_files?.filter((file: any) => file.belongs_to === 'user') || []
    newChatList.push({
      id: `question-${item.id}`,
      content: item.query,
      isAnswer: false,
      message_files: getProcessedFilesFromResponse(questionFiles.map((item: any) => ({ ...item, related_id: item.id }))),
      parentMessageId: item.parent_message_id || undefined,
    })
    const answerFiles = item.message_files?.filter((file: any) => file.belongs_to === 'assistant') || []
    newChatList.push({
      id: item.id,
      content: item.answer,
      agent_thoughts: addFileInfos(item.agent_thoughts ? sortAgentSorts(item.agent_thoughts) : item.agent_thoughts, item.message_files),
      feedback: item.feedback,
      isAnswer: true,
      citation: item.retriever_resources,
      message_files: getProcessedFilesFromResponse(answerFiles.map((item: any) => ({ ...item, related_id: item.id }))),
      parentMessageId: `question-${item.id}`,
    })
  })
  return newChatList
}

export const useChatWithHistory = (installedAppInfo?: InstalledApp) => {
  const isInstalledApp = useMemo(() => !!installedAppInfo, [installedAppInfo])
  const { data: appInfo, isLoading: appInfoLoading, error: appInfoError } = useSWR(installedAppInfo ? null : 'appInfo', fetchAppInfo)

  useAppFavicon({
    enable: !installedAppInfo,
    icon_type: appInfo?.site.icon_type,
    icon: appInfo?.site.icon,
    icon_background: appInfo?.site.icon_background,
    icon_url: appInfo?.site.icon_url,
  })

  const appData = useMemo(() => {
    if (isInstalledApp) {
      const { id, app } = installedAppInfo!
      return {
        app_id: id,
        site: {
          title: app.name,
          icon_type: app.icon_type,
          icon: app.icon,
          icon_background: app.icon_background,
          icon_url: app.icon_url,
          prompt_public: false,
          copyright: '',
          show_workflow_steps: true,
          use_icon_as_answer_icon: app.use_icon_as_answer_icon,
        },
        plan: 'basic',
      } as AppData
    }

    return appInfo
  }, [isInstalledApp, installedAppInfo, appInfo])
  const appId = useMemo(() => appData?.app_id, [appData])

  useEffect(() => {
    if (appData?.site.default_language)
      changeLanguage(appData.site.default_language)
  }, [appData])

  const [sidebarCollapseState, setSidebarCollapseState] = useState<boolean>(false)
  const handleSidebarCollapse = useCallback((state: boolean) => {
    if (appId) {
      setSidebarCollapseState(state)
      localStorage.setItem('webappSidebarCollapse', state ? 'collapsed' : 'expanded')
    }
  }, [appId, setSidebarCollapseState])
  useEffect(() => {
    if (appId) {
      const localState = localStorage.getItem('webappSidebarCollapse')
      setSidebarCollapseState(localState === 'collapsed')
    }
  }, [appId])
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

  const [newConversationId, setNewConversationId] = useState('')
  const chatShouldReloadKey = useMemo(() => {
    if (currentConversationId === newConversationId)
      return ''

    return currentConversationId
  }, [currentConversationId, newConversationId])

  const { data: appParams } = useSWR(['appParams', isInstalledApp, appId], () => fetchAppParams(isInstalledApp, appId))
  const { data: appMeta } = useSWR(['appMeta', isInstalledApp, appId], () => fetchAppMeta(isInstalledApp, appId))
  const { data: appPinnedConversationData, mutate: mutateAppPinnedConversationData } = useSWR(['appConversationData', isInstalledApp, appId, true], () => fetchConversations(isInstalledApp, appId, undefined, true, 100))
  const { data: appConversationData, isLoading: appConversationDataLoading, mutate: mutateAppConversationData } = useSWR(['appConversationData', isInstalledApp, appId, false], () => fetchConversations(isInstalledApp, appId, undefined, false, 100))
  const { data: appChatListData, isLoading: appChatListDataLoading } = useSWR(chatShouldReloadKey ? ['appChatList', chatShouldReloadKey, isInstalledApp, appId] : null, () => fetchChatList(chatShouldReloadKey, isInstalledApp, appId))

  const appPrevChatTree = useMemo(
    () => (currentConversationId && appChatListData?.data.length)
      ? buildChatItemTree(getFormattedChatList(appChatListData.data))
      : [],
    [appChatListData, currentConversationId],
  )

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
    return (appParams?.user_input_form || []).filter((item: any) => !item.external_data_tool).map((item: any) => {
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

      if (item['file-list']) {
        return {
          ...item['file-list'],
          type: 'file-list',
        }
      }

      if (item.file) {
        return {
          ...item.file,
          type: 'file',
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
      conversationInputs[item.variable] = item.default || null
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
    let hasEmptyInput = ''
    let fileIsUploading = false
    const requiredVars = inputsForms.filter(({ required }) => required)
    if (requiredVars.length) {
      requiredVars.forEach(({ variable, label, type }) => {
        if (hasEmptyInput)
          return

        if (fileIsUploading)
          return

        if (!newConversationInputsRef.current[variable] && !silent)
          hasEmptyInput = label as string

        if ((type === InputVarType.singleFile || type === InputVarType.multiFiles) && newConversationInputsRef.current[variable] && !silent) {
          const files = newConversationInputsRef.current[variable]
          if (Array.isArray(files))
            fileIsUploading = files.find(item => item.transferMethod === TransferMethod.local_file && !item.uploadedId)
          else
            fileIsUploading = files.transferMethod === TransferMethod.local_file && !files.uploadedId
        }
      })
    }

    if (hasEmptyInput) {
      notify({ type: 'error', message: t('appDebug.errorMessage.valueOfVarRequired', { key: hasEmptyInput }) })
      return false
    }

    if (fileIsUploading) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForFileUpload') })
      return
    }

    return true
  }, [inputsForms, notify, t])
  const handleStartChat = useCallback((callback: any) => {
    if (checkInputsRequired()) {
      setShowNewConversationItemInList(true)
      callback?.()
    }
  }, [setShowNewConversationItemInList, checkInputsRequired])
  const currentChatInstanceRef = useRef<{ handleStop: () => void }>({ handleStop: () => { } })
  const handleChangeConversation = useCallback((conversationId: string) => {
    currentChatInstanceRef.current.handleStop()
    setNewConversationId('')
    handleConversationIdInfoChange(conversationId)
  }, [handleConversationIdInfoChange])
  const handleNewConversation = useCallback(() => {
    currentChatInstanceRef.current.handleStop()
    setNewConversationId('')

    if (showNewConversationItemInList) {
      handleChangeConversation('')
    }
    else if (currentConversationId) {
      handleConversationIdInfoChange('')
      setShowNewConversationItemInList(true)
      handleNewConversationInputsChange({})
    }
  }, [handleChangeConversation, currentConversationId, handleConversationIdInfoChange, setShowNewConversationItemInList, showNewConversationItemInList, handleNewConversationInputsChange])
  const handleUpdateConversationList = useCallback(() => {
    mutateAppConversationData()
    mutateAppPinnedConversationData()
  }, [mutateAppConversationData, mutateAppPinnedConversationData])

  const handlePinConversation = useCallback(async (conversationId: string) => {
    await pinConversation(isInstalledApp, appId, conversationId)
    notify({ type: 'success', message: t('common.api.success') })
    handleUpdateConversationList()
  }, [isInstalledApp, appId, notify, t, handleUpdateConversationList])

  const handleUnpinConversation = useCallback(async (conversationId: string) => {
    await unpinConversation(isInstalledApp, appId, conversationId)
    notify({ type: 'success', message: t('common.api.success') })
    handleUpdateConversationList()
  }, [isInstalledApp, appId, notify, t, handleUpdateConversationList])

  const [conversationDeleting, setConversationDeleting] = useState(false)
  const handleDeleteConversation = useCallback(async (
    conversationId: string,
    {
      onSuccess,
    }: Callback,
  ) => {
    if (conversationDeleting)
      return

    try {
      setConversationDeleting(true)
      await delConversation(isInstalledApp, appId, conversationId)
      notify({ type: 'success', message: t('common.api.success') })
      onSuccess()
    }
    finally {
      setConversationDeleting(false)
    }

    if (conversationId === currentConversationId)
      handleNewConversation()

    handleUpdateConversationList()
  }, [isInstalledApp, appId, notify, t, handleUpdateConversationList, handleNewConversation, currentConversationId, conversationDeleting])

  const [conversationRenaming, setConversationRenaming] = useState(false)
  const handleRenameConversation = useCallback(async (
    conversationId: string,
    newName: string,
    {
      onSuccess,
    }: Callback,
  ) => {
    if (conversationRenaming)
      return

    if (!newName.trim()) {
      notify({
        type: 'error',
        message: t('common.chat.conversationNameCanNotEmpty'),
      })
      return
    }

    setConversationRenaming(true)
    try {
      await renameConversation(isInstalledApp, appId, conversationId, newName)

      notify({
        type: 'success',
        message: t('common.actionMsg.modifiedSuccessfully'),
      })
      setOriginConversationList(produce((draft) => {
        const index = originConversationList.findIndex(item => item.id === conversationId)
        const item = draft[index]

        draft[index] = {
          ...item,
          name: newName,
        }
      }))
      onSuccess()
    }
    finally {
      setConversationRenaming(false)
    }
  }, [isInstalledApp, appId, notify, t, conversationRenaming, originConversationList])

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
    appPrevChatTree,
    pinnedConversationList,
    conversationList,
    setShowNewConversationItemInList,
    newConversationInputs,
    newConversationInputsRef,
    handleNewConversationInputsChange,
    inputsForms,
    handleNewConversation,
    handleStartChat,
    handleChangeConversation,
    handlePinConversation,
    handleUnpinConversation,
    conversationDeleting,
    handleDeleteConversation,
    conversationRenaming,
    handleRenameConversation,
    handleNewConversationCompleted,
    newConversationId,
    chatShouldReloadKey,
    handleFeedback,
    currentChatInstanceRef,
    sidebarCollapseState,
    handleSidebarCollapse,
  }
}
