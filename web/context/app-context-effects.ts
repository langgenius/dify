'use client'

import { useAtomValue } from 'jotai'
import { useEffect } from 'react'
import { setUserId, setUserProperties } from '@/app/components/base/amplitude'
import { flushRegistrationSuccess } from '@/app/components/base/amplitude/registration-tracking'
import { setZendeskConversationFields } from '@/app/components/base/zendesk/utils'
import { ZENDESK_FIELD_IDS } from '@/config'
import {
  currentWorkspaceAtom,
  langGeniusVersionInfoAtom,
  userProfileAtom,
} from './app-context-state'

export function useSyncZendeskFields() {
  const userProfile = useAtomValue(userProfileAtom)
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const langGeniusVersionInfo = useAtomValue(langGeniusVersionInfoAtom)

  useEffect(() => {
    if (ZENDESK_FIELD_IDS.ENVIRONMENT && langGeniusVersionInfo?.current_env) {
      setZendeskConversationFields([{
        id: ZENDESK_FIELD_IDS.ENVIRONMENT,
        value: langGeniusVersionInfo.current_env.toLowerCase(),
      }])
    }
  }, [langGeniusVersionInfo?.current_env])

  useEffect(() => {
    if (ZENDESK_FIELD_IDS.VERSION && langGeniusVersionInfo?.version) {
      setZendeskConversationFields([{
        id: ZENDESK_FIELD_IDS.VERSION,
        value: langGeniusVersionInfo.version,
      }])
    }
  }, [langGeniusVersionInfo?.version])

  useEffect(() => {
    if (ZENDESK_FIELD_IDS.EMAIL && userProfile?.email) {
      setZendeskConversationFields([{
        id: ZENDESK_FIELD_IDS.EMAIL,
        value: userProfile.email,
      }])
    }
  }, [userProfile?.email])

  useEffect(() => {
    if (ZENDESK_FIELD_IDS.WORKSPACE_ID && currentWorkspace?.id) {
      setZendeskConversationFields([{
        id: ZENDESK_FIELD_IDS.WORKSPACE_ID,
        value: currentWorkspace.id,
      }])
    }
  }, [currentWorkspace?.id])
}

export function useSyncAmplitudeIdentity() {
  const userProfile = useAtomValue(userProfileAtom)
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)

  useEffect(() => {
    if (userProfile?.id) {
      setUserId(userProfile.email)
      const properties: Record<string, string | number | boolean> = {
        email: userProfile.email,
        name: userProfile.name,
        has_password: userProfile.is_password_set,
      }

      if (currentWorkspace?.id) {
        properties.workspace_id = currentWorkspace.id
        properties.workspace_name = currentWorkspace.name
        properties.workspace_plan = currentWorkspace.plan
        properties.workspace_status = currentWorkspace.status
        properties.workspace_role = currentWorkspace.role
      }

      setUserProperties(properties)
      flushRegistrationSuccess()
    }
  }, [userProfile, currentWorkspace])
}
