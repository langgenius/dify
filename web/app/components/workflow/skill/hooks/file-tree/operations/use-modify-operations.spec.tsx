import type { RefObject } from 'react'
import type { NodeApi, TreeApi } from 'react-arborist'
import type { StoreApi } from 'zustand'
import type { TreeNodeData } from '../../../type'
import type { SkillEditorSliceShape } from '@/app/components/workflow/store/workflow/skill-editor/types'
import type { AppAssetTreeResponse } from '@/types/app-asset'
import { act, renderHook } from '@testing-library/react'
import { useModifyOperations } from './use-modify-operations'

type DeleteMutationPayload = {
  appId: string
  nodeId: string
}

const mocks = vi.hoisted(() => ({
  deletePending: false,
  deleteMutateAsync: vi.fn<(payload: DeleteMutationPayload) => Promise<void>>(),
  emitTreeUpdate: vi.fn<() => void>(),
  toastNotify: vi.fn<(payload: { type: string, message: string }) => void>(),
  getAllDescendantFileIds: vi.fn<(nodeId: string, nodes: TreeNodeData[]) => string[]>(),
}))

vi.mock('@/service/use-app-asset', () => ({
  useDeleteAppAssetNode: () => ({
    mutateAsync: mocks.deleteMutateAsync,
    isPending: mocks.deletePending,
  }),
}))

vi.mock('../data/use-skill-tree-collaboration', () => ({
  useSkillTreeUpdateEmitter: () => mocks.emitTreeUpdate,
}))

vi.mock('../../../utils/tree-utils', () => ({
  getAllDescendantFileIds: mocks.getAllDescendantFileIds,
}))

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: mocks.toastNotify,
  },
}))

const createTreeNodeData = (id: string, nodeType: 'file' | 'folder', children: TreeNodeData[] = []): TreeNodeData => ({
  id,
  node_type: nodeType,
  name: nodeType === 'folder' ? `folder-${id}` : `${id}.md`,
  path: `/${id}`,
  extension: nodeType === 'folder' ? '' : 'md',
  size: 1,
  children,
})

const createNodeApi = (nodeType: 'file' | 'folder', id = 'node-1') => {
  const edit = vi.fn()
  const node = {
    data: createTreeNodeData(id, nodeType),
    edit,
  } as unknown as NodeApi<TreeNodeData>
  return { node, edit }
}

const createTreeRef = (targetNode: NodeApi<TreeNodeData> | null) => {
  const get = vi.fn<(nodeId: string) => NodeApi<TreeNodeData> | null>().mockReturnValue(targetNode)
  const treeRef = {
    current: {
      get,
    },
  } as unknown as RefObject<TreeApi<TreeNodeData> | null>
  return { treeRef, get }
}

const createStoreApi = () => {
  const closeTab = vi.fn<(fileId: string) => void>()
  const clearDraftContent = vi.fn<(fileId: string) => void>()
  const state = {
    closeTab,
    clearDraftContent,
  } as Pick<SkillEditorSliceShape, 'closeTab' | 'clearDraftContent'>

  const storeApi = {
    getState: () => state,
  } as unknown as StoreApi<SkillEditorSliceShape>

  return {
    storeApi,
    closeTab,
    clearDraftContent,
  }
}

