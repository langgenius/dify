import { act, renderHook } from '@testing-library/react'
import { useNodeReorder } from './use-node-reorder'

type AppStoreState = {
  appDetail?: {
    id: string
  } | null
}

type ReorderMutationPayload = {
  appId: string
  nodeId: string
  payload: {
    after_node_id: string | null
  }
}

const mocks = vi.hoisted(() => ({
  appStoreState: {
    appDetail: { id: 'app-10' },
  } as AppStoreState,
  reorderPending: false,
  reorderMutateAsync: vi.fn<(payload: ReorderMutationPayload) => Promise<void>>(),
  emitTreeUpdate: vi.fn<() => void>(),
  toastNotify: vi.fn<(payload: { type: string, message: string }) => void>(),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: AppStoreState) => unknown) => selector(mocks.appStoreState),
}))

vi.mock('@/service/use-app-asset', () => ({
  useReorderAppAssetNode: () => ({
    mutateAsync: mocks.reorderMutateAsync,
    isPending: mocks.reorderPending,
  }),
}))

vi.mock('../data/use-skill-tree-collaboration', () => ({
  useSkillTreeUpdateEmitter: () => mocks.emitTreeUpdate,
}))

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: mocks.toastNotify,
  },
}))

describe('useNodeReorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.appStoreState.appDetail = { id: 'app-10' }
    mocks.reorderPending = false
    mocks.reorderMutateAsync.mockResolvedValue(undefined)
  })

  // Scenario: loading state should mirror reorder mutation status.
  describe('State', () => {
    it('should expose mutation pending state as isReordering', () => {
      mocks.reorderPending = true

      const { result } = renderHook(() => useNodeReorder())

      expect(result.current.isReordering).toBe(true)
    })
  })

  // Scenario: successful reorder should call API, emit update, and notify success.
  describe('Success', () => {
    it('should reorder node with provided afterNodeId', async () => {
      const { result } = renderHook(() => useNodeReorder())

      await act(async () => {
        await result.current.executeReorderNode('node-1', 'node-0')
      })

      expect(mocks.reorderMutateAsync).toHaveBeenCalledWith({
        appId: 'app-10',
        nodeId: 'node-1',
        payload: {
          after_node_id: 'node-0',
        },
      })
      expect(mocks.emitTreeUpdate).toHaveBeenCalledTimes(1)
      expect(mocks.toastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'workflow.skillSidebar.menu.moved',
      })
    })

    it('should use empty appId when app detail is missing', async () => {
      mocks.appStoreState.appDetail = null
      const { result } = renderHook(() => useNodeReorder())

      await act(async () => {
        await result.current.executeReorderNode('node-2', null)
      })

      expect(mocks.reorderMutateAsync).toHaveBeenCalledWith({
        appId: '',
        nodeId: 'node-2',
        payload: {
          after_node_id: null,
        },
      })
    })
  })

  // Scenario: failed reorder should not emit update and should show error toast.
  describe('Error handling', () => {
    it('should show error toast when reorder fails', async () => {
      mocks.reorderMutateAsync.mockRejectedValueOnce(new Error('reorder failed'))
      const { result } = renderHook(() => useNodeReorder())

      await act(async () => {
        await result.current.executeReorderNode('node-3', 'node-1')
      })

      expect(mocks.emitTreeUpdate).not.toHaveBeenCalled()
      expect(mocks.toastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflow.skillSidebar.menu.moveError',
      })
    })
  })
})
