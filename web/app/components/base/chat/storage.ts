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

const getScopeConversationIds = (
  conversationIdInfo: ConversationIdInfo | null,
  scopeId: string,
) => {
  const scopeConversationIds = conversationIdInfo?.[scopeId]
  return typeof scopeConversationIds === 'object' && scopeConversationIds !== null
    ? scopeConversationIds
    : undefined
}

const hasConversationId = (
  conversationIdInfo: ConversationIdInfo | null,
  scopeId: string,
  userId: string,
) => Object.hasOwn(getScopeConversationIds(conversationIdInfo, scopeId) ?? {}, userId)

const getConversationId = (
  conversationIdInfo: ConversationIdInfo | null,
  scopeId: string,
  userId: string,
) => getScopeConversationIds(conversationIdInfo, scopeId)?.[userId] ?? ''

const setConversationId = (
  conversationIdInfo: ConversationIdInfo | null,
  scopeId: string,
  userId: string,
  conversationId: string,
): ConversationIdInfo => ({
  ...(conversationIdInfo ?? {}),
  [scopeId]: {
    ...getScopeConversationIds(conversationIdInfo, scopeId),
    [userId]: conversationId,
  },
})

const removeScopeConversationIds = (
  conversationIdInfo: ConversationIdInfo | null,
  scopeId: string,
): ConversationIdInfo => {
  const nextConversationIdInfo = { ...(conversationIdInfo ?? {}) }
  delete nextConversationIdInfo[scopeId]
  return nextConversationIdInfo
}

type UseConversationSelectionOptions = {
  scopeId?: string
  userId?: string
  conversationId?: string
}

const useConversationSelection = ({
  scopeId,
  userId,
  conversationId,
}: UseConversationSelectionOptions) => {
  const [lastConversationIdInfo, setLastConversationIdInfo] = useLastConversationIdInfo()
  const [tabConversationIdInfo, setTabConversationIdInfo] = useTabConversationIdInfo()
  const storageScopeId = scopeId ?? ''
  const storageUserId = userId || 'DEFAULT'
  const hasTabConversationId =
    !!scopeId && hasConversationId(tabConversationIdInfo, storageScopeId, storageUserId)
  const lastConversationId = scopeId
    ? getConversationId(lastConversationIdInfo, storageScopeId, storageUserId)
    : ''
  const tabConversationId = scopeId
    ? getConversationId(tabConversationIdInfo, storageScopeId, storageUserId)
    : ''

  // Seed this tab once from the cross-tab last selection. Later localStorage updates can change
  // the fallback without changing the active conversation already owned by this tab.
  useEffect(() => {
    if (!scopeId || hasTabConversationId) return

    setTabConversationIdInfo((currentConversationIdInfo) => {
      if (hasConversationId(currentConversationIdInfo, scopeId, storageUserId))
        return currentConversationIdInfo

      return setConversationId(
        currentConversationIdInfo,
        scopeId,
        storageUserId,
        lastConversationId,
      )
    })
  }, [scopeId, hasTabConversationId, lastConversationId, setTabConversationIdInfo, storageUserId])

  const handleConversationIdInfoChange = useCallback(
    (nextConversationId: string) => {
      if (!scopeId) return

      setTabConversationIdInfo((currentConversationIdInfo) =>
        setConversationId(currentConversationIdInfo, scopeId, storageUserId, nextConversationId),
      )
      setLastConversationIdInfo((currentConversationIdInfo) =>
        setConversationId(currentConversationIdInfo, scopeId, storageUserId, nextConversationId),
      )
    },
    [scopeId, setLastConversationIdInfo, setTabConversationIdInfo, storageUserId],
  )

  const removeConversationIdInfo = useCallback(() => {
    if (!scopeId) return

    setTabConversationIdInfo((currentConversationIdInfo) => {
      const nextConversationIdInfo = removeScopeConversationIds(currentConversationIdInfo, scopeId)

      // An explicit empty entry keeps this tab on New Chat instead of falling back to a last
      // conversation that another tab may write after the reset.
      return setConversationId(nextConversationIdInfo, scopeId, storageUserId, '')
    })
    setLastConversationIdInfo((currentConversationIdInfo) =>
      removeScopeConversationIds(currentConversationIdInfo, scopeId),
    )
  }, [scopeId, setLastConversationIdInfo, setTabConversationIdInfo, storageUserId])

  return {
    currentConversationId:
      conversationId || (hasTabConversationId ? tabConversationId : lastConversationId),
    handleConversationIdInfoChange,
    removeConversationIdInfo,
  }
}

export { useConversationSelection, useWebAppSidebarCollapseState }
