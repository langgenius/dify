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

type DatasetAccessAtomKind =
  | 'userProfile'
  | 'userProfileId'
  | 'currentWorkspaceId'
  | 'isCurrentWorkspaceOwner'
  | 'workspacePermissionKeys'
  | 'currentWorkspaceLoading'
  | 'workspacePermissionKeysLoading'
  | 'datasetRbacEnabled'

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

const createMockAtom = (kind: DatasetAccessAtomKind): DatasetAccessMockAtom => ({
  [DATASET_ACCESS_ATOM_KIND]: kind,
})

const isDatasetAccessMockAtom = (atom: unknown): atom is DatasetAccessMockAtom => {
  return typeof atom === 'object' && atom !== null && DATASET_ACCESS_ATOM_KIND in atom
}

const getUserProfile = (state: DatasetAccessMockState) => ({
  ...defaultUserProfile,
  ...state.userProfile,
})

const getWorkspacePermissionKeys = (state: DatasetAccessMockState) =>
  state.workspacePermissionKeys ?? []

export const createDatasetAccessAtomMock = async <TModule extends object>(
  importOriginal: <T>() => Promise<T>,
  getState: () => DatasetAccessMockState,
  getOptions: () => DatasetAccessMockOptions = () => ({}),
) => {
  const actual = await importOriginal<TModule>()
  datasetAccessMockRegistry = {
    getState,
    getOptions,
  }

  return {
    ...actual,
    userProfileAtom: createMockAtom('userProfile'),
    userProfileIdAtom: createMockAtom('userProfileId'),
    currentWorkspaceIdAtom: createMockAtom('currentWorkspaceId'),
    isCurrentWorkspaceOwnerAtom: createMockAtom('isCurrentWorkspaceOwner'),
    workspacePermissionKeysAtom: createMockAtom('workspacePermissionKeys'),
    currentWorkspaceLoadingAtom: createMockAtom('currentWorkspaceLoading'),
    workspacePermissionKeysLoadingAtom: createMockAtom('workspacePermissionKeysLoading'),
    datasetRbacEnabledAtom: createMockAtom('datasetRbacEnabled'),
  }
}

export const createDatasetAccessJotaiMock = async (importOriginal: <T>() => Promise<T>) => {
  const actual = await importOriginal<typeof import('jotai')>()

  return {
    ...actual,
    useAtomValue: (atom: unknown) => {
      if (!isDatasetAccessMockAtom(atom))
        return actual.useAtomValue(atom as Parameters<typeof actual.useAtomValue>[0])

      if (!datasetAccessMockRegistry) throw new Error('Dataset access atom mock is not initialized')

      const state = datasetAccessMockRegistry.getState()
      const options = datasetAccessMockRegistry.getOptions()
      const userProfile = getUserProfile(state)
      const workspacePermissionKeys = getWorkspacePermissionKeys(state)

      if (atom[DATASET_ACCESS_ATOM_KIND] === 'userProfile') return userProfile

      if (atom[DATASET_ACCESS_ATOM_KIND] === 'userProfileId') return userProfile.id

      if (atom[DATASET_ACCESS_ATOM_KIND] === 'currentWorkspaceId')
        return state.currentWorkspace?.id ?? 'workspace-1'

      if (atom[DATASET_ACCESS_ATOM_KIND] === 'isCurrentWorkspaceOwner')
        return state.isCurrentWorkspaceOwner ?? false

      if (atom[DATASET_ACCESS_ATOM_KIND] === 'workspacePermissionKeys')
        return workspacePermissionKeys

      if (atom[DATASET_ACCESS_ATOM_KIND] === 'currentWorkspaceLoading')
        return state.isLoadingCurrentWorkspace ?? false

      if (atom[DATASET_ACCESS_ATOM_KIND] === 'workspacePermissionKeysLoading')
        return state.isLoadingWorkspacePermissionKeys ?? false

      if (atom[DATASET_ACCESS_ATOM_KIND] === 'datasetRbacEnabled')
        return options.isRbacEnabled ?? true

      throw new Error(`Unsupported dataset access atom: ${atom[DATASET_ACCESS_ATOM_KIND]}`)
    },
  }
}
