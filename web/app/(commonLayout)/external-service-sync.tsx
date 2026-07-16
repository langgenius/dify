'use client'

import { useAtomValue } from 'jotai'
import { amplitudeIdentitySyncAtom } from '@/context/amplitude-identity-sync'
import { zendeskConversationSyncAtom } from '@/context/zendesk-conversation-sync'

export function ExternalServiceSync() {
  useAtomValue(zendeskConversationSyncAtom)
  useAtomValue(amplitudeIdentitySyncAtom)

  return null
}
