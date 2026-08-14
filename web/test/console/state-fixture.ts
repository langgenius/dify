import type { GetWorkspacesCurrentSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { createStore } from 'jotai'
import { atom } from 'jotai'
import { createSystemFeaturesFixture } from '@/test/console/system-features'

export type ConsoleStateFixture = {
  userProfile?: {
    id?: string
    name?: string
    email?: string
    avatar?: string | null
    avatar_url?: string | null
    is_password_set?: boolean
  } | null
  currentWorkspace?: Partial<GetWorkspacesCurrentSummaryResponse> | null
  isCurrentWorkspaceManager?: boolean
  isCurrentWorkspaceOwner?: boolean
  isCurrentWorkspaceEditor?: boolean
  isCurrentWorkspaceDatasetOperator?: boolean
  isLoadingCurrentWorkspace?: boolean
  isLoadingWorkspacePermissionKeys?: boolean
  workspacePermissionKeys?: string[]
  datasetRbacEnabled?: boolean
  knowledgeFsEnabled?: boolean
  deploymentEdition?: 'COMMUNITY' | 'ENTERPRISE' | 'CLOUD'
  brandingEnabled?: boolean
  refreshCurrentWorkspace?: () => void
}

type ConsoleStateFixtureResolver = () => ConsoleStateFixture
type JotaiStore = ReturnType<typeof createStore>
type ConsoleStateOwner = 'workspace' | 'permission' | 'systemFeatures'

const defaultCurrentWorkspace = {
  id: 'workspace-1',
  name: 'Workspace',
  plan: null,
  credits: null,
  role: 'owner',
} satisfies GetWorkspacesCurrentSummaryResponse

const currentWorkspaceAtom = atom<GetWorkspacesCurrentSummaryResponse>(defaultCurrentWorkspace)
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

const systemFeaturesAtom = atom(createSystemFeaturesFixture())
const deploymentEditionAtom = atom((get) => get(systemFeaturesAtom).deployment_edition)
const brandingEnabledAtom = atom((get) => get(systemFeaturesAtom).branding.enabled)

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
  store.set(
    systemFeaturesAtom,
    createSystemFeaturesFixture({
      rbac_enabled: state.datasetRbacEnabled ?? false,
      knowledge_fs_enabled: state.knowledgeFsEnabled ?? false,
      deployment_edition: state.deploymentEdition ?? 'COMMUNITY',
      branding: {
        enabled: state.brandingEnabled ?? false,
      },
    }),
  )
  store.set(refreshCurrentWorkspaceCallbackAtom, {
    callback: state.refreshCurrentWorkspace ?? (() => {}),
  })

  return true
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
    deploymentEdition: getState().deploymentEdition,
    brandingEnabled: getState().brandingEnabled,
  }))
  return {
    deploymentEditionAtom,
    brandingEnabledAtom,
  }
}
