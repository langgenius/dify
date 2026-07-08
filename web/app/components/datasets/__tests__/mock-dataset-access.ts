import { hasPermission } from '@/utils/permission'

const DATASET_ACCESS_ATOM_KIND = Symbol('dataset-access-atom-kind')

type DatasetAccessMockState = {
  userProfile?: {
    id?: string
    name?: string
    email?: string
    avatar?: string
    avatar_url?: string
    is_password_set?: boolean
  } | null
  currentWorkspace?: {
    id?: string
  } | null
  isCurrentWorkspaceOwner?: boolean
  isLoadingCurrentWorkspace?: boolean
  isLoadingWorkspacePermissionKeys?: boolean
  workspacePermissionKeys?: string[]
}

type DatasetAccessMockOptions = {
  isRbacEnabled?: boolean
}

type DatasetAccessAtomKind
  = | 'userProfile'
    | 'workspacePermissionKeys'
    | 'datasetRbacEnabled'
    | 'datasetWorkspaceAccess'

type DatasetAccessMockAtom = {
  [DATASET_ACCESS_ATOM_KIND]: DatasetAccessAtomKind
}

type DatasetAccessMockRegistry = {
  getState: () => DatasetAccessMockState
  getOptions: () => DatasetAccessMockOptions
}

const defaultUserProfile = {
  id: 'user-1',
  name: 'User',
  email: 'user@example.com',
  avatar: '',
  avatar_url: '',
  is_password_set: true,
}

let datasetAccessMockRegistry: DatasetAccessMockRegistry | undefined

const createMockAtom = (
  kind: DatasetAccessAtomKind,
): DatasetAccessMockAtom => ({
  [DATASET_ACCESS_ATOM_KIND]: kind,
})

const isDatasetAccessMockAtom = (atom: unknown): atom is DatasetAccessMockAtom => {
  return typeof atom === 'object' && atom !== null && DATASET_ACCESS_ATOM_KIND in atom
}

const getUserProfile = (state: DatasetAccessMockState) => ({
  ...defaultUserProfile,
  ...state.userProfile,
})

const getWorkspacePermissionKeys = (state: DatasetAccessMockState) => state.workspacePermissionKeys ?? []

const getDatasetWorkspaceAccess = (state: DatasetAccessMockState) => {
  const workspacePermissionKeys = getWorkspacePermissionKeys(state)
  const isLoadingCurrentWorkspace = state.isLoadingCurrentWorkspace ?? false
  const isLoadingWorkspacePermissionKeys = state.isLoadingWorkspacePermissionKeys ?? false

  return {
    currentWorkspaceId: state.currentWorkspace?.id ?? 'workspace-1',
    isCurrentWorkspaceOwner: state.isCurrentWorkspaceOwner ?? false,
    isLoadingCurrentWorkspace,
    isLoadingWorkspacePermissionKeys,
    isLoadingAccess: isLoadingCurrentWorkspace || isLoadingWorkspacePermissionKeys,
    workspacePermissionKeys,
    canCreateDataset: hasPermission(workspacePermissionKeys, 'dataset.create_and_management'),
    canConnectExternalDataset: hasPermission(workspacePermissionKeys, 'dataset.external.connect'),
    canManageDatasetTags: hasPermission(workspacePermissionKeys, 'dataset.tag.manage'),
    canManageDatasetApiKeys: hasPermission(workspacePermissionKeys, 'dataset.api_key.manage'),
  }
}

export const createDatasetAccessAtomMock = async (
  importOriginal: <T>() => Promise<T>,
  getState: () => DatasetAccessMockState,
  getOptions: () => DatasetAccessMockOptions = () => ({}),
) => {
  const actual = await importOriginal<typeof import('@/context/app-context-state')>()
  datasetAccessMockRegistry = {
    getState,
    getOptions,
  }

  return {
    ...actual,
    userProfileAtom: createMockAtom('userProfile'),
    workspacePermissionKeysAtom: createMockAtom('workspacePermissionKeys'),
    datasetRbacEnabledAtom: createMockAtom('datasetRbacEnabled'),
    datasetWorkspaceAccessAtom: createMockAtom('datasetWorkspaceAccess'),
  }
}

export const createDatasetAccessJotaiMock = async (
  importOriginal: <T>() => Promise<T>,
) => {
  const actual = await importOriginal<typeof import('jotai')>()

  return {
    ...actual,
    useAtomValue: (atom: unknown) => {
      if (!isDatasetAccessMockAtom(atom))
        return actual.useAtomValue(atom as Parameters<typeof actual.useAtomValue>[0])

      if (!datasetAccessMockRegistry)
        throw new Error('Dataset access atom mock is not initialized')

      const state = datasetAccessMockRegistry.getState()
      const options = datasetAccessMockRegistry.getOptions()
      const userProfile = getUserProfile(state)
      const workspacePermissionKeys = getWorkspacePermissionKeys(state)

      if (atom[DATASET_ACCESS_ATOM_KIND] === 'userProfile')
        return userProfile

      if (atom[DATASET_ACCESS_ATOM_KIND] === 'workspacePermissionKeys')
        return workspacePermissionKeys

      if (atom[DATASET_ACCESS_ATOM_KIND] === 'datasetRbacEnabled')
        return options.isRbacEnabled ?? true

      if (atom[DATASET_ACCESS_ATOM_KIND] === 'datasetWorkspaceAccess')
        return getDatasetWorkspaceAccess(state)

      throw new Error(`Unsupported dataset access atom: ${atom[DATASET_ACCESS_ATOM_KIND]}`)
    },
  }
}
