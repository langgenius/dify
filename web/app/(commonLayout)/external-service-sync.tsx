'use client'

import { useAtomValue } from 'jotai'
import { useAmplitudeInitialized } from '@/app/components/base/amplitude/use-amplitude-initialized'
import { useAnalyticsConsent } from '@/app/components/base/analytics-consent/consent-store'
import { amplitudeIdentitySyncAtom } from '@/context/amplitude-identity-sync'
import { zendeskConversationSyncAtom } from '@/context/zendesk-conversation-sync'

function AmplitudeIdentitySync() {
  useAtomValue(amplitudeIdentitySyncAtom)

  return null
}

export function ExternalServiceSync() {
  const analyticsConsent = useAnalyticsConsent()
  const amplitudeInitialized = useAmplitudeInitialized()
  useAtomValue(zendeskConversationSyncAtom)

  return analyticsConsent === 'granted' && amplitudeInitialized ? <AmplitudeIdentitySync /> : null
}
