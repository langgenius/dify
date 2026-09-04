'use client'

import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { GetWorkspacesCurrentSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { skipToken, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { Fragment, useEffect, useRef, useSyncExternalStore } from 'react'
import { setUserId, setUserProperties } from '@/app/components/base/amplitude'
import {
  flushRegistrationSuccess,
  getRegistrationSuccessSnapshot,
  subscribeRegistrationSuccess,
} from '@/app/components/base/amplitude/registration-tracking'
import { useAmplitudeInitialized } from '@/app/components/base/amplitude/use-amplitude-initialized'
import { useAnalyticsConsent } from '@/app/components/base/analytics-consent/consent-store'
import { zendeskRuntime } from '@/app/components/base/zendesk/runtime'
import { ZENDESK_FIELD_IDS } from '@/config'
import { getLangGeniusVersionInfo } from '@/context/app-context-normalizers'
import { currentWorkspaceAtom } from '@/context/workspace-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/client'

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

export function AmplitudeIdentitySync() {
  const { data: userProfile } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile,
  })
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const lastIdentityRef = useRef<string | undefined>(undefined)
  const registrationSnapshot = useSyncExternalStore(
    subscribeRegistrationSuccess,
    getRegistrationSuccessSnapshot,
    getRegistrationSuccessSnapshot,
  )

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

    if (identity !== lastIdentityRef.current) {
      setUserId(userProfile.email)
      setUserProperties(properties)
      lastIdentityRef.current = identity
    }

    void flushRegistrationSuccess()
  }, [currentWorkspace, registrationSnapshot, userProfile])

  return null
}

type ZendeskSyncState = {
  email?: string
  environment?: string
  version?: string
  workspaceId?: string
}

function syncZendeskField({
  fieldId,
  deploymentEdition,
  previousValue,
  setNextValue,
  value,
}: {
  fieldId: string | undefined
  deploymentEdition: DeploymentEdition
  previousValue: string | undefined
  setNextValue: (value: string) => void
  value: string
}) {
  if (deploymentEdition !== 'CLOUD' || !fieldId || !value || value === previousValue) return

  zendeskRuntime.setConversationFields(
    [
      {
        id: fieldId,
        value,
      },
    ],
    deploymentEdition,
  )
  setNextValue(value)
}

function ZendeskConversationSync() {
  const { data: accountProfile } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => ({
      email: data.profile.email,
      meta: data.meta,
    }),
  })
  const { data: systemFeatures } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (data) => ({
      brandingEnabled: data.branding.enabled,
      deploymentEdition: data.deployment_edition,
    }),
  })
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const { data: versionData } = useQuery(
    consoleQuery.version.get.queryOptions({
      input: accountProfile.meta.currentVersion
        ? {
            query: {
              current_version: accountProfile.meta.currentVersion,
            },
          }
        : skipToken,
      enabled: !systemFeatures.brandingEnabled,
    }),
  )
  const langGeniusVersionInfo = getLangGeniusVersionInfo({
    meta: accountProfile.meta,
    versionData,
  })
  const syncStateRef = useRef<ZendeskSyncState>({})

  useEffect(() => {
    const nextState = { ...syncStateRef.current }

    syncZendeskField({
      fieldId: ZENDESK_FIELD_IDS.ENVIRONMENT,
      deploymentEdition: systemFeatures.deploymentEdition,
      value: langGeniusVersionInfo.current_env.toLowerCase(),
      previousValue: syncStateRef.current.environment,
      setNextValue: (value) => {
        nextState.environment = value
      },
    })
    syncZendeskField({
      fieldId: ZENDESK_FIELD_IDS.VERSION,
      deploymentEdition: systemFeatures.deploymentEdition,
      value: langGeniusVersionInfo.version,
      previousValue: syncStateRef.current.version,
      setNextValue: (value) => {
        nextState.version = value
      },
    })
    syncZendeskField({
      fieldId: ZENDESK_FIELD_IDS.EMAIL,
      deploymentEdition: systemFeatures.deploymentEdition,
      value: accountProfile.email,
      previousValue: syncStateRef.current.email,
      setNextValue: (value) => {
        nextState.email = value
      },
    })
    syncZendeskField({
      fieldId: ZENDESK_FIELD_IDS.WORKSPACE_ID,
      deploymentEdition: systemFeatures.deploymentEdition,
      value: currentWorkspace.id,
      previousValue: syncStateRef.current.workspaceId,
      setNextValue: (value) => {
        nextState.workspaceId = value
      },
    })

    syncStateRef.current = nextState
  }, [accountProfile.email, currentWorkspace.id, langGeniusVersionInfo, systemFeatures])

  return null
}

export function ExternalServiceSync() {
  const analyticsConsent = useAnalyticsConsent()
  const amplitudeInitialized = useAmplitudeInitialized()

  return (
    <Fragment>
      <ZendeskConversationSync />
      {analyticsConsent === 'granted' && amplitudeInitialized && <AmplitudeIdentitySync />}
    </Fragment>
  )
}
