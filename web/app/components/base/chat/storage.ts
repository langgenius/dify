import { createLocalStorageState } from 'foxact/create-local-storage-state'
import { CONVERSATION_ID_INFO } from './constants'

const [useConversationIdInfo, _useConversationIdInfoValue, _useSetConversationIdInfo] =
  createLocalStorageState<Record<string, Record<string, string>>>(CONVERSATION_ID_INFO, {})

const [
  useWebAppSidebarCollapseState,
  _useWebAppSidebarCollapseStateValue,
  _useSetWebAppSidebarCollapseState,
] = createLocalStorageState<string>('webappSidebarCollapse', undefined, { raw: true })

export { useConversationIdInfo, useWebAppSidebarCollapseState }
