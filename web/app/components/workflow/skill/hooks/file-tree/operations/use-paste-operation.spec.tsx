import type { RefObject } from 'react'
import type { TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../../../type'
import type { AppAssetTreeResponse } from '@/types/app-asset'
import { act, renderHook, waitFor } from '@testing-library/react'
import { usePasteOperation } from './use-paste-operation'

type MoveMutationPayload = {
  appId: string
  nodeId: string
  payload: {
    parent_id: string | null
  }
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type WorkflowStoreState = {
  clipboard: {
    operation: 'cut'
    nodeIds: Set<string>
  } | null
  selectedTreeNodeId: string | null
  clearClipboard: () => void
}

type AppStoreState = {
  appDetail?: {
    id: string
  } | null
}

const mocks = vi.hoisted(() => ({
  workflowState: {
    clipboard: null,
    selectedTreeNodeId: null,
    clearClipboard: vi.fn<() => void>(),
  } as WorkflowStoreState,
  appStoreState: {
    appDetail: { id: 'app-1' },
  } as AppStoreState,
  movePending: false,
  moveMutateAsync: vi.fn<(payload: MoveMutationPayload) => Promise<void>>(),
  emitTreeUpdate: vi.fn<() => void>(),
  toastNotify: vi.fn<(payload: { type: string, message: string }) => void>(),
  getTargetFolderIdFromSelection: vi.fn<(selectedId: string | null, nodes: TreeNodeData[]) => string>(),
  toApiParentId: vi.fn<(folderId: string | null | undefined) => string | null>(),
  findNodeById: vi.fn<(nodes: TreeNodeData[], nodeId: string) => TreeNodeData | null>(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => mocks.workflowState,
  }),
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
  getTargetFolderIdFromSelection: mocks.getTargetFolderIdFromSelection,
  toApiParentId: mocks.toApiParentId,
  findNodeById: mocks.findNodeById,
}))

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: mocks.toastNotify,
  },
}))

const createTreeNode = (id: string, nodeType: 'file' | 'folder'): TreeNodeData => ({
  id,
  node_type: nodeType,
  name: nodeType === 'folder' ? `folder-${id}` : `${id}.md`,
  path: `/${id}`,
  extension: nodeType === 'folder' ? '' : 'md',
  size: 1,
  children: [],
})

const createTreeRef = (selectedId?: string): RefObject<TreeApi<TreeNodeData> | null> => {
  const selectedNodes = selectedId ? [{ id: selectedId }] : []
  return {
    current: {
      selectedNodes,
    },
  } as unknown as RefObject<TreeApi<TreeNodeData> | null>
}

