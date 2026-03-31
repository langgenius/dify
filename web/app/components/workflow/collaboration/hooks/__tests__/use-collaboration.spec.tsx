import { renderHook, waitFor } from '@testing-library/react'
import { useCollaboration } from '../use-collaboration'

const mocks = vi.hoisted(() => ({
  connect: vi.fn<(appId: string) => Promise<string>>().mockResolvedValue('connection-1'),
  disconnect: vi.fn<(connectionId?: string) => void>(),
  onStateChange: vi.fn(() => vi.fn()),
  onCursorUpdate: vi.fn(() => vi.fn()),
  onOnlineUsersUpdate: vi.fn(() => vi.fn()),
  onNodePanelPresenceUpdate: vi.fn(() => vi.fn()),
  onLeaderChange: vi.fn(() => vi.fn()),
  setReactFlowStore: vi.fn<(store: unknown) => void>(),
  isConnected: vi.fn<() => boolean>(() => false),
  getLeaderId: vi.fn<() => string | null>(() => null),
  emitCursorMove: vi.fn<(position: unknown) => void>(),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: <T,>(selector: (state: { systemFeatures: { enable_collaboration_mode: boolean } }) => T) => selector({
    systemFeatures: {
      enable_collaboration_mode: true,
    },
  }),
}))

vi.mock('../../core/collaboration-manager', () => ({
  collaborationManager: {
    connect: (appId: string) => mocks.connect(appId),
    disconnect: (connectionId?: string) => mocks.disconnect(connectionId),
    onStateChange: () => mocks.onStateChange(),
    onCursorUpdate: () => mocks.onCursorUpdate(),
    onOnlineUsersUpdate: () => mocks.onOnlineUsersUpdate(),
    onNodePanelPresenceUpdate: () => mocks.onNodePanelPresenceUpdate(),
    onLeaderChange: () => mocks.onLeaderChange(),
    setReactFlowStore: (store: unknown) => mocks.setReactFlowStore(store),
    isConnected: () => mocks.isConnected(),
    getLeaderId: () => mocks.getLeaderId(),
    emitCursorMove: (position: unknown) => mocks.emitCursorMove(position),
  },
}))

describe('useCollaboration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should skip collaboration setup when disabled by the caller', async () => {
    const reactFlowStore = {
      getState: vi.fn(),
    }

    const { result } = renderHook(() => useCollaboration('app-1', reactFlowStore as never, false))

    await waitFor(() => {
      expect(mocks.setReactFlowStore).toHaveBeenCalledWith(null)
    })

    expect(mocks.connect).not.toHaveBeenCalled()
    expect(result.current.isEnabled).toBe(false)
    expect(result.current.onlineUsers).toEqual([])
    expect(result.current.nodePanelPresence).toEqual({})
  })

  it('should connect and attach the react flow store when collaboration is enabled', async () => {
    const reactFlowStore = {
      getState: vi.fn(),
    }

    const { result } = renderHook(() => useCollaboration('app-1', reactFlowStore as never, true))

    await waitFor(() => {
      expect(mocks.connect).toHaveBeenCalledWith('app-1')
      expect(mocks.setReactFlowStore).toHaveBeenCalledWith(reactFlowStore)
    })

    expect(result.current.isEnabled).toBe(true)
  })

  it('should disconnect and clear the react flow store when collaboration gets disabled', async () => {
    const reactFlowStore = {
      getState: vi.fn(),
    }

    const { rerender } = renderHook(
      ({ enabled }) => useCollaboration('app-1', reactFlowStore as never, enabled),
      {
        initialProps: {
          enabled: true,
        },
      },
    )

    await waitFor(() => {
      expect(mocks.connect).toHaveBeenCalledWith('app-1')
      expect(mocks.setReactFlowStore).toHaveBeenCalledWith(reactFlowStore)
    })

    rerender({ enabled: false })

    await waitFor(() => {
      expect(mocks.disconnect).toHaveBeenCalledWith('connection-1')
      expect(mocks.setReactFlowStore).toHaveBeenLastCalledWith(null)
    })
  })
})
