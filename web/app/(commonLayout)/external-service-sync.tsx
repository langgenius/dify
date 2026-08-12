'use client'

import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import type { GetWorkspacesCurrentSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useEffect, useRef } from 'react'
import { setUserId, setUserProperties } from '@/app/components/base/amplitude'
import { flushRegistrationSuccess } from '@/app/components/base/amplitude/registration-tracking'
import { useAmplitudeInitialized } from '@/app/components/base/amplitude/use-amplitude-initialized'
import { useAnalyticsConsent } from '@/app/components/base/analytics-consent/consent-store'
import { currentWorkspaceAtom } from '@/context/workspace-state'
import { zendeskConversationSyncAtom } from '@/context/zendesk-conversation-sync'
import { userProfileQueryOptions } from '@/features/account-profile/client'

type AmplitudeProperties = Record<string, string | number | boolean>

function buildAmplitudeProperties({
  currentWorkspace,
  userProfile,
}: {
  currentWorkspace: GetWorkspacesCurrentSummaryResponse
  userProfile: GetAccountProfileResponse
}) {
  const properties: AmplitudeProperties = {
    email: userProfile.email,
    name: userProfile.name,
    has_password: userProfile.is_password_set,
  }

  if (currentWorkspace.id) {
    properties.workspace_id = currentWorkspace.id
    properties.workspace_name = currentWorkspace.name
    if (currentWorkspace.plan) properties.workspace_plan = currentWorkspace.plan
    properties.workspace_role = currentWorkspace.role
  }

  return properties
}

function AmplitudeIdentitySync() {
  const { data: userProfile } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile,
  })
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const lastIdentityRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!userProfile.id) return

    const properties = buildAmplitudeProperties({
      currentWorkspace,
      userProfile,
    })
    const identity = JSON.stringify({
      userId: userProfile.email,
      properties,
    })

    if (identity === lastIdentityRef.current) return

    setUserId(userProfile.email)
    setUserProperties(properties)
    flushRegistrationSuccess()
    lastIdentityRef.current = identity
  }, [currentWorkspace, userProfile])

  return null
}

export function ExternalServiceSync() {
  const analyticsConsent = useAnalyticsConsent()
  const amplitudeInitialized = useAmplitudeInitialized()
  useAtomValue(zendeskConversationSyncAtom)

  return analyticsConsent === 'granted' && amplitudeInitialized ? <AmplitudeIdentitySync /> : null
}
