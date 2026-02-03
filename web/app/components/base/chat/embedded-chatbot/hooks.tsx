/* eslint-disable ts/no-explicit-any */
import type {
  ChatConfig,
  ChatItem,
  Feedback,
} from '../types'
import type { InputValueTypes } from '@/app/components/share/text-generation/types'
import type { Locale } from '@/i18n-config'
import type {
  AppData,
  ConversationItem,
} from '@/models/share'
import { useLocalStorageState } from 'ahooks'
import { noop } from 'es-toolkit/function'
import { produce } from 'immer'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useToastContext } from '@/app/components/base/toast'
import { addFileInfos, sortAgentSorts } from '@/app/components/tools/utils'
import { InputVarType } from '@/app/components/workflow/types'
import { useWebAppStore } from '@/context/web-app-context'
import { changeLanguage } from '@/i18n-config/client'
import { AppSourceType, updateFeedback } from '@/service/share'
import {
  useInvalidateShareConversations,
  useShareChatList,
  useShareConversationName,
  useShareConversations,
} from '@/service/use-share'
import { useGetTryAppInfo, useGetTryAppParams } from '@/service/use-try-app'
import { TransferMethod } from '@/types/app'
import { getProcessedFilesFromResponse } from '../../file-uploader/utils'
import { CONVERSATION_ID_INFO } from '../constants'
import { buildChatItemTree, getProcessedInputsFromUrlParams, getProcessedSystemVariablesFromUrlParams, getProcessedUserVariablesFromUrlParams } from '../utils'

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

