import { createLocalStorageState } from 'foxact/create-local-storage-state'
import { CONVERSATION_ID_INFO } from '@/app/components/base/chat/constants'

export const [
  useConversationIdInfo,
  useConversationIdInfoValue,
  useSetConversationIdInfo,
] = createLocalStorageState<Record<string, Record<string, string>>>(CONVERSATION_ID_INFO, {})
