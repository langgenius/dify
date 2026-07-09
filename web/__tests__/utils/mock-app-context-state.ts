import type { LangGeniusVersionInfo } from '@/context/app-context-types'
import type { ICurrentWorkspace } from '@/models/common'

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
  currentWorkspace?: ({
    id?: string
    name?: string
  } & Partial<ICurrentWorkspace>) | null
  isCurrentWorkspaceManager?: boolean
  isCurrentWorkspaceOwner?: boolean
  isCurrentWorkspaceEditor?: boolean
  isCurrentWorkspaceDatasetOperator?: boolean
  isLoadingCurrentWorkspace?: boolean
  isLoadingWorkspacePermissionKeys?: boolean
  workspacePermissionKeys?: string[]
  datasetRbacEnabled?: boolean
  langGeniusVersionInfo?: Partial<LangGeniusVersionInfo>
  refreshUserProfile?: () => void
  refreshCurrentWorkspace?: () => void
  mutateUserProfile?: () => void
  mutateCurrentWorkspace?: () => void
}

type AppContextStateAtomKind
  = | 'userProfile'
    | 'userProfileId'
    | 'userProfileEmail'
    | 'currentWorkspace'
    | 'currentWorkspaceId'
    | 'isCurrentWorkspaceManager'
    | 'isCurrentWorkspaceOwner'
    | 'isCurrentWorkspaceEditor'
    | 'isCurrentWorkspaceDatasetOperator'
    | 'currentWorkspaceLoading'
    | 'workspacePermissionKeys'
    | 'workspacePermissionKeysLoading'
    | 'datasetRbacEnabled'
    | 'langGeniusVersionInfo'
    | 'langGeniusCurrentVersion'
    | 'refreshUserProfile'
    | 'refreshCurrentWorkspace'

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
  name: 'Workspace',
  plan: '',
  status: '',
  created_at: 0,
  role: 'owner',
  providers: [],
  trial_credits: 0,
  trial_credits_used: 0,
  next_credit_reset_date: 0,
} satisfies ICurrentWorkspace

const defaultLangGeniusVersionInfo = {
  current_env: 'CLOUD',
  current_version: '',
  latest_version: '',
  version: '',
  release_date: '',
  release_notes: '',
  features: {
    can_replace_logo: false,
    model_load_balancing_enabled: false,
  },
  can_auto_update: false,
} satisfies LangGeniusVersionInfo

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

const getCurrentWorkspace = (state: AppContextStateMockState): ICurrentWorkspace => ({
  ...defaultCurrentWorkspace,
  ...state.currentWorkspace,
})

const getLangGeniusVersionInfo = (state: AppContextStateMockState): LangGeniusVersionInfo => ({
  ...defaultLangGeniusVersionInfo,
  ...state.langGeniusVersionInfo,
})

export const createAppContextStateAtomMock = async <TModule extends object>(
  importOriginal: <T>() => Promise<T>,
  getState: () => AppContextStateMockState,
) => {
  const actual = await importOriginal<TModule>()
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
    isCurrentWorkspaceManagerAtom: createMockAtom('isCurrentWorkspaceManager'),
    isCurrentWorkspaceOwnerAtom: createMockAtom('isCurrentWorkspaceOwner'),
    isCurrentWorkspaceEditorAtom: createMockAtom('isCurrentWorkspaceEditor'),
    isCurrentWorkspaceDatasetOperatorAtom: createMockAtom('isCurrentWorkspaceDatasetOperator'),
    currentWorkspaceLoadingAtom: createMockAtom('currentWorkspaceLoading'),
    workspacePermissionKeysAtom: createMockAtom('workspacePermissionKeys'),
    workspacePermissionKeysLoadingAtom: createMockAtom('workspacePermissionKeysLoading'),
    datasetRbacEnabledAtom: createMockAtom('datasetRbacEnabled'),
    langGeniusVersionInfoAtom: createMockAtom('langGeniusVersionInfo'),
    langGeniusCurrentVersionAtom: createMockAtom('langGeniusCurrentVersion'),
    refreshUserProfileAtom: createMockAtom('refreshUserProfile'),
    refreshCurrentWorkspaceAtom: createMockAtom('refreshCurrentWorkspace'),
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

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'isCurrentWorkspaceManager')
        return state.isCurrentWorkspaceManager ?? false

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'isCurrentWorkspaceOwner')
        return state.isCurrentWorkspaceOwner ?? false

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'isCurrentWorkspaceEditor')
        return state.isCurrentWorkspaceEditor ?? false

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'isCurrentWorkspaceDatasetOperator')
        return state.isCurrentWorkspaceDatasetOperator ?? false

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'currentWorkspaceLoading')
        return state.isLoadingCurrentWorkspace ?? false

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'workspacePermissionKeys')
        return state.workspacePermissionKeys ?? []

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'workspacePermissionKeysLoading')
        return state.isLoadingWorkspacePermissionKeys ?? false

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'datasetRbacEnabled')
        return state.datasetRbacEnabled ?? false

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'langGeniusVersionInfo')
        return getLangGeniusVersionInfo(state)

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'langGeniusCurrentVersion')
        return getLangGeniusVersionInfo(state).current_version

      throw new Error(`Unsupported app context state atom: ${atom[APP_CONTEXT_STATE_ATOM_KIND]}`)
    },
    useSetAtom: (atom: unknown) => {
      if (!isAppContextStateMockAtom(atom))
        return actual.useSetAtom(atom as Parameters<typeof actual.useSetAtom>[0])

      if (!appContextStateMockRegistry)
        throw new Error('App context state atom mock is not initialized')

      const state = appContextStateMockRegistry.getState()

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'refreshUserProfile')
        return state.refreshUserProfile ?? (() => {})

      if (atom[APP_CONTEXT_STATE_ATOM_KIND] === 'refreshCurrentWorkspace')
        return state.refreshCurrentWorkspace ?? (() => {})

      throw new Error(`Unsupported app context state write atom: ${atom[APP_CONTEXT_STATE_ATOM_KIND]}`)
    },
  }
}
