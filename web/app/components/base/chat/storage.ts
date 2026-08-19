import { createLocalStorageState } from 'foxact/create-local-storage-state'
import { createSessionStorageState } from 'foxact/create-session-storage-state'
import { useCallback, useEffect } from 'react'
import { CONVERSATION_ID_INFO, TAB_CONVERSATION_ID_INFO } from './constants'

type ConversationIdInfo = Record<string, Record<string, string>>

const [useLastConversationIdInfo, _useLastConversationIdInfoValue, _useSetLastConversationIdInfo] =
  createLocalStorageState<ConversationIdInfo>(CONVERSATION_ID_INFO, {})

const [useTabConversationIdInfo, _useTabConversationIdInfoValue, _useSetTabConversationIdInfo] =
  createSessionStorageState<ConversationIdInfo>(TAB_CONVERSATION_ID_INFO, {})

const [
  useWebAppSidebarCollapseState,
  _useWebAppSidebarCollapseStateValue,
  _useSetWebAppSidebarCollapseState,
] = createLocalStorageState<string>('webappSidebarCollapse', undefined, { raw: true })

const getAppConversationIds = (conversationIdInfo: ConversationIdInfo | null, appId: string) => {
  const appConversationIds = conversationIdInfo?.[appId]
  return typeof appConversationIds === 'object' && appConversationIds !== null
    ? appConversationIds
    : undefined
}

const hasConversationId = (
  conversationIdInfo: ConversationIdInfo | null,
  appId: string,
  userId: string,
) => Object.hasOwn(getAppConversationIds(conversationIdInfo, appId) ?? {}, userId)

const getConversationId = (
  conversationIdInfo: ConversationIdInfo | null,
  appId: string,
  userId: string,
) => getAppConversationIds(conversationIdInfo, appId)?.[userId] ?? ''

const setConversationId = (
  conversationIdInfo: ConversationIdInfo | null,
  appId: string,
  userId: string,
  conversationId: string,
): ConversationIdInfo => ({
  ...(conversationIdInfo ?? {}),
  [appId]: {
    ...getAppConversationIds(conversationIdInfo, appId),
    [userId]: conversationId,
  },
})

const removeAppConversationIds = (
  conversationIdInfo: ConversationIdInfo | null,
  appId: string,
): ConversationIdInfo => {
  const nextConversationIdInfo = { ...(conversationIdInfo ?? {}) }
  delete nextConversationIdInfo[appId]
  return nextConversationIdInfo
}

type UseConversationSelectionOptions = {
  appId?: string
  userId?: string
  conversationId?: string
}

const useConversationSelection = ({
  appId,
  userId,
  conversationId,
}: UseConversationSelectionOptions) => {
  const [lastConversationIdInfo, setLastConversationIdInfo] = useLastConversationIdInfo()
  const [tabConversationIdInfo, setTabConversationIdInfo] = useTabConversationIdInfo()
  const storageAppId = appId ?? ''
  const storageUserId = userId || 'DEFAULT'
  const hasTabConversationId =
    !!appId && hasConversationId(tabConversationIdInfo, storageAppId, storageUserId)
  const lastConversationId = appId
    ? getConversationId(lastConversationIdInfo, storageAppId, storageUserId)
    : ''
  const tabConversationId = appId
    ? getConversationId(tabConversationIdInfo, storageAppId, storageUserId)
    : ''

  // Seed this tab once from the cross-tab last selection. Later localStorage updates can change
  // the fallback without changing the active conversation already owned by this tab.
  useEffect(() => {
    if (!appId || hasTabConversationId) return

    setTabConversationIdInfo((currentConversationIdInfo) => {
      if (hasConversationId(currentConversationIdInfo, appId, storageUserId))
        return currentConversationIdInfo

      return setConversationId(currentConversationIdInfo, appId, storageUserId, lastConversationId)
    })
  }, [appId, hasTabConversationId, lastConversationId, setTabConversationIdInfo, storageUserId])

  const handleConversationIdInfoChange = useCallback(
    (nextConversationId: string) => {
      if (!appId) return

      setTabConversationIdInfo((currentConversationIdInfo) =>
        setConversationId(currentConversationIdInfo, appId, storageUserId, nextConversationId),
      )
      setLastConversationIdInfo((currentConversationIdInfo) =>
        setConversationId(currentConversationIdInfo, appId, storageUserId, nextConversationId),
      )
    },
    [appId, setLastConversationIdInfo, setTabConversationIdInfo, storageUserId],
  )

  const removeConversationIdInfo = useCallback(
    (targetAppId: string) => {
      setTabConversationIdInfo((currentConversationIdInfo) => {
        const nextConversationIdInfo = removeAppConversationIds(
          currentConversationIdInfo,
          targetAppId,
        )
        if (targetAppId !== appId) return nextConversationIdInfo

        // An explicit empty entry keeps this tab on New Chat instead of falling back to a last
        // conversation that another tab may write after the reset.
        return setConversationId(nextConversationIdInfo, targetAppId, storageUserId, '')
      })
      setLastConversationIdInfo((currentConversationIdInfo) =>
        removeAppConversationIds(currentConversationIdInfo, targetAppId),
      )
    },
    [appId, setLastConversationIdInfo, setTabConversationIdInfo, storageUserId],
  )

  return {
    currentConversationId:
      conversationId || (hasTabConversationId ? tabConversationId : lastConversationId),
    handleConversationIdInfoChange,
    removeConversationIdInfo,
  }
}

export { useConversationSelection, useWebAppSidebarCollapseState }
