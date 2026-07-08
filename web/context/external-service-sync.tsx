'use client'

import { useAtomValue } from 'jotai'
import { amplitudeIdentitySyncAtom } from './amplitude-identity-sync'
import { zendeskConversationSyncAtom } from './zendesk-conversation-sync'

export function ExternalServiceSync() {
  useAtomValue(zendeskConversationSyncAtom)
  useAtomValue(amplitudeIdentitySyncAtom)

  return null
}
