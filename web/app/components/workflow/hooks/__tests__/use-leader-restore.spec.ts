import type { RestoreIntentData, RestoreRequestData } from '../../collaboration/types/collaboration'
import type { SyncDraftCallback } from '../../hooks-store/store'
import type { Edge, Node } from '../../types'
import { act, renderHook } from '@testing-library/react'
import { ChatVarType } from '../../panel/chat-variable-panel/type'
import { useLeaderRestore, useLeaderRestoreListener } from '../use-leader-restore'

const mockSetViewport = vi.hoisted(() => vi.fn())
const mockSetFeatures = vi.hoisted(() => vi.fn())
const mockSetEnvironmentVariables = vi.hoisted(() => vi.fn())
const mockSetConversationVariables = vi.hoisted(() => vi.fn())
const mockDoSyncWorkflowDraft = vi.hoisted(() => vi.fn())
const mockToastInfo = vi.hoisted(() => vi.fn())

const mockEmitRestoreIntent = vi.hoisted(() => vi.fn())
const mockEmitRestoreComplete = vi.hoisted(() => vi.fn())
const mockEmitWorkflowUpdate = vi.hoisted(() => vi.fn())
const mockEmitRestoreRequest = vi.hoisted(() => vi.fn())
const mockIsConnected = vi.hoisted(() => vi.fn())
const mockGetIsLeader = vi.hoisted(() => vi.fn())
const mockSetNodes = vi.hoisted(() => vi.fn())
const mockSetEdges = vi.hoisted(() => vi.fn())
const mockRefreshGraphSynchronously = vi.hoisted(() => vi.fn())
const mockGetNodes = vi.hoisted(() => vi.fn(() => [{ id: 'old-node' } as unknown as Node]))
const mockGetEdges = vi.hoisted(() => vi.fn(() => [{ id: 'old-edge' } as unknown as Edge]))

let restoreCompleteCallback: ((data: { versionId: string, success: boolean }) => void) | null = null
let restoreRequestCallback: ((data: RestoreRequestData) => void) | null = null
let restoreIntentCallback: ((data: RestoreIntentData) => void) | null = null

const unsubscribeRestoreComplete = vi.hoisted(() => vi.fn())
const unsubscribeRestoreRequest = vi.hoisted(() => vi.fn())
const unsubscribeRestoreIntent = vi.hoisted(() => vi.fn())

let isCollaborationEnabled = true

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string, userName?: string, versionName?: string }) => {
      const ns = options?.ns ? `${options.ns}.` : ''
      const extra = options?.userName ? `:${options.userName}:${options.versionName}` : ''
      return `${ns}${key}${extra}`
    },
  }),
}))

vi.mock('reactflow', () => ({
  useReactFlow: () => ({
    setViewport: mockSetViewport,
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: {
    getState: () => ({
      appDetail: { id: 'app-1' },
    }),
  },
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeaturesStore: () => ({
    getState: () => ({
      setFeatures: mockSetFeatures,
    }),
  }),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    info: (...args: unknown[]) => mockToastInfo(...args),
  },
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: { enable_collaboration_mode: boolean } }) => boolean) =>
    selector({ systemFeatures: { enable_collaboration_mode: isCollaborationEnabled } }),
}))

vi.mock('../../store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      setEnvironmentVariables: mockSetEnvironmentVariables,
      setConversationVariables: mockSetConversationVariables,
    }),
  }),
}))

vi.mock('../use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    doSyncWorkflowDraft: (...args: unknown[]) => mockDoSyncWorkflowDraft(...args),
  }),
}))

vi.mock('../../collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    emitRestoreIntent: (...args: unknown[]) => mockEmitRestoreIntent(...args),
    emitRestoreComplete: (...args: unknown[]) => mockEmitRestoreComplete(...args),
    emitWorkflowUpdate: (...args: unknown[]) => mockEmitWorkflowUpdate(...args),
    emitRestoreRequest: (...args: unknown[]) => mockEmitRestoreRequest(...args),
    isConnected: (...args: unknown[]) => mockIsConnected(...args),
    getIsLeader: (...args: unknown[]) => mockGetIsLeader(...args),
    setNodes: (...args: unknown[]) => mockSetNodes(...args),
    setEdges: (...args: unknown[]) => mockSetEdges(...args),
    refreshGraphSynchronously: (...args: unknown[]) => mockRefreshGraphSynchronously(...args),
    getNodes: () => mockGetNodes(),
    getEdges: () => mockGetEdges(),
    onRestoreComplete: (callback: (data: { versionId: string, success: boolean }) => void) => {
      restoreCompleteCallback = callback
      return unsubscribeRestoreComplete
    },
    onRestoreRequest: (callback: (data: RestoreRequestData) => void) => {
      restoreRequestCallback = callback
      return unsubscribeRestoreRequest
    },
    onRestoreIntent: (callback: (data: RestoreIntentData) => void) => {
      restoreIntentCallback = callback
      return unsubscribeRestoreIntent
    },
  },
}))