describe('usePasteOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workflowState.clipboard = null
    mocks.workflowState.selectedTreeNodeId = null
    mocks.appStoreState.appDetail = { id: 'app-1' }
    mocks.movePending = false
    mocks.moveMutateAsync.mockResolvedValue(undefined)
    mocks.getTargetFolderIdFromSelection.mockReturnValue('target-folder')
    mocks.toApiParentId.mockReturnValue('target-parent')
    mocks.findNodeById.mockReturnValue(null)
  })

  // Scenario: isPasting output should reflect mutation pending state.
  describe('State', () => {
    it('should expose mutation pending state as isPasting', () => {
      mocks.movePending = true
      const treeRef = createTreeRef('selected')

      const { result } = renderHook(() => usePasteOperation({ treeRef }))

      expect(result.current.isPasting).toBe(true)
    })
  })

  // Scenario: guard clauses should skip paste work when clipboard is unavailable.
  describe('Guards', () => {
    it('should no-op when clipboard is empty', async () => {
      const treeRef = createTreeRef('selected')
      const { result } = renderHook(() => usePasteOperation({ treeRef }))

      await act(async () => {
        await result.current.handlePaste()
      })

      expect(mocks.getTargetFolderIdFromSelection).not.toHaveBeenCalled()
      expect(mocks.moveMutateAsync).not.toHaveBeenCalled()
      expect(mocks.toastNotify).not.toHaveBeenCalled()
    })

    it('should no-op when clipboard has no node ids', async () => {
      mocks.workflowState.clipboard = {
        operation: 'cut',
        nodeIds: new Set(),
      }
      const treeRef = createTreeRef('selected')
      const { result } = renderHook(() => usePasteOperation({ treeRef }))

      await act(async () => {
        await result.current.handlePaste()
      })

      expect(mocks.getTargetFolderIdFromSelection).not.toHaveBeenCalled()
      expect(mocks.moveMutateAsync).not.toHaveBeenCalled()
    })

    it('should reject moving folder into itself and show error toast', async () => {
      mocks.workflowState.clipboard = {
        operation: 'cut',
        nodeIds: new Set(['folder-1']),
      }
      mocks.getTargetFolderIdFromSelection.mockReturnValueOnce('folder-1')
      mocks.findNodeById.mockReturnValueOnce(createTreeNode('folder-1', 'folder'))
      const treeRef = createTreeRef('folder-1')
      const treeData: AppAssetTreeResponse = {
        children: [createTreeNode('folder-1', 'folder')],
      }
      const { result } = renderHook(() => usePasteOperation({ treeRef, treeData }))

      await act(async () => {
        await result.current.handlePaste()
      })

      expect(mocks.moveMutateAsync).not.toHaveBeenCalled()
      expect(mocks.toastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflow.skillSidebar.menu.cannotMoveToSelf',
      })
    })
  })

  // Scenario: successful cut-paste should move all nodes and clear clipboard.
  describe('Success', () => {
    it('should move cut nodes, clear clipboard, and emit update', async () => {
      mocks.workflowState.clipboard = {
        operation: 'cut',
        nodeIds: new Set(['node-1', 'node-2']),
      }
      const treeRef = createTreeRef('selected-node')
      const treeData: AppAssetTreeResponse = {
        children: [createTreeNode('node-1', 'file'), createTreeNode('node-2', 'file')],
      }

      const { result } = renderHook(() => usePasteOperation({ treeRef, treeData }))

      await act(async () => {
        await result.current.handlePaste()
      })

      expect(mocks.getTargetFolderIdFromSelection).toHaveBeenCalledWith('selected-node', treeData.children)
      expect(mocks.toApiParentId).toHaveBeenCalledWith('target-folder')
      expect(mocks.moveMutateAsync).toHaveBeenCalledTimes(2)
      expect(mocks.moveMutateAsync).toHaveBeenNthCalledWith(1, {
        appId: 'app-1',
        nodeId: 'node-1',
        payload: {
          parent_id: 'target-parent',
        },
      })
      expect(mocks.moveMutateAsync).toHaveBeenNthCalledWith(2, {
        appId: 'app-1',
        nodeId: 'node-2',
        payload: {
          parent_id: 'target-parent',
        },
      })
      expect(mocks.workflowState.clearClipboard).toHaveBeenCalledTimes(1)
      expect(mocks.emitTreeUpdate).toHaveBeenCalledTimes(1)
      expect(mocks.toastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'workflow.skillSidebar.menu.moved',
      })
    })

    it('should fallback to selectedTreeNodeId when tree has no selected node', async () => {
      mocks.workflowState.clipboard = {
        operation: 'cut',
        nodeIds: new Set(['node-store']),
      }
      mocks.workflowState.selectedTreeNodeId = 'store-selected'
      const treeRef = createTreeRef()
      const treeData: AppAssetTreeResponse = {
        children: [createTreeNode('node-store', 'file')],
      }
      const { result } = renderHook(() => usePasteOperation({ treeRef, treeData }))

      await act(async () => {
        await result.current.handlePaste()
      })

      expect(mocks.getTargetFolderIdFromSelection).toHaveBeenCalledWith('store-selected', treeData.children)
      expect(mocks.moveMutateAsync).toHaveBeenCalledTimes(1)
    })
  })

  // Scenario: failed paste should keep clipboard and show error toast.
  describe('Error handling', () => {
    it('should show move error toast when API call fails', async () => {
      mocks.workflowState.clipboard = {
        operation: 'cut',
        nodeIds: new Set(['node-error']),
      }
      mocks.moveMutateAsync.mockRejectedValueOnce(new Error('move failed'))
      const treeRef = createTreeRef('target')
      const treeData: AppAssetTreeResponse = {
        children: [createTreeNode('node-error', 'file')],
      }

      const { result } = renderHook(() => usePasteOperation({ treeRef, treeData }))

      await act(async () => {
        await result.current.handlePaste()
      })

      expect(mocks.workflowState.clearClipboard).not.toHaveBeenCalled()
      expect(mocks.emitTreeUpdate).not.toHaveBeenCalled()
      expect(mocks.toastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflow.skillSidebar.menu.moveError',
      })
    })

    it('should prevent re-entrant paste while a paste is in progress', async () => {
      mocks.workflowState.clipboard = {
        operation: 'cut',
        nodeIds: new Set(['node-slow']),
      }
      const deferred = createDeferred<void>()
      mocks.moveMutateAsync.mockReturnValueOnce(deferred.promise)
      const treeRef = createTreeRef('target')
      const treeData: AppAssetTreeResponse = {
        children: [createTreeNode('node-slow', 'file')],
      }

      const { result } = renderHook(() => usePasteOperation({ treeRef, treeData }))

      act(() => {
        void result.current.handlePaste()
        void result.current.handlePaste()
      })

      expect(mocks.moveMutateAsync).toHaveBeenCalledTimes(1)

      await act(async () => {
        deferred.resolve(undefined)
        await deferred.promise
      })
    })
  })

  // Scenario: enabled flag should control window event listener lifecycle.
  describe('Window event integration', () => {
    it('should register and cleanup paste listener when enabled', () => {
      const addListenerSpy = vi.spyOn(window, 'addEventListener')
      const removeListenerSpy = vi.spyOn(window, 'removeEventListener')
      const treeRef = createTreeRef('selected')

      const { unmount } = renderHook(() => usePasteOperation({ treeRef, enabled: true }))

      const addCall = addListenerSpy.mock.calls.find(call => String(call[0]) === 'skill:paste')
      expect(addCall).toBeDefined()

      unmount()

      const removeCall = removeListenerSpy.mock.calls.find(call => String(call[0]) === 'skill:paste')
      expect(removeCall).toBeDefined()
      expect(removeCall?.[1]).toBe(addCall?.[1])

      addListenerSpy.mockRestore()
      removeListenerSpy.mockRestore()
    })

    it('should trigger paste handler when skill:paste event is dispatched and enabled', async () => {
      mocks.workflowState.clipboard = {
        operation: 'cut',
        nodeIds: new Set(['node-event']),
      }
      const treeRef = createTreeRef('selected')
      const treeData: AppAssetTreeResponse = {
        children: [createTreeNode('node-event', 'file')],
      }

      renderHook(() => usePasteOperation({ treeRef, treeData, enabled: true }))

      act(() => {
        window.dispatchEvent(new Event('skill:paste'))
      })

      await waitFor(() => {
        expect(mocks.moveMutateAsync).toHaveBeenCalledTimes(1)
      })
    })

    it('should ignore skill:paste event when disabled', async () => {
      mocks.workflowState.clipboard = {
        operation: 'cut',
        nodeIds: new Set(['node-disabled']),
      }
      const treeRef = createTreeRef('selected')
      const treeData: AppAssetTreeResponse = {
        children: [createTreeNode('node-disabled', 'file')],
      }

      renderHook(() => usePasteOperation({ treeRef, treeData, enabled: false }))

      act(() => {
        window.dispatchEvent(new Event('skill:paste'))
      })

      await waitFor(() => {
        expect(mocks.moveMutateAsync).not.toHaveBeenCalled()
      })
    })
  })
})
