import type { ReactNode } from 'react'
import type { NodeApi } from 'react-arborist'
import type { TreeNodeData } from '../../../type'
import type { AppAssetTreeView } from '@/types/app-asset'
import { act, renderHook } from '@testing-library/react'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { INTERNAL_NODE_DRAG_TYPE } from '../../../constants'
import { useFolderFileDrop } from './use-folder-file-drop'

const {
  mockHandleDragOver,
  mockHandleDrop,
} = vi.hoisted(() => ({
  mockHandleDragOver: vi.fn(),
  mockHandleDrop: vi.fn(),
}))

vi.mock('./use-unified-drag', () => ({
  useUnifiedDrag: () => ({
    handleDragOver: mockHandleDragOver,
    handleDrop: mockHandleDrop,
  }),
}))

const createWrapper = (store: ReturnType<typeof createWorkflowStore>) => {
  return ({ children }: { children: ReactNode }) => (
    <WorkflowContext.Provider value={store}>
      {children}
    </WorkflowContext.Provider>
  )
}

const createNode = (params: {
  id?: string
  nodeType: 'file' | 'folder'
  isOpen?: boolean
}): NodeApi<TreeNodeData> => {
  const node = {
    data: {
      id: params.id ?? 'node-1',
      node_type: params.nodeType,
      name: params.nodeType === 'folder' ? 'folder-a' : 'README.md',
      path: '/node-1',
      extension: params.nodeType === 'folder' ? '' : 'md',
      size: 1,
      children: [],
    },
    isOpen: params.isOpen ?? false,
    open: vi.fn(),
  }

  return node as unknown as NodeApi<TreeNodeData>
}

const createDragEvent = (types: string[]): React.DragEvent => {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      types,
      items: [],
      dropEffect: 'none',
    } as unknown as DataTransfer,
  } as unknown as React.DragEvent
}

const EMPTY_TREE_CHILDREN: AppAssetTreeView[] = []

describe('useFolderFileDrop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Scenario: derive drag-over state from workflow store and folder identity.
  describe('isDragOver', () => {
    it('should be true when node is folder and dragOverFolderId matches node id', () => {
      const store = createWorkflowStore({})
      store.getState().setDragOverFolderId('folder-1')
      const node = createNode({ id: 'folder-1', nodeType: 'folder' })

      const { result } = renderHook(() => useFolderFileDrop({
        node,
        treeChildren: EMPTY_TREE_CHILDREN,
      }), {
        wrapper: createWrapper(store),
      })

      expect(result.current.isDragOver).toBe(true)
    })

    it('should be false when node is not a folder even if dragOverFolderId matches', () => {
      const store = createWorkflowStore({})
      store.getState().setDragOverFolderId('file-1')
      const node = createNode({ id: 'file-1', nodeType: 'file' })

      const { result } = renderHook(() => useFolderFileDrop({
        node,
        treeChildren: EMPTY_TREE_CHILDREN,
      }), {
        wrapper: createWrapper(store),
      })

      expect(result.current.isDragOver).toBe(false)
    })
  })

  // Scenario: drag handlers delegate only for supported drag events on folder nodes.
  describe('drag handlers', () => {
    it('should delegate drag over and drop for supported file drag events', () => {
      const store = createWorkflowStore({})
      const node = createNode({ id: 'folder-2', nodeType: 'folder' })

      const { result } = renderHook(() => useFolderFileDrop({
        node,
        treeChildren: EMPTY_TREE_CHILDREN,
      }), {
        wrapper: createWrapper(store),
      })

      const dragOverEvent = createDragEvent(['Files'])
      const dropEvent = createDragEvent(['Files'])

      act(() => {
        result.current.dragHandlers.onDragOver(dragOverEvent)
        result.current.dragHandlers.onDrop(dropEvent)
      })

      expect(mockHandleDragOver).toHaveBeenCalledWith(dragOverEvent, {
        folderId: 'folder-2',
        isFolder: true,
      })
      expect(mockHandleDrop).toHaveBeenCalledWith(dropEvent, 'folder-2')
    })

    it('should ignore unsupported drag events', () => {
      const store = createWorkflowStore({})
      const node = createNode({ id: 'folder-3', nodeType: 'folder' })

      const { result } = renderHook(() => useFolderFileDrop({
        node,
        treeChildren: EMPTY_TREE_CHILDREN,
      }), {
        wrapper: createWrapper(store),
      })

      const unsupportedEvent = createDragEvent(['text/plain'])
      act(() => {
        result.current.dragHandlers.onDragEnter(unsupportedEvent)
        result.current.dragHandlers.onDragOver(unsupportedEvent)
        result.current.dragHandlers.onDragLeave(unsupportedEvent)
      })

      expect(mockHandleDragOver).not.toHaveBeenCalled()
      expect(mockHandleDrop).not.toHaveBeenCalled()
    })

    it('should support internal node drag type in drag over handler', () => {
      const store = createWorkflowStore({})
      const node = createNode({ id: 'folder-4', nodeType: 'folder' })

      const { result } = renderHook(() => useFolderFileDrop({
        node,
        treeChildren: EMPTY_TREE_CHILDREN,
      }), {
        wrapper: createWrapper(store),
      })

      const internalDragEvent = createDragEvent([INTERNAL_NODE_DRAG_TYPE])
      act(() => {
        result.current.dragHandlers.onDragOver(internalDragEvent)
      })

      expect(mockHandleDragOver).toHaveBeenCalledWith(internalDragEvent, {
        folderId: 'folder-4',
        isFolder: true,
      })
    })
  })

  // Scenario: auto-expand lifecycle should blink first, expand later, and cleanup when drag state changes.
  describe('auto expand and blink', () => {
    it('should blink after delay and auto-expand folder after longer delay', () => {
      const store = createWorkflowStore({})
      store.getState().setDragOverFolderId('folder-5')
      const node = createNode({ id: 'folder-5', nodeType: 'folder', isOpen: false })

      const { result } = renderHook(() => useFolderFileDrop({
        node,
        treeChildren: EMPTY_TREE_CHILDREN,
      }), {
        wrapper: createWrapper(store),
      })

      expect(result.current.isBlinking).toBe(false)

      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(result.current.isBlinking).toBe(true)

      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(result.current.isBlinking).toBe(false)
      expect(node.open).toHaveBeenCalledTimes(1)
    })

    it('should cancel auto-expand when drag over state is cleared before expand delay', () => {
      const store = createWorkflowStore({})
      store.getState().setDragOverFolderId('folder-6')
      const node = createNode({ id: 'folder-6', nodeType: 'folder', isOpen: false })

      const { result } = renderHook(() => useFolderFileDrop({
        node,
        treeChildren: EMPTY_TREE_CHILDREN,
      }), {
        wrapper: createWrapper(store),
      })

      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(result.current.isBlinking).toBe(true)

      act(() => {
        store.getState().setDragOverFolderId(null)
      })
      expect(result.current.isBlinking).toBe(false)

      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(node.open).not.toHaveBeenCalled()
    })
  })
})
