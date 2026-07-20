import type { createStore } from 'jotai'
import type { LangGeniusVersionInfo } from '@/context/app-context-types'
import type { ICurrentWorkspace } from '@/models/common'
import { atom } from 'jotai'
import { defaultSystemFeatures } from '@/features/system-features/config'

export type ConsoleStateFixture = {
  userProfile?: {
    id?: string
    name?: string
    email?: string
    avatar?: string | null
    avatar_url?: string | null
    is_password_set?: boolean
  } | null
  currentWorkspace?:
    | ({
        id?: string
        name?: string
      } & Partial<ICurrentWorkspace>)
    | null
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
}

type ConsoleStateFixtureResolver = () => ConsoleStateFixture
type JotaiStore = ReturnType<typeof createStore>
type ConsoleStateOwner = 'account' | 'workspace' | 'permission' | 'systemFeatures' | 'version'

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
  trial_credits_exhausted_at: 0,
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

const userProfileAtom = atom(defaultUserProfile)
const userProfileIdAtom = atom((get) => get(userProfileAtom).id)
const userProfileEmailAtom = atom((get) => get(userProfileAtom).email)
const accountProfileMetaAtom = atom({ currentVersion: null, currentEnv: null })
const refreshUserProfileCallbackAtom = atom({ callback: () => {} })
const refreshUserProfileAtom = atom(null, (get) => get(refreshUserProfileCallbackAtom).callback())

const currentWorkspaceAtom = atom<ICurrentWorkspace>(defaultCurrentWorkspace)
const currentWorkspaceIdAtom = atom((get) => get(currentWorkspaceAtom).id)
const isCurrentWorkspaceManagerAtom = atom(false)
const isCurrentWorkspaceOwnerAtom = atom(false)
const isCurrentWorkspaceEditorAtom = atom(false)
const isCurrentWorkspaceDatasetOperatorAtom = atom(false)
const currentWorkspaceLoadingAtom = atom(false)
const refreshCurrentWorkspaceCallbackAtom = atom({ callback: () => {} })
const refreshCurrentWorkspaceAtom = atom(null, (get) =>
  get(refreshCurrentWorkspaceCallbackAtom).callback(),
)

const workspacePermissionKeysAtom = atom<string[]>([])
const workspacePermissionKeysLoadingAtom = atom(false)

const systemFeaturesAtom = atom(defaultSystemFeatures)
const datasetRbacEnabledAtom = atom((get) => get(systemFeaturesAtom).rbac_enabled)

const langGeniusVersionInfoAtom = atom<LangGeniusVersionInfo>(defaultLangGeniusVersionInfo)
const langGeniusCurrentVersionAtom = atom((get) => get(langGeniusVersionInfoAtom).current_version)

const consoleStateFixtureResolvers: Partial<
  Record<ConsoleStateOwner, ConsoleStateFixtureResolver>
> = {}

const registerConsoleStateFixture = (
  owner: ConsoleStateOwner,
  getState: ConsoleStateFixtureResolver,
) => {
  consoleStateFixtureResolvers[owner] = getState
}

export const seedRegisteredConsoleStateFixture = (store: JotaiStore) => {
  const resolvers = Object.values(consoleStateFixtureResolvers)
  if (!resolvers.length) return false

  const state = Object.assign({}, ...resolvers.map((resolve) => resolve()))
  store.set(userProfileAtom, {
    ...defaultUserProfile,
    ...state.userProfile,
  })
  store.set(currentWorkspaceAtom, {
    ...defaultCurrentWorkspace,
    ...state.currentWorkspace,
  })
  store.set(isCurrentWorkspaceManagerAtom, state.isCurrentWorkspaceManager ?? false)
  store.set(isCurrentWorkspaceOwnerAtom, state.isCurrentWorkspaceOwner ?? false)
  store.set(isCurrentWorkspaceEditorAtom, state.isCurrentWorkspaceEditor ?? false)
  store.set(isCurrentWorkspaceDatasetOperatorAtom, state.isCurrentWorkspaceDatasetOperator ?? false)
  store.set(currentWorkspaceLoadingAtom, state.isLoadingCurrentWorkspace ?? false)
  store.set(workspacePermissionKeysAtom, state.workspacePermissionKeys ?? [])
  store.set(workspacePermissionKeysLoadingAtom, state.isLoadingWorkspacePermissionKeys ?? false)
  store.set(systemFeaturesAtom, {
    ...defaultSystemFeatures,
    rbac_enabled: state.datasetRbacEnabled ?? false,
  })
  store.set(langGeniusVersionInfoAtom, {
    ...defaultLangGeniusVersionInfo,
    ...state.langGeniusVersionInfo,
  })
  store.set(refreshUserProfileCallbackAtom, { callback: state.refreshUserProfile ?? (() => {}) })
  store.set(refreshCurrentWorkspaceCallbackAtom, {
    callback: state.refreshCurrentWorkspace ?? (() => {}),
  })

  return true
}

export const createAccountStateModuleMock = (getState: ConsoleStateFixtureResolver) => {
  registerConsoleStateFixture('account', () => {
    const state = getState()
    return {
      userProfile: state.userProfile,
      refreshUserProfile: state.refreshUserProfile,
    }
  })
  return {
    userProfileAtom,
    userProfileIdAtom,
    userProfileEmailAtom,
    accountProfileMetaAtom,
    refreshUserProfileAtom,
  }
}

export const createWorkspaceStateModuleMock = (getState: ConsoleStateFixtureResolver) => {
  registerConsoleStateFixture('workspace', () => {
    const state = getState()
    return {
      currentWorkspace: state.currentWorkspace,
      isCurrentWorkspaceManager: state.isCurrentWorkspaceManager,
      isCurrentWorkspaceOwner: state.isCurrentWorkspaceOwner,
      isCurrentWorkspaceEditor: state.isCurrentWorkspaceEditor,
      isCurrentWorkspaceDatasetOperator: state.isCurrentWorkspaceDatasetOperator,
      isLoadingCurrentWorkspace: state.isLoadingCurrentWorkspace,
      refreshCurrentWorkspace: state.refreshCurrentWorkspace,
    }
  })
  return {
    currentWorkspaceAtom,
    currentWorkspaceIdAtom,
    isCurrentWorkspaceManagerAtom,
    isCurrentWorkspaceOwnerAtom,
    isCurrentWorkspaceEditorAtom,
    isCurrentWorkspaceDatasetOperatorAtom,
    currentWorkspaceLoadingAtom,
    refreshCurrentWorkspaceAtom,
  }
}

export const createPermissionStateModuleMock = (getState: ConsoleStateFixtureResolver) => {
  registerConsoleStateFixture('permission', () => {
    const state = getState()
    return {
      workspacePermissionKeys: state.workspacePermissionKeys,
      isLoadingWorkspacePermissionKeys: state.isLoadingWorkspacePermissionKeys,
    }
  })
  return {
    workspacePermissionKeysAtom,
    workspacePermissionKeysLoadingAtom,
  }
}

export const createSystemFeaturesStateModuleMock = (getState: ConsoleStateFixtureResolver) => {
  registerConsoleStateFixture('systemFeatures', () => ({
    datasetRbacEnabled: getState().datasetRbacEnabled,
  }))
  return {
    systemFeaturesAtom,
    datasetRbacEnabledAtom,
  }
}

export const createVersionStateModuleMock = (getState: ConsoleStateFixtureResolver) => {
  registerConsoleStateFixture('version', () => ({
    langGeniusVersionInfo: getState().langGeniusVersionInfo,
  }))
  return {
    langGeniusVersionInfoAtom,
    langGeniusCurrentVersionAtom,
  }
}
