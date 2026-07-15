'use client'

import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import type { ICurrentWorkspace } from '@/models/common'
import { atom } from 'jotai'
import { atomEffect } from 'jotai-effect'
import { setUserId, setUserProperties } from '@/app/components/base/amplitude'
import { flushRegistrationSuccess } from '@/app/components/base/amplitude/registration-tracking'
import { userProfileAtom } from './account-state'
import { currentWorkspaceAtom } from './workspace-state'

type AmplitudeProperties = Record<string, string | number | boolean>

const amplitudeIdentityAtom = atom<string | undefined>(undefined)

function buildAmplitudeProperties({
  currentWorkspace,
  userProfile,
}: {
  currentWorkspace: ICurrentWorkspace
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
    properties.workspace_plan = currentWorkspace.plan
    properties.workspace_status = currentWorkspace.status
    properties.workspace_role = currentWorkspace.role
  }

  return properties
}

export const amplitudeIdentitySyncAtom = atomEffect((get, set) => {
  const userProfile = get(userProfileAtom)
  const currentWorkspace = get(currentWorkspaceAtom)

  if (!userProfile.id) return

  const properties = buildAmplitudeProperties({
    currentWorkspace,
    userProfile,
  })
  const identity = JSON.stringify({
    userId: userProfile.email,
    properties,
  })

  if (identity === get.peek(amplitudeIdentityAtom)) return

  setUserId(userProfile.email)
  setUserProperties(properties)
  flushRegistrationSuccess()
  set(amplitudeIdentityAtom, identity)
})
