import type { LangGeniusVersionResponse } from '@/models/common'

const APP_CONTEXT_STATE_ATOM_KIND = Symbol('app-context-state-atom-kind')

export type AppContextStateMockState = {
  userProfile?: {
    id?: string
    name?: string
    email?: string
    avatar?: string | null
    avatar_url?: string | null
    is_password_set?: boolean
  } | null
  currentWorkspace?: {
    id?: string
  } | null
  isCurrentWorkspaceManager?: boolean
  isCurrentWorkspaceOwner?: boolean
  isCurrentWorkspaceEditor?: boolean
  isCurrentWorkspaceDatasetOperator?: boolean
  isLoadingCurrentWorkspace?: boolean
  isLoadingWorkspacePermissionKeys?: boolean
  workspacePermissionKeys?: string[]
  langGeniusVersionInfo?: LangGeniusVersionResponse
}

type AppContextStateAtomKind
  = | 'userProfile'
    | 'userProfileId'
    | 'userProfileEmail'
    | 'currentWorkspace'
    | 'currentWorkspaceId'
    | 'workspaceRoleFlags'
    | 'isCurrentWorkspaceManager'
    | 'currentWorkspaceLoading'
    | 'workspacePermissionKeys'
    | 'workspacePermissionKeysLoading'
    | 'langGeniusVersionInfo'
    | 'langGeniusCurrentVersion'

type AppContextStateMockAtom = {
  [APP_CONTEXT_STATE_ATOM_KIND]: AppContextStateAtomKind
}

type AppContextStateMockRegistry = {
  getState: () => AppContextStateMockState
}

const defaultUserProfile = {
  id: 'user-1',
  name: 'User',
  email: 'user@example.com',
  avatar: '',
  avatar_url: '',
  is_password_set: true,
}

const defaultCurrentWorkspace = {
  id: 'workspace-1',
}

const defaultLangGeniusVersionInfo = {
  current_env: 'CLOUD',
  current_version: '',
  latest_version: '',
  version: '',
  release_date: '',
  release_notes: '',
  can_auto_update: false,
} satisfies LangGeniusVersionResponse

let appContextStateMockRegistry: AppContextStateMockRegistry | undefined

const createMockAtom = (
  kind: AppContextStateAtomKind,
): AppContextStateMockAtom => ({
  [APP_CONTEXT_STATE_ATOM_KIND]: kind,
})

const isAppContextStateMockAtom = (atom: unknown): atom is AppContextStateMockAtom => {
  return typeof atom === 'object' && atom !== null && APP_CONTEXT_STATE_ATOM_KIND in atom
}

const getUserProfile = (state: AppContextStateMockState) => ({
  ...defaultUserProfile,
  ...state.userProfile,
})

const getCurrentWorkspace = (state: AppContextStateMockState) => ({
  ...defaultCurrentWorkspace,
  ...state.currentWorkspace,
})

export const createAppContextStateAtomMock = async (
  importOriginal: <T>() => Promise<T>,
  getState: () => AppContextStateMockState,
) => {
  const actual = await importOriginal<typeof import('@/context/app-context-state')>()
  appContextStateMockRegistry = {
    getState,
  }

  return {
    ...actual,
    userProfileAtom: createMockAtom('userProfile'),
    userProfileIdAtom: createMockAtom('userProfileId'),
    userProfileEmailAtom: createMockAtom('userProfileEmail'),
    currentWorkspaceAtom: createMockAtom('currentWorkspace'),
    currentWorkspaceIdAtom: createMockAtom('currentWorkspaceId'),
    workspaceRoleFlagsAtom: createMockAtom('workspaceRoleFlags'),
    isCurrentWorkspaceManagerAtom: createMockAtom('isCurrentWorkspaceManager'),
    currentWorkspaceLoadingAtom: createMockAtom('currentWorkspaceLoading'),
    workspacePermissionKeysAtom: createMockAtom('workspacePermissionKeys'),
    workspacePermissionKeysLoadingAtom: createMockAtom('workspacePermissionKeysLoading'),
    langGeniusVersionInfoAtom: createMockAtom('langGeniusVersionInfo'),
    langGeniusCurrentVersionAtom: createMockAtom('langGeniusCurrentVersion'),
  }
}

export const createAppContextStateJotaiMock = async (
  importOriginal: <T>() => Promise<T>,
) => {
  const actual = await importOriginal<typeof import('jotai')>()

  return {
    ...actual,
    useAtomValue: (atom: unknown) => {
      if (!isAppContextStateMockAtom(atom))
        return actual.useAtomValue(atom as Parameters<typeof actual.useAtomValue>[0])

      if (!appContextStateMockRegistry)
        throw new Error('App context state atom mock is not initialized')

      const state = appContextStateMockRegistry.getState()
      const userProfile = getUserProfile(state)
      const currentWorkspace = getCurrentWorkspace(state)

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'userProfile')
        return userProfile

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'userProfileId')
        return userProfile.id

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'userProfileEmail')
        return userProfile.email

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'currentWorkspace')
        return currentWorkspace

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'currentWorkspaceId')
        return currentWorkspace.id

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'workspaceRoleFlags') {
        return {
          isCurrentWorkspaceManager: state.isCurrentWorkspaceManager ?? false,
          isCurrentWorkspaceOwner: state.isCurrentWorkspaceOwner ?? false,
          isCurrentWorkspaceEditor: state.isCurrentWorkspaceEditor ?? false,
          isCurrentWorkspaceDatasetOperator: state.isCurrentWorkspaceDatasetOperator ?? false,
        }
      }

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'isCurrentWorkspaceManager')
        return state.isCurrentWorkspaceManager ?? false

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'currentWorkspaceLoading')
        return state.isLoadingCurrentWorkspace ?? false

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'workspacePermissionKeys')
        return state.workspacePermissionKeys ?? []

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'workspacePermissionKeysLoading')
        return state.isLoadingWorkspacePermissionKeys ?? false

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'langGeniusVersionInfo')
        return state.langGeniusVersionInfo ?? defaultLangGeniusVersionInfo

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'langGeniusCurrentVersion')
        return (state.langGeniusVersionInfo ?? defaultLangGeniusVersionInfo).current_version

      throw new Error(`Unsupported app context state atom: ${atom[APP_CONTEXT_STATE_ATOM_KIND]}`)
    },
  }
}
