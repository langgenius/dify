'use client'

import { atom } from 'jotai'
import { atomEffect } from 'jotai-effect'
import { setZendeskConversationFields } from '@/app/components/base/zendesk/utils'
import { ZENDESK_FIELD_IDS } from '@/config'
import { userProfileAtom } from './account-state'
import { langGeniusVersionInfoAtom } from './version-state'
import { currentWorkspaceAtom } from './workspace-state'

type ZendeskSyncState = {
  email?: string
  environment?: string
  version?: string
  workspaceId?: string
}

const zendeskConversationSyncStateAtom = atom<ZendeskSyncState>({})

function syncZendeskField({
  fieldId,
  previousValue,
  setNextValue,
  value,
}: {
  fieldId: string | undefined
  previousValue: string | undefined
  setNextValue: (value: string) => void
  value: string
}) {
  if (!fieldId || !value || value === previousValue)
    return false

  setZendeskConversationFields([{
    id: fieldId,
    value,
  }])
  setNextValue(value)

  return true
}

export const zendeskConversationSyncAtom = atomEffect((get, set) => {
  const userProfile = get(userProfileAtom)
  const currentWorkspace = get(currentWorkspaceAtom)
  const langGeniusVersionInfo = get(langGeniusVersionInfoAtom)
  const state = get.peek(zendeskConversationSyncStateAtom)
  const nextState = { ...state }

  let didSync = false
  didSync = syncZendeskField({
    fieldId: ZENDESK_FIELD_IDS.ENVIRONMENT,
    value: langGeniusVersionInfo.current_env.toLowerCase(),
    previousValue: state.environment,
    setNextValue: (value) => {
      nextState.environment = value
    },
  }) || didSync
  didSync = syncZendeskField({
    fieldId: ZENDESK_FIELD_IDS.VERSION,
    value: langGeniusVersionInfo.version,
    previousValue: state.version,
    setNextValue: (value) => {
      nextState.version = value
    },
  }) || didSync
  didSync = syncZendeskField({
    fieldId: ZENDESK_FIELD_IDS.EMAIL,
    value: userProfile.email,
    previousValue: state.email,
    setNextValue: (value) => {
      nextState.email = value
    },
  }) || didSync
  didSync = syncZendeskField({
    fieldId: ZENDESK_FIELD_IDS.WORKSPACE_ID,
    value: currentWorkspace.id,
    previousValue: state.workspaceId,
    setNextValue: (value) => {
      nextState.workspaceId = value
    },
  }) || didSync

  if (didSync)
    set(zendeskConversationSyncStateAtom, nextState)
})
