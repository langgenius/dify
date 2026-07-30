import { createLocalStorageState } from 'foxact/create-local-storage-state'
import { CONVERSATION_ID_INFO } from './constants'

const getSessionStorage = (): Storage | null => {
  try {
    if (typeof window === 'undefined') return null
    return window.sessionStorage
  } catch {
    return null
  }
}

export const getChatInputDraft = (draftKey?: string) => {
  if (!draftKey) return ''

  const storage = getSessionStorage()
  if (!storage) return ''

  try {
    return storage.getItem(draftKey) || ''
  } catch {
    return ''
  }
}

export const setChatInputDraft = (draftKey: string | undefined, draft: string) => {
  if (!draftKey) return

  const storage = getSessionStorage()
  if (!storage) return

  try {
    if (draft) storage.setItem(draftKey, draft)
    else storage.removeItem(draftKey)
  } catch {}
}

const [useConversationIdInfo, _useConversationIdInfoValue, _useSetConversationIdInfo] =
  createLocalStorageState<Record<string, Record<string, string>>>(CONVERSATION_ID_INFO, {})

const [
  useWebAppSidebarCollapseState,
  _useWebAppSidebarCollapseStateValue,
  _useSetWebAppSidebarCollapseState,
] = createLocalStorageState<string>('webappSidebarCollapse', undefined, { raw: true })

export { useConversationIdInfo, useWebAppSidebarCollapseState }