describe('useModifyOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.deletePending = false
    mocks.deleteMutateAsync.mockResolvedValue(undefined)
    mocks.getAllDescendantFileIds.mockReturnValue([])
  })

  // Scenario: loading state should match mutation pending status.
  describe('State', () => {
    it('should expose mutation pending state as isDeleting', () => {
      mocks.deletePending = true
      const { storeApi } = createStoreApi()

      const { result } = renderHook(() => useModifyOperations({
        nodeId: 'node-1',
        appId: 'app-1',
        storeApi,
        onClose: vi.fn(),
      }))

      expect(result.current.isDeleting).toBe(true)
    })
  })

  // Scenario: rename action should prefer treeRef editing and fallback to node editing.
  describe('Rename', () => {
    it('should edit node from treeRef when treeRef is available', () => {
      const { storeApi } = createStoreApi()
      const onClose = vi.fn()
      const { node: treeNode, edit: treeNodeEdit } = createNodeApi('file', 'tree-node')
      const { treeRef, get } = createTreeRef(treeNode)
      const { node: fallbackNode, edit: fallbackEdit } = createNodeApi('file', 'fallback-node')

      const { result } = renderHook(() => useModifyOperations({
        nodeId: 'tree-node',
        node: fallbackNode,
        treeRef,
        appId: 'app-1',
        storeApi,
        onClose,
      }))

      act(() => {
        result.current.handleRename()
      })

      expect(get).toHaveBeenCalledWith('tree-node')
      expect(treeNodeEdit).toHaveBeenCalledTimes(1)
      expect(fallbackEdit).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should fallback to provided node edit when treeRef is absent', () => {
      const { storeApi } = createStoreApi()
      const onClose = vi.fn()
      const { node, edit } = createNodeApi('folder', 'folder-2')

      const { result } = renderHook(() => useModifyOperations({
        nodeId: 'folder-2',
        node,
        appId: 'app-1',
        storeApi,
        onClose,
      }))

      act(() => {
        result.current.handleRename()
      })

      expect(edit).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  // Scenario: delete confirm dialog toggles with click/cancel handlers.
  describe('Delete dialog state', () => {
    it('should open and close delete confirmation dialog', () => {
      const { storeApi } = createStoreApi()

      const { result } = renderHook(() => useModifyOperations({
        nodeId: 'node-1',
        appId: 'app-1',
        storeApi,
        onClose: vi.fn(),
      }))

      expect(result.current.showDeleteConfirm).toBe(false)

      act(() => {
        result.current.handleDeleteClick()
      })

      expect(result.current.showDeleteConfirm).toBe(true)

      act(() => {
        result.current.handleDeleteCancel()
      })

      expect(result.current.showDeleteConfirm).toBe(false)
    })
  })

  // Scenario: successful deletes should close tabs/drafts and emit collaboration updates.
  describe('Delete success', () => {
    it('should delete file node, clear descendants and current file tabs, and show file success toast', async () => {
      const { storeApi, closeTab, clearDraftContent } = createStoreApi()
      const onClose = vi.fn()
      const { node } = createNodeApi('file', 'file-7')
      const treeData: AppAssetTreeResponse = {
        children: [createTreeNodeData('root-folder', 'folder')],
      }
      mocks.getAllDescendantFileIds.mockReturnValue(['desc-1', 'desc-2'])

      const { result } = renderHook(() => useModifyOperations({
        nodeId: 'file-7',
        node,
        appId: 'app-77',
        storeApi,
        treeData,
        onClose,
      }))

      act(() => {
        result.current.handleDeleteClick()
      })

      await act(async () => {
        await result.current.handleDeleteConfirm()
      })

      expect(mocks.getAllDescendantFileIds).toHaveBeenCalledWith('file-7', treeData.children)
      expect(mocks.deleteMutateAsync).toHaveBeenCalledWith({
        appId: 'app-77',
        nodeId: 'file-7',
      })
      expect(mocks.emitTreeUpdate).toHaveBeenCalledTimes(1)

      expect(closeTab).toHaveBeenNthCalledWith(1, 'desc-1')
      expect(closeTab).toHaveBeenNthCalledWith(2, 'desc-2')
      expect(closeTab).toHaveBeenNthCalledWith(3, 'file-7')
      expect(clearDraftContent).toHaveBeenNthCalledWith(1, 'desc-1')
      expect(clearDraftContent).toHaveBeenNthCalledWith(2, 'desc-2')
      expect(clearDraftContent).toHaveBeenNthCalledWith(3, 'file-7')

      expect(mocks.toastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'workflow.skillSidebar.menu.fileDeleted',
      })
      expect(result.current.showDeleteConfirm).toBe(false)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should delete folder node and skip closing the folder tab itself', async () => {
      const { storeApi, closeTab, clearDraftContent } = createStoreApi()
      const { node } = createNodeApi('folder', 'folder-9')
      const treeData: AppAssetTreeResponse = {
        children: [createTreeNodeData('root-folder', 'folder')],
      }
      mocks.getAllDescendantFileIds.mockReturnValue(['file-in-folder'])

      const { result } = renderHook(() => useModifyOperations({
        nodeId: 'folder-9',
        node,
        appId: 'app-9',
        storeApi,
        treeData,
        onClose: vi.fn(),
      }))

      await act(async () => {
        await result.current.handleDeleteConfirm()
      })

      expect(closeTab).toHaveBeenCalledTimes(1)
      expect(closeTab).toHaveBeenCalledWith('file-in-folder')
      expect(clearDraftContent).toHaveBeenCalledTimes(1)
      expect(clearDraftContent).toHaveBeenCalledWith('file-in-folder')
      expect(closeTab).not.toHaveBeenCalledWith('folder-9')
      expect(clearDraftContent).not.toHaveBeenCalledWith('folder-9')
      expect(mocks.toastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'workflow.skillSidebar.menu.deleted',
      })
    })
  })

  // Scenario: failed deletes should surface proper error toasts and always close dialog.
  describe('Delete errors', () => {
    it('should show folder delete error toast on failure', async () => {
      mocks.deleteMutateAsync.mockRejectedValueOnce(new Error('delete failed'))
      const { storeApi, closeTab, clearDraftContent } = createStoreApi()
      const onClose = vi.fn()
      const { node } = createNodeApi('folder', 'folder-err')
      const treeData: AppAssetTreeResponse = {
        children: [createTreeNodeData('top', 'folder')],
      }

      const { result } = renderHook(() => useModifyOperations({
        nodeId: 'folder-err',
        node,
        appId: 'app-err',
        storeApi,
        treeData,
        onClose,
      }))

      await act(async () => {
        await result.current.handleDeleteConfirm()
      })

      expect(mocks.emitTreeUpdate).not.toHaveBeenCalled()
      expect(closeTab).not.toHaveBeenCalled()
      expect(clearDraftContent).not.toHaveBeenCalled()
      expect(mocks.toastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflow.skillSidebar.menu.deleteError',
      })
      expect(result.current.showDeleteConfirm).toBe(false)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should show file delete error toast and skip descendant lookup when treeData is missing', async () => {
      mocks.deleteMutateAsync.mockRejectedValueOnce(new Error('delete failed'))
      const { storeApi } = createStoreApi()
      const { node } = createNodeApi('file', 'file-err')

      const { result } = renderHook(() => useModifyOperations({
        nodeId: 'file-err',
        node,
        appId: 'app-err',
        storeApi,
        onClose: vi.fn(),
      }))

      await act(async () => {
        await result.current.handleDeleteConfirm()
      })

      expect(mocks.getAllDescendantFileIds).not.toHaveBeenCalled()
      expect(mocks.toastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflow.skillSidebar.menu.fileDeleteError',
      })
    })
  })
})
