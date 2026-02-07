import { act, renderHook } from '@testing-library/react'
import { useNodeMove } from './use-node-move'

type AppStoreState = {
  appDetail?: {
    id: string
  } | null
}

type MoveMutationPayload = {
  appId: string
  nodeId: string
  payload: {
    parent_id: string | null
  }
}

const mocks = vi.hoisted(() => ({
  appStoreState: {
    appDetail: { id: 'app-1' },
  } as AppStoreState,
  movePending: false,
  moveMutateAsync: vi.fn<(payload: MoveMutationPayload) => Promise<void>>(),
  emitTreeUpdate: vi.fn<() => void>(),
  toastNotify: vi.fn<(payload: { type: string, message: string }) => void>(),
  toApiParentId: vi.fn<(folderId: string | null | undefined) => string | null>(),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: AppStoreState) => unknown) => selector(mocks.appStoreState),
}))

vi.mock('@/service/use-app-asset', () => ({
  useMoveAppAssetNode: () => ({
    mutateAsync: mocks.moveMutateAsync,
    isPending: mocks.movePending,
  }),
}))

vi.mock('../data/use-skill-tree-collaboration', () => ({
  useSkillTreeUpdateEmitter: () => mocks.emitTreeUpdate,
}))

vi.mock('../../../utils/tree-utils', () => ({
  toApiParentId: mocks.toApiParentId,
}))

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: mocks.toastNotify,
  },
}))

describe('useNodeMove', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.appStoreState.appDetail = { id: 'app-1' }
    mocks.movePending = false
    mocks.moveMutateAsync.mockResolvedValue(undefined)
    mocks.toApiParentId.mockImplementation(folderId => folderId ?? null)
  })

  // Scenario: loading state should mirror mutation pending state.
  describe('State', () => {
    it('should expose mutation pending state as isMoving', () => {
      mocks.movePending = true

      const { result } = renderHook(() => useNodeMove())

      expect(result.current.isMoving).toBe(true)
    })
  })

  // Scenario: successful move should call API, emit update, and show success toast.
  describe('Success', () => {
    it('should move node and emit collaboration update when API succeeds', async () => {
      mocks.toApiParentId.mockReturnValueOnce('parent-api-id')
      const { result } = renderHook(() => useNodeMove())

      await act(async () => {
        await result.current.executeMoveNode('node-11', 'folder-22')
      })

      expect(mocks.toApiParentId).toHaveBeenCalledWith('folder-22')
      expect(mocks.moveMutateAsync).toHaveBeenCalledWith({
        appId: 'app-1',
        nodeId: 'node-11',
        payload: {
          parent_id: 'parent-api-id',
        },
      })
      expect(mocks.emitTreeUpdate).toHaveBeenCalledTimes(1)
      expect(mocks.toastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'workflow.skillSidebar.menu.moved',
      })
    })

    it('should use empty appId when app detail is unavailable', async () => {
      mocks.appStoreState.appDetail = undefined
      mocks.toApiParentId.mockReturnValueOnce(null)
      const { result } = renderHook(() => useNodeMove())

      await act(async () => {
        await result.current.executeMoveNode('node-99', null)
      })

      expect(mocks.moveMutateAsync).toHaveBeenCalledWith({
        appId: '',
        nodeId: 'node-99',
        payload: {
          parent_id: null,
        },
      })
    })
  })

  // Scenario: failed move should surface an error toast and skip update emission.
  describe('Error handling', () => {
    it('should show error toast when move fails', async () => {
      mocks.moveMutateAsync.mockRejectedValueOnce(new Error('move failed'))
      const { result } = renderHook(() => useNodeMove())

      await act(async () => {
        await result.current.executeMoveNode('node-7', 'folder-7')
      })

      expect(mocks.emitTreeUpdate).not.toHaveBeenCalled()
      expect(mocks.toastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflow.skillSidebar.menu.moveError',
      })
    })
  })
})
