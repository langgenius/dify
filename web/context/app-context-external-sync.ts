'use client'

import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import type { ICurrentWorkspace, LangGeniusVersionResponse } from '@/models/common'
import { atom } from 'jotai'
import { atomEffect } from 'jotai-effect'
import { setUserId, setUserProperties } from '@/app/components/base/amplitude'
import { flushRegistrationSuccess } from '@/app/components/base/amplitude/registration-tracking'
import { setZendeskConversationFields } from '@/app/components/base/zendesk/utils'
import { ZENDESK_FIELD_IDS } from '@/config'
import {
  currentWorkspaceAtom,
  langGeniusVersionInfoAtom,
  userProfileAtom,
} from './app-context-state'

type SyncState = {
  amplitudeIdentity?: string
  zendeskEmail?: string
  zendeskEnvironment?: string
  zendeskVersion?: string
  zendeskWorkspaceId?: string
}

const appContextExternalSyncStateAtom = atom<SyncState>({})

function syncZendeskField({
  fieldId,
  nextState,
  value,
  previousValue,
  setPreviousValue,
}: {
  fieldId: string | undefined
  nextState: SyncState
  value: string
  previousValue: string | undefined
  setPreviousValue: (state: SyncState, value: string) => void
}) {
  if (!fieldId || !value || value === previousValue)
    return

  setZendeskConversationFields([{
    id: fieldId,
    value,
  }])
  setPreviousValue(nextState, value)
}

function syncAmplitudeIdentity({
  userProfile,
  currentWorkspace,
  state,
}: {
  userProfile: GetAccountProfileResponse
  currentWorkspace: ICurrentWorkspace
  state: SyncState
}) {
  if (!userProfile.id)
    return state

  const properties: Record<string, string | number | boolean> = {
    email: userProfile.email,
    name: userProfile.name,
    has_password: userProfile.is_password_set,
  }

  if (currentWorkspace.id) {
    properties.workspace_id = currentWorkspace.id
    properties.workspace_name = currentWorkspace.name
    properties.workspace_plan = currentWorkspace.plan
    properties.workspace_status = currentWorkspace.status
    properties.workspace_role = currentWorkspace.role
  }

  const identity = JSON.stringify({
    userId: userProfile.email,
    properties,
  })

  if (identity === state.amplitudeIdentity)
    return state

  setUserId(userProfile.email)
  setUserProperties(properties)
  flushRegistrationSuccess()
  return {
    ...state,
    amplitudeIdentity: identity,
  }
}

function syncAppContextExternalState({
  currentWorkspace,
  langGeniusVersionInfo,
  state,
  userProfile,
}: {
  currentWorkspace: ICurrentWorkspace
  langGeniusVersionInfo: LangGeniusVersionResponse
  state: SyncState
  userProfile: GetAccountProfileResponse
}) {
  let nextState = state
  syncZendeskField({
    fieldId: ZENDESK_FIELD_IDS.ENVIRONMENT,
    nextState,
    value: langGeniusVersionInfo.current_env.toLowerCase(),
    previousValue: nextState.zendeskEnvironment,
    setPreviousValue: (state, value) => {
      state.zendeskEnvironment = value
    },
  })
  syncZendeskField({
    fieldId: ZENDESK_FIELD_IDS.VERSION,
    nextState,
    value: langGeniusVersionInfo.version,
    previousValue: nextState.zendeskVersion,
    setPreviousValue: (state, value) => {
      state.zendeskVersion = value
    },
  })
  syncZendeskField({
    fieldId: ZENDESK_FIELD_IDS.EMAIL,
    nextState,
    value: userProfile.email,
    previousValue: nextState.zendeskEmail,
    setPreviousValue: (state, value) => {
      state.zendeskEmail = value
    },
  })
  syncZendeskField({
    fieldId: ZENDESK_FIELD_IDS.WORKSPACE_ID,
    nextState,
    value: currentWorkspace.id,
    previousValue: nextState.zendeskWorkspaceId,
    setPreviousValue: (state, value) => {
      state.zendeskWorkspaceId = value
    },
  })
  nextState = syncAmplitudeIdentity({
    userProfile,
    currentWorkspace,
    state: nextState,
  })

  return nextState
}

export const appContextExternalSyncAtom = atomEffect((get, set) => {
  const userProfile = get(userProfileAtom)
  const currentWorkspace = get(currentWorkspaceAtom)
  const langGeniusVersionInfo = get(langGeniusVersionInfoAtom)
  const state = get.peek(appContextExternalSyncStateAtom)

  const nextState = syncAppContextExternalState({
    userProfile,
    currentWorkspace,
    langGeniusVersionInfo,
    state: { ...state },
  })

  set(appContextExternalSyncStateAtom, nextState)
})