export const useEmbeddedChatbot = (appSourceType: AppSourceType, tryAppId?: string) => {
  const isInstalledApp = false // just can be webapp and try app
  const isTryApp = appSourceType === AppSourceType.tryApp
  const { data: tryAppInfo } = useGetTryAppInfo(isTryApp ? tryAppId! : '')
  const webAppInfo = useWebAppStore(s => s.appInfo)
  const appInfo = isTryApp ? tryAppInfo : webAppInfo
  const appMeta = useWebAppStore(s => s.appMeta)
  const { data: tryAppParams } = useGetTryAppParams(isTryApp ? tryAppId! : '')
  const webAppParams = useWebAppStore(s => s.appParams)
  const appParams = isTryApp ? tryAppParams : webAppParams

  const appId = useMemo(() => {
    return isTryApp ? tryAppId : (appInfo as any)?.app_id
  }, [appInfo, isTryApp, tryAppId])

  const embeddedConversationId = useWebAppStore(s => s.embeddedConversationId)
  const embeddedUserId = useWebAppStore(s => s.embeddedUserId)

  const [userId, setUserId] = useState<string>()
  const [conversationId, setConversationId] = useState<string>()

  useEffect(() => {
    if (isTryApp)
      return
    getProcessedSystemVariablesFromUrlParams().then(({ user_id, conversation_id }) => {
      setUserId(user_id)
      setConversationId(conversation_id)
    })
  }, [])

  useEffect(() => {
    setUserId(embeddedUserId || undefined)
  }, [embeddedUserId])

  useEffect(() => {
    setConversationId(embeddedConversationId || undefined)
  }, [embeddedConversationId])

  useEffect(() => {
    if (isTryApp)
      return
    const setLanguageFromParams = async () => {
      // Check URL parameters for language override
      const urlParams = new URLSearchParams(window.location.search)
      const localeParam = urlParams.get('locale')

      // Check for encoded system variables
      const systemVariables = await getProcessedSystemVariablesFromUrlParams()
      const localeFromSysVar = systemVariables.locale

      if (localeParam) {
        // If locale parameter exists in URL, use it instead of default
        await changeLanguage(localeParam as Locale)
      }
      else if (localeFromSysVar) {
        // If locale is set as a system variable, use that
        await changeLanguage(localeFromSysVar)
      }
      else if ((appInfo as unknown as AppData)?.site?.default_language) {
        // Otherwise use the default from app config
        await changeLanguage((appInfo as unknown as AppData).site?.default_language)
      }
    }

    setLanguageFromParams()
  }, [appInfo])

  const [conversationIdInfo, setConversationIdInfo] = useLocalStorageState<Record<string, Record<string, string>>>(CONVERSATION_ID_INFO, {
    defaultValue: {},
  })
  const removeConversationIdInfo = useCallback((appId: string) => {
    setConversationIdInfo((prev) => {
      const newInfo = { ...prev }
      delete newInfo[appId]
      return newInfo
    })
  }, [setConversationIdInfo])
  const allowResetChat = !conversationId
  const currentConversationId = useMemo(() => conversationIdInfo?.[appId || '']?.[userId || 'DEFAULT'] || conversationId || '', [appId, conversationIdInfo, userId, conversationId])
  const handleConversationIdInfoChange = useCallback((changeConversationId: string) => {
    if (appId) {
      let prevValue = conversationIdInfo?.[appId || '']
      if (typeof prevValue === 'string')
        prevValue = {}
      setConversationIdInfo({
        ...conversationIdInfo,
        [appId || '']: {
          ...prevValue,
          [userId || 'DEFAULT']: changeConversationId,
        },
      })
    }
  }, [appId, conversationIdInfo, setConversationIdInfo, userId])

  const [newConversationId, setNewConversationId] = useState('')
  const chatShouldReloadKey = useMemo(() => {
    if (currentConversationId === newConversationId)
      return ''

    return currentConversationId
  }, [currentConversationId, newConversationId])

  const { data: appPinnedConversationData } = useShareConversations({
    appSourceType,
    appId,
    pinned: true,
    limit: 100,
  })
  const {
    data: appConversationData,
    isLoading: appConversationDataLoading,
  } = useShareConversations({
    appSourceType,
    appId,
    pinned: false,
    limit: 100,
  })
  const {
    data: appChatListData,
    isLoading: appChatListDataLoading,
  } = useShareChatList({
    conversationId: chatShouldReloadKey,
    appSourceType,
    appId,
  })
  const invalidateShareConversations = useInvalidateShareConversations()

  const [clearChatList, setClearChatList] = useState(false)
  const [isResponding, setIsResponding] = useState(false)
  const appPrevChatList = useMemo(
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
  const [initInputs, setInitInputs] = useState<Record<string, any>>({})
  const [initUserVariables, setInitUserVariables] = useState<Record<string, any>>({})
  const handleNewConversationInputsChange = useCallback((newInputs: Record<string, any>) => {
    newConversationInputsRef.current = newInputs
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setNewConversationInputs(newInputs)
  }, [])
  const inputsForms = useMemo(() => {
    return (appParams?.user_input_form || []).filter((item: any) => !item.external_data_tool).map((item: any) => {
      if (item.paragraph) {
        let value = initInputs[item.paragraph.variable]
        if (value && item.paragraph.max_length && value.length > item.paragraph.max_length)
          value = value.slice(0, item.paragraph.max_length)

        return {
          ...item.paragraph,
          default: value || item.default || item.paragraph.default,
          type: 'paragraph',
        }
      }
      if (item.number) {
        const convertedNumber = Number(initInputs[item.number.variable])
        return {
          ...item.number,
          default: convertedNumber || item.default || item.number.default,
          type: 'number',
        }
      }

      if (item.checkbox) {
        const preset = initInputs[item.checkbox.variable] === true
        return {
          ...item.checkbox,
          default: preset || item.default || item.checkbox.default,
          type: 'checkbox',
        }
      }

      if (item.select) {
        const isInputInOptions = item.select.options.includes(initInputs[item.select.variable])
        return {
          ...item.select,
          default: (isInputInOptions ? initInputs[item.select.variable] : undefined) || item.select.default,
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

      if (item.json_object) {
        return {
          ...item.json_object,
          type: 'json_object',
        }
      }

      let value = initInputs[item['text-input'].variable]
      if (value && item['text-input'].max_length && value.length > item['text-input'].max_length)
        value = value.slice(0, item['text-input'].max_length)

      return {
        ...item['text-input'],
        default: value || item.default || item['text-input'].default,
        type: 'text-input',
      }
    })
  }, [initInputs, appParams])

  const allInputsHidden = useMemo(() => {
    return inputsForms.length > 0 && inputsForms.every(item => item.hide === true)
  }, [inputsForms])

  useEffect(() => {
    // init inputs from url params
    (async () => {
      if (isTryApp)
        return
      const inputs = await getProcessedInputsFromUrlParams()
      const userVariables = await getProcessedUserVariablesFromUrlParams()
      setInitInputs(inputs)
      setInitUserVariables(userVariables)
    })()
  }, [])
  useEffect(() => {
    const conversationInputs: Record<string, InputValueTypes> = {}

    inputsForms.forEach((item) => {
      conversationInputs[item.variable] = item.default || null
    })
    handleNewConversationInputsChange(conversationInputs)
  }, [handleNewConversationInputsChange, inputsForms])

  const { data: newConversation } = useShareConversationName({
    conversationId: newConversationId,
    appSourceType,
    appId,
  }, {
    refetchOnWindowFocus: false,
    enabled: !isTryApp,
  })
  const [originConversationList, setOriginConversationList] = useState<ConversationItem[]>([])
  useEffect(() => {
    if (appConversationData?.data && !appConversationDataLoading)
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setOriginConversationList(appConversationData?.data)
  }, [appConversationData, appConversationDataLoading])
  const conversationList = useMemo(() => {
    const data = originConversationList.slice()

    if (showNewConversationItemInList && data[0]?.id !== '') {
      data.unshift({
        id: '',
        name: t('chat.newChatDefaultName', { ns: 'share' }),
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

  const currentConversationLatestInputs = useMemo(() => {
    if (!currentConversationId || !appChatListData?.data.length)
      return newConversationInputsRef.current || {}
    return appChatListData.data.slice().pop().inputs || {}
  }, [appChatListData, currentConversationId])
  const [currentConversationInputs, setCurrentConversationInputs] = useState<Record<string, any>>(currentConversationLatestInputs || {})
  useEffect(() => {
    if (currentConversationItem && !isTryApp)
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setCurrentConversationInputs(currentConversationLatestInputs || {})
  }, [currentConversationItem, currentConversationLatestInputs])

  const { notify } = useToastContext()
  const checkInputsRequired = useCallback((silent?: boolean) => {
    if (allInputsHidden)
      return true

    let hasEmptyInput = ''
    let fileIsUploading = false
    const requiredVars = inputsForms.filter(({ required, type }) => required && type !== InputVarType.checkbox)
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
      notify({ type: 'error', message: t('errorMessage.valueOfVarRequired', { ns: 'appDebug', key: hasEmptyInput }) })
      return false
    }

    if (fileIsUploading) {
      notify({ type: 'info', message: t('errorMessage.waitForFileUpload', { ns: 'appDebug' }) })
      return
    }

    return true
  }, [inputsForms, notify, t, allInputsHidden])
  const handleStartChat = useCallback((callback?: () => void) => {
    if (checkInputsRequired()) {
      setShowNewConversationItemInList(true)
      callback?.()
    }
  }, [setShowNewConversationItemInList, checkInputsRequired])
  const currentChatInstanceRef = useRef<{ handleStop: () => void }>({ handleStop: noop })
  const handleChangeConversation = useCallback((conversationId: string) => {
    currentChatInstanceRef.current.handleStop()
    setNewConversationId('')
    handleConversationIdInfoChange(conversationId)
    if (conversationId)
      setClearChatList(false)
  }, [handleConversationIdInfoChange, setClearChatList])
  const handleNewConversation = useCallback(async () => {
    if (isTryApp) {
      setClearChatList(true)
      return
    }

    currentChatInstanceRef.current.handleStop()
    setShowNewConversationItemInList(true)
    handleChangeConversation('')
    handleNewConversationInputsChange(await getProcessedInputsFromUrlParams())
    setClearChatList(true)
  }, [isTryApp, setShowNewConversationItemInList, handleNewConversationInputsChange, setClearChatList])

  const handleNewConversationCompleted = useCallback((newConversationId: string) => {
    setNewConversationId(newConversationId)
    handleConversationIdInfoChange(newConversationId)
    setShowNewConversationItemInList(false)
    invalidateShareConversations()
  }, [handleConversationIdInfoChange, invalidateShareConversations])

  const handleFeedback = useCallback(async (messageId: string, feedback: Feedback) => {
    await updateFeedback({ url: `/messages/${messageId}/feedbacks`, body: { rating: feedback.rating, content: feedback.content } }, appSourceType, appId)
    notify({ type: 'success', message: t('api.success', { ns: 'common' }) })
  }, [appSourceType, appId, t, notify])

  return {
    appSourceType,
    isInstalledApp,
    allowResetChat,
    appId,
    currentConversationId,
    currentConversationItem,
    removeConversationIdInfo,
    handleConversationIdInfoChange,
    appData: appInfo,
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
    setShowNewConversationItemInList,
    newConversationInputs,
    newConversationInputsRef,
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
    clearChatList,
    setClearChatList,
    isResponding,
    setIsResponding,
    currentConversationInputs,
    setCurrentConversationInputs,
    allInputsHidden,
    initUserVariables,
  }
}
