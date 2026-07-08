'use client'

import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import type { ICurrentWorkspace, LangGeniusVersionResponse } from '@/models/common'
import { noop } from 'es-toolkit/function'
import { createContext, useContext, useContextSelector } from 'use-context-selector'
import {
  initialLangGeniusVersionInfo as defaultLangGeniusVersionInfo,
  userProfilePlaceholder as defaultUserProfilePlaceholder,
  initialWorkspaceInfo as defaultWorkspaceInfo,
} from './app-context-defaults'

export type AppContextValue = {
  userProfile: GetAccountProfileResponse
  mutateUserProfile: VoidFunction
  currentWorkspace: ICurrentWorkspace
  isCurrentWorkspaceManager: boolean
  isCurrentWorkspaceOwner: boolean
  isCurrentWorkspaceEditor: boolean
  isCurrentWorkspaceDatasetOperator: boolean
  mutateCurrentWorkspace: VoidFunction
  langGeniusVersionInfo: LangGeniusVersionResponse
  useSelector: typeof useSelector
  isLoadingCurrentWorkspace: boolean
  isLoadingWorkspacePermissionKeys?: boolean
  isValidatingCurrentWorkspace: boolean
  workspacePermissionKeys: string[]
}

export const userProfilePlaceholder = defaultUserProfilePlaceholder

export const initialLangGeniusVersionInfo = defaultLangGeniusVersionInfo

export const initialWorkspaceInfo = defaultWorkspaceInfo

export const AppContext = createContext<AppContextValue>({
  userProfile: userProfilePlaceholder,
  currentWorkspace: initialWorkspaceInfo,
  isCurrentWorkspaceManager: false,
  isCurrentWorkspaceOwner: false,
  isCurrentWorkspaceEditor: false,
  isCurrentWorkspaceDatasetOperator: false,
  mutateUserProfile: noop,
  mutateCurrentWorkspace: noop,
  langGeniusVersionInfo: initialLangGeniusVersionInfo,
  useSelector,
  isLoadingCurrentWorkspace: false,
  isLoadingWorkspacePermissionKeys: false,
  isValidatingCurrentWorkspace: false,
  workspacePermissionKeys: [],
})

export function useSelector<T>(selector: (value: AppContextValue) => T): T {
  return useContextSelector(AppContext, selector)
}

export const useAppContext = () => useContext(AppContext)
