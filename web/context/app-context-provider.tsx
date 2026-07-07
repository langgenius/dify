'use client'

import type { ReactNode } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  AppContext,
  useSelector,
} from '@/context/app-context'
import {
  currentWorkspaceAtom,
  currentWorkspaceLoadingAtom,
  currentWorkspaceValidatingAtom,
  langGeniusVersionInfoAtom,
  refreshCurrentWorkspaceAtom,
  refreshUserProfileAtom,
  userProfileAtom,
  workspacePermissionKeysAtom,
  workspacePermissionKeysLoadingAtom,
  workspaceRoleFlagsAtom,
} from '@/context/app-context-state'
import {
  useSyncAmplitudeIdentity,
  useSyncZendeskFields,
} from './app-context-effects'

type AppContextProviderProps = {
  children: ReactNode
}

export function AppContextProvider({ children }: AppContextProviderProps) {
  const userProfile = useAtomValue(userProfileAtom)
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const roleFlags = useAtomValue(workspaceRoleFlagsAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const langGeniusVersionInfo = useAtomValue(langGeniusVersionInfoAtom)
  const isLoadingCurrentWorkspace = useAtomValue(currentWorkspaceLoadingAtom)
  const isValidatingCurrentWorkspace = useAtomValue(currentWorkspaceValidatingAtom)
  const isLoadingWorkspacePermissionKeys = useAtomValue(workspacePermissionKeysLoadingAtom)

  const refreshUserProfile = useSetAtom(refreshUserProfileAtom)
  const refreshCurrentWorkspace = useSetAtom(refreshCurrentWorkspaceAtom)

  useSyncZendeskFields()
  useSyncAmplitudeIdentity()

  return (
    <AppContext.Provider value={{
      userProfile,
      mutateUserProfile: () => {
        refreshUserProfile()
      },
      langGeniusVersionInfo,
      useSelector,
      currentWorkspace,
      ...roleFlags,
      mutateCurrentWorkspace: () => {
        refreshCurrentWorkspace()
      },
      isLoadingCurrentWorkspace,
      isLoadingWorkspacePermissionKeys,
      isValidatingCurrentWorkspace,
      workspacePermissionKeys,
    }}
    >
      {children}
    </AppContext.Provider>
  )
}
