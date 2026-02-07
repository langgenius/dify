import type { ReactNode } from 'react'
import type { App, AppSSO } from '@/types/app'
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { consoleQuery } from '@/service/client'
import {
  useSkillTreeCollaboration,
  useSkillTreeUpdateEmitter,
} from './use-skill-tree-collaboration'

const {
  mockEmitTreeUpdate,
  mockOnTreeUpdate,
  mockUnsubscribe,
} = vi.hoisted(() => ({
  mockEmitTreeUpdate: vi.fn(),
  mockOnTreeUpdate: vi.fn(),
  mockUnsubscribe: vi.fn(),
}))

vi.mock('@/app/components/workflow/collaboration/skills/skill-collaboration-manager', () => ({
  skillCollaborationManager: {
    emitTreeUpdate: mockEmitTreeUpdate,
    onTreeUpdate: mockOnTreeUpdate,
  },
}))

const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

describe('useSkillTreeCollaboration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      appDetail: { id: 'app-1' } as App & Partial<AppSSO>,
    })

    const currentFeatures = useGlobalPublicStore.getState().systemFeatures
    useGlobalPublicStore.setState({
      systemFeatures: {
        ...currentFeatures,
        enable_collaboration_mode: true,
      },
    })

    mockOnTreeUpdate.mockReturnValue(mockUnsubscribe)
  })

  // Scenario: update emitter sends events only when collaboration is enabled and app id exists.
  describe('useSkillTreeUpdateEmitter', () => {
    it('should emit tree update with app id and payload', () => {
      const { result } = renderHook(() => useSkillTreeUpdateEmitter())

      act(() => {
        result.current({ source: 'test' })
      })

      expect(mockEmitTreeUpdate).toHaveBeenCalledWith('app-1', { source: 'test' })
    })

    it('should not emit tree update when collaboration is disabled', () => {
      const currentFeatures = useGlobalPublicStore.getState().systemFeatures
      useGlobalPublicStore.setState({
        systemFeatures: {
          ...currentFeatures,
          enable_collaboration_mode: false,
        },
      })

      const { result } = renderHook(() => useSkillTreeUpdateEmitter())
      act(() => {
        result.current({ source: 'disabled' })
      })

      expect(mockEmitTreeUpdate).not.toHaveBeenCalled()
    })

    it('should not emit tree update when app id is missing', () => {
      useAppStore.setState({ appDetail: undefined })

      const { result } = renderHook(() => useSkillTreeUpdateEmitter())
      act(() => {
        result.current({ source: 'no-app' })
      })

      expect(mockEmitTreeUpdate).not.toHaveBeenCalled()
    })
  })

  // Scenario: collaboration hook subscribes to updates and invalidates tree query cache.
  describe('useSkillTreeCollaboration', () => {
    it('should subscribe to tree updates and invalidate app tree query when updates arrive', async () => {
      let treeUpdateCallback: ((payload: Record<string, unknown>) => void) | null = null
      mockOnTreeUpdate.mockImplementation((_appId: string, callback: (payload: Record<string, unknown>) => void) => {
        treeUpdateCallback = callback
        return mockUnsubscribe
      })

      const queryClient = new QueryClient()
      const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

      renderHook(() => useSkillTreeCollaboration(), {
        wrapper: createWrapper(queryClient),
      })

      expect(mockOnTreeUpdate).toHaveBeenCalledWith('app-1', expect.any(Function))

      act(() => {
        treeUpdateCallback?.({ reason: 'remote' })
      })

      await waitFor(() => {
        expect(invalidateQueriesSpy).toHaveBeenCalledWith({
          queryKey: consoleQuery.appAsset.tree.queryKey({ input: { params: { appId: 'app-1' } } }),
        })
      })
    })

    it('should clean up tree update subscription on unmount', () => {
      const queryClient = new QueryClient()
      const { unmount } = renderHook(() => useSkillTreeCollaboration(), {
        wrapper: createWrapper(queryClient),
      })

      unmount()

      expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
    })

    it('should skip subscription when collaboration is disabled', () => {
      const currentFeatures = useGlobalPublicStore.getState().systemFeatures
      useGlobalPublicStore.setState({
        systemFeatures: {
          ...currentFeatures,
          enable_collaboration_mode: false,
        },
      })

      const queryClient = new QueryClient()
      renderHook(() => useSkillTreeCollaboration(), {
        wrapper: createWrapper(queryClient),
      })

      expect(mockOnTreeUpdate).not.toHaveBeenCalled()
    })

    it('should skip subscription when app id is missing', () => {
      useAppStore.setState({ appDetail: undefined })

      const queryClient = new QueryClient()
      renderHook(() => useSkillTreeCollaboration(), {
        wrapper: createWrapper(queryClient),
      })

      expect(mockOnTreeUpdate).not.toHaveBeenCalled()
    })
  })
})
