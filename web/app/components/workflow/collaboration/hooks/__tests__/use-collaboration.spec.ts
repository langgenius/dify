import type { CursorPosition, NodePanelPresenceMap, OnlineUser } from '../../types/collaboration'
import { renderHook, waitFor } from '@testing-library/react'
import { useCollaboration } from '../use-collaboration'

type HookReactFlowStore = NonNullable<Parameters<typeof useCollaboration>[1]>
type HookReactFlowInstance = Parameters<ReturnType<typeof useCollaboration>['startCursorTracking']>[1]

const mockConnect = vi.hoisted(() => vi.fn())
const mockDisconnect = vi.hoisted(() => vi.fn())
const mockIsConnected = vi.hoisted(() => vi.fn(() => true))
const mockEmitCursorMove = vi.hoisted(() => vi.fn())
const mockGetLeaderId = vi.hoisted(() => vi.fn(() => 'leader-1'))

let onStateChangeCallback: ((state: { isConnected?: boolean, disconnectReason?: string, error?: string }) => void) | null = null
let onCursorCallback: ((cursors: Record<string, CursorPosition>) => void) | null = null
let onUsersCallback: ((users: OnlineUser[]) => void) | null = null
let onPresenceCallback: ((presence: NodePanelPresenceMap) => void) | null = null
let onLeaderCallback: ((isLeader: boolean) => void) | null = null

const unsubscribeState = vi.hoisted(() => vi.fn())
const unsubscribeCursor = vi.hoisted(() => vi.fn())
const unsubscribeUsers = vi.hoisted(() => vi.fn())
const unsubscribePresence = vi.hoisted(() => vi.fn())
const unsubscribeLeader = vi.hoisted(() => vi.fn())

let isCollaborationEnabled = true

const mockStartTracking = vi.hoisted(() => vi.fn())
const mockStopTracking = vi.hoisted(() => vi.fn())
const cursorServiceInstances: Array<{ startTracking: typeof mockStartTracking, stopTracking: typeof mockStopTracking }> = []

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: { enable_collaboration_mode: boolean } }) => boolean) =>
    selector({ systemFeatures: { enable_collaboration_mode: isCollaborationEnabled } }),
}))

vi.mock('../../core/collaboration-manager', () => ({
  collaborationManager: {
    connect: (...args: unknown[]) => mockConnect(...args),
    disconnect: (...args: unknown[]) => mockDisconnect(...args),
    isConnected: () => mockIsConnected(),
    emitCursorMove: (...args: unknown[]) => mockEmitCursorMove(...args),
    getLeaderId: () => mockGetLeaderId(),
    onStateChange: (callback: (state: { isConnected?: boolean, disconnectReason?: string, error?: string }) => void) => {
      onStateChangeCallback = callback
      return unsubscribeState
    },
    onCursorUpdate: (callback: (cursors: Record<string, CursorPosition>) => void) => {
      onCursorCallback = callback
      return unsubscribeCursor
    },
    onOnlineUsersUpdate: (callback: (users: OnlineUser[]) => void) => {
      onUsersCallback = callback
      return unsubscribeUsers
    },
    onNodePanelPresenceUpdate: (callback: (presence: NodePanelPresenceMap) => void) => {
      onPresenceCallback = callback
      return unsubscribePresence
    },
    onLeaderChange: (callback: (isLeader: boolean) => void) => {
      onLeaderCallback = callback
      return unsubscribeLeader
    },
  },
}))

vi.mock('../../services/cursor-service', () => ({
  CursorService: class {
    startTracking = mockStartTracking
    stopTracking = mockStopTracking
    constructor() {
      cursorServiceInstances.push({ startTracking: this.startTracking, stopTracking: this.stopTracking })
    }
  },
}))

describe('useCollaboration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    onStateChangeCallback = null
    onCursorCallback = null
    onUsersCallback = null
    onPresenceCallback = null
    onLeaderCallback = null
    isCollaborationEnabled = true
    cursorServiceInstances.length = 0
    mockConnect.mockResolvedValue('conn-1')
    mockIsConnected.mockReturnValue(true)
  })

  it('connects, reacts to manager updates, and disconnects on unmount', async () => {
    const reactFlowStore: HookReactFlowStore = {
      getState: vi.fn(),
    }
    const { result, unmount } = renderHook(() => useCollaboration('app-1', reactFlowStore))

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledWith('app-1', reactFlowStore)
    })

    onStateChangeCallback?.({ isConnected: true })
    onUsersCallback?.([{ user_id: 'u1', username: 'U1', avatar: '', sid: 'sid-1' } as OnlineUser])
    onCursorCallback?.({ u1: { x: 10, y: 20, userId: 'u1', timestamp: 1 } })
    onPresenceCallback?.({ nodeA: { sid1: { userId: 'u1', username: 'U1', clientId: 'sid1', timestamp: 1 } } })
    onLeaderCallback?.(true)

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true)
      expect(result.current.onlineUsers).toHaveLength(1)
      expect(result.current.cursors.u1?.x).toBe(10)
      expect(result.current.nodePanelPresence.nodeA).toBeDefined()
      expect(result.current.isLeader).toBe(true)
      expect(result.current.leaderId).toBe('leader-1')
    })

    const ref = { current: document.createElement('div') }
    const reactFlowInstance: HookReactFlowInstance = {
      getZoom: () => 1,
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    } as HookReactFlowInstance
    result.current.startCursorTracking(ref, reactFlowInstance)
    expect(mockStartTracking).toHaveBeenCalledTimes(1)
    const emitPosition = mockStartTracking.mock.calls[0]?.[1] as ((position: CursorPosition) => void)
    emitPosition({ x: 1, y: 2, userId: 'u1', timestamp: 2 })
    expect(mockEmitCursorMove).toHaveBeenCalledWith({ x: 1, y: 2, userId: 'u1', timestamp: 2 })

    result.current.stopCursorTracking()
    expect(mockStopTracking).toHaveBeenCalled()

    unmount()
    expect(unsubscribeState).toHaveBeenCalled()
    expect(unsubscribeCursor).toHaveBeenCalled()
    expect(unsubscribeUsers).toHaveBeenCalled()
    expect(unsubscribePresence).toHaveBeenCalled()
    expect(unsubscribeLeader).toHaveBeenCalled()
    expect(mockDisconnect).toHaveBeenCalledWith('conn-1')
  })

  it('does not connect or start cursor tracking when collaboration is disabled', async () => {
    isCollaborationEnabled = false
    const { result } = renderHook(() => useCollaboration('app-1'))

    await waitFor(() => {
      expect(mockConnect).not.toHaveBeenCalled()
      expect(result.current.isEnabled).toBe(false)
    })

    result.current.startCursorTracking({ current: document.createElement('div') })
    expect(mockStartTracking).not.toHaveBeenCalled()
  })
})