describe('useLeaderRestore', () => {
  const restoreData: RestoreRequestData = {
    versionId: 'v-1',
    versionName: 'Version One',
    initiatorUserId: 'u-1',
    initiatorName: 'Alice',
    features: { moreLikeThis: { enabled: true } },
    environmentVariables: [{ id: 'env-1', name: 'A', value: '1', value_type: ChatVarType.String, description: '' }],
    conversationVariables: [{ id: 'conv-1', name: 'B', value: '2', value_type: ChatVarType.String, description: '' }],
    graphData: {
      nodes: [{ id: 'new-node' } as unknown as Node],
      edges: [{ id: 'new-edge' } as unknown as Edge],
      viewport: { x: 1, y: 2, zoom: 0.5 },
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    restoreCompleteCallback = null
    restoreRequestCallback = null
    restoreIntentCallback = null
    isCollaborationEnabled = true
    mockIsConnected.mockReturnValue(true)
    mockGetIsLeader.mockReturnValue(false)
    mockDoSyncWorkflowDraft.mockImplementation((_sync: boolean, callbacks?: SyncDraftCallback) => {
      callbacks?.onSuccess?.()
      callbacks?.onSettled?.()
    })
  })

  it('performs restore locally when collaboration is disabled', async () => {
    isCollaborationEnabled = false
    const onSuccess = vi.fn()
    const onSettled = vi.fn()

    const { result } = renderHook(() => useLeaderRestore())

    await act(async () => {
      result.current.requestRestore(restoreData, { onSuccess, onSettled })
    })

    expect(mockEmitRestoreIntent).toHaveBeenCalledWith(expect.objectContaining({
      versionId: 'v-1',
      initiatorName: 'Alice',
    }))
    expect(mockSetFeatures).toHaveBeenCalledWith({ moreLikeThis: { enabled: true } })
    expect(mockSetEnvironmentVariables).toHaveBeenCalled()
    expect(mockSetConversationVariables).toHaveBeenCalled()
    expect(mockSetNodes).toHaveBeenCalledWith([{ id: 'old-node' }], [{ id: 'new-node' }], 'leader-restore:apply-graph')
    expect(mockSetEdges).toHaveBeenCalledWith([{ id: 'old-edge' }], [{ id: 'new-edge' }])
    expect(mockRefreshGraphSynchronously).toHaveBeenCalled()
    expect(mockSetViewport).toHaveBeenCalledWith({ x: 1, y: 2, zoom: 0.5 })
    expect(mockEmitRestoreComplete).toHaveBeenCalledWith({ versionId: 'v-1', success: true })
    expect(mockEmitWorkflowUpdate).toHaveBeenCalledWith('app-1')
    expect(onSuccess).toHaveBeenCalled()
    expect(onSettled).toHaveBeenCalled()
  })

  it('emits restore request and resolves callbacks from restore-complete events', async () => {
    isCollaborationEnabled = true
    mockIsConnected.mockReturnValue(true)
    mockGetIsLeader.mockReturnValue(false)
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const onSettled = vi.fn()

    const { result } = renderHook(() => useLeaderRestore())

    act(() => {
      result.current.requestRestore(restoreData, { onSuccess, onError, onSettled })
    })

    expect(mockEmitRestoreRequest).toHaveBeenCalledWith(restoreData)
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()

    act(() => {
      restoreCompleteCallback?.({ versionId: 'v-1', success: true })
    })
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.requestRestore(restoreData, { onSuccess, onError, onSettled })
      restoreCompleteCallback?.({ versionId: 'v-1', success: false })
    })
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledTimes(2)
  })
})

describe('useLeaderRestoreListener', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    restoreRequestCallback = null
    restoreIntentCallback = null
    mockDoSyncWorkflowDraft.mockImplementation((_sync: boolean, callbacks?: SyncDraftCallback) => {
      callbacks?.onSuccess?.()
      callbacks?.onSettled?.()
    })
  })

  it('shows restore notifications for request and intent events', () => {
    const { unmount } = renderHook(() => useLeaderRestoreListener())

    act(() => {
      restoreRequestCallback?.({
        ...{
          versionId: 'v-2',
          versionName: 'Version Two',
          initiatorUserId: 'u-2',
          initiatorName: 'Bob',
          graphData: { nodes: [], edges: [] },
        },
      })
    })

    expect(mockToastInfo).toHaveBeenCalledWith(
      'workflow.versionHistory.action.restoreInProgress:Bob:Version Two',
      { timeout: 3000 },
    )
    expect(mockEmitRestoreIntent).toHaveBeenCalled()

    act(() => {
      restoreIntentCallback?.({
        versionId: 'v-3',
        versionName: 'Version Three',
        initiatorUserId: 'u-3',
        initiatorName: 'Carol',
      })
    })
    expect(mockToastInfo).toHaveBeenCalledWith(
      'workflow.versionHistory.action.restoreInProgress:Carol:Version Three',
      { timeout: 3000 },
    )

    unmount()
    expect(unsubscribeRestoreRequest).toHaveBeenCalled()
    expect(unsubscribeRestoreIntent).toHaveBeenCalled()
  })
})
