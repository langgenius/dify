import type { ReactNode } from 'react'
import type { App, AppSSO } from '@/types/app'
import type { AppAssetTreeView } from '@/types/app-asset'
import { act, renderHook } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { INTERNAL_NODE_DRAG_TYPE, ROOT_ID } from '../../../constants'
import { useRootFileDrop } from './use-root-file-drop'

const { mockUploadMutateAsync, uploadHookState } = vi.hoisted(() => ({
  mockUploadMutateAsync: vi.fn(),
  uploadHookState: { isPending: false },
}))

vi.mock('@/service/use-app-asset', () => ({
  useUploadFileWithPresignedUrl: () => ({
    mutateAsync: mockUploadMutateAsync,
    isPending: uploadHookState.isPending,
  }),
}))

type DragEventOptions = {
  types: string[]
  items?: DataTransferItem[]
}

const createDragEvent = ({ types, items = [] }: DragEventOptions): React.DragEvent => {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      types,
      items,
      dropEffect: 'none',
    } as unknown as DataTransfer,
  } as unknown as React.DragEvent
}

const createWrapper = (store: ReturnType<typeof createWorkflowStore>) => {
  return ({ children }: { children: ReactNode }) => (
    <WorkflowContext.Provider value={store}>
      {children}
    </WorkflowContext.Provider>
  )
}

const EMPTY_TREE_CHILDREN: AppAssetTreeView[] = []

describe('useRootFileDrop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    uploadHookState.isPending = false
    useAppStore.setState({
      appDetail: { id: 'app-1' } as App & Partial<AppSSO>,
    })
  })

  describe('handleRootDragOver', () => {
    it('should set root upload drag state when files are dragged over root', () => {
      const store = createWorkflowStore({})
      const { result } = renderHook(() => useRootFileDrop({ treeChildren: EMPTY_TREE_CHILDREN }), {
        wrapper: createWrapper(store),
      })
      const dragEvent = createDragEvent({ types: ['Files'] })

      act(() => {
        result.current.handleRootDragOver(dragEvent)
      })

      expect(store.getState().currentDragType).toBe('upload')
      expect(store.getState().dragOverFolderId).toBe(ROOT_ID)
    })

    it('should skip dragOver handling when drag source is not files', () => {
      const store = createWorkflowStore({})
      const { result } = renderHook(() => useRootFileDrop({ treeChildren: EMPTY_TREE_CHILDREN }), {
        wrapper: createWrapper(store),
      })
      const dragEvent = createDragEvent({ types: [INTERNAL_NODE_DRAG_TYPE] })

      act(() => {
        result.current.handleRootDragOver(dragEvent)
      })

      expect(store.getState().currentDragType).toBeNull()
      expect(store.getState().dragOverFolderId).toBeNull()
    })
  })

  describe('drag counter behavior', () => {
    it('should keep drag state until nested drag leaves reach zero', () => {
      const store = createWorkflowStore({})
      const { result } = renderHook(() => useRootFileDrop({ treeChildren: EMPTY_TREE_CHILDREN }), {
        wrapper: createWrapper(store),
      })
      const fileDragEvent = createDragEvent({ types: ['Files'] })

      act(() => {
        result.current.handleRootDragOver(fileDragEvent)
      })
      expect(store.getState().currentDragType).toBe('upload')
      expect(store.getState().dragOverFolderId).toBe(ROOT_ID)

      act(() => {
        result.current.handleRootDragEnter(fileDragEvent)
        result.current.handleRootDragEnter(fileDragEvent)
      })

      act(() => {
        result.current.handleRootDragLeave(fileDragEvent)
      })
      expect(store.getState().currentDragType).toBe('upload')
      expect(store.getState().dragOverFolderId).toBe(ROOT_ID)

      act(() => {
        result.current.handleRootDragLeave(fileDragEvent)
      })
      expect(store.getState().currentDragType).toBeNull()
      expect(store.getState().dragOverFolderId).toBeNull()
    })

    it('should not increment counter when dragEnter is not a supported drag event', () => {
      const store = createWorkflowStore({})
      const { result } = renderHook(() => useRootFileDrop({ treeChildren: EMPTY_TREE_CHILDREN }), {
        wrapper: createWrapper(store),
      })
      const fileDragEvent = createDragEvent({ types: ['Files'] })
      const unsupportedDragEvent = createDragEvent({ types: ['text/plain'] })

      act(() => {
        result.current.handleRootDragOver(fileDragEvent)
      })

      act(() => {
        result.current.handleRootDragEnter(unsupportedDragEvent)
      })

      act(() => {
        result.current.handleRootDragLeave(fileDragEvent)
      })

      expect(store.getState().currentDragType).toBeNull()
      expect(store.getState().dragOverFolderId).toBeNull()
    })

    it('should not decrement counter when dragLeave is not a supported drag event', () => {
      const store = createWorkflowStore({})
      const { result } = renderHook(() => useRootFileDrop({ treeChildren: EMPTY_TREE_CHILDREN }), {
        wrapper: createWrapper(store),
      })
      const fileDragEvent = createDragEvent({ types: ['Files'] })
      const unsupportedDragEvent = createDragEvent({ types: ['text/plain'] })

      act(() => {
        result.current.handleRootDragOver(fileDragEvent)
        result.current.handleRootDragEnter(fileDragEvent)
        result.current.handleRootDragEnter(fileDragEvent)
      })

      act(() => {
        result.current.handleRootDragLeave(unsupportedDragEvent)
      })

      act(() => {
        result.current.handleRootDragLeave(fileDragEvent)
      })
      expect(store.getState().currentDragType).toBe('upload')
      expect(store.getState().dragOverFolderId).toBe(ROOT_ID)

      act(() => {
        result.current.handleRootDragLeave(fileDragEvent)
      })
      expect(store.getState().currentDragType).toBeNull()
      expect(store.getState().dragOverFolderId).toBeNull()
    })
  })

  describe('counter reset', () => {
    it('should clear counter when resetRootDragCounter is called', () => {
      const store = createWorkflowStore({})
      const { result } = renderHook(() => useRootFileDrop({ treeChildren: EMPTY_TREE_CHILDREN }), {
        wrapper: createWrapper(store),
      })
      const fileDragEvent = createDragEvent({ types: ['Files'] })

      act(() => {
        result.current.handleRootDragOver(fileDragEvent)
        result.current.handleRootDragEnter(fileDragEvent)
        result.current.handleRootDragEnter(fileDragEvent)
      })

      act(() => {
        result.current.resetRootDragCounter()
      })

      act(() => {
        result.current.handleRootDragLeave(fileDragEvent)
      })
      expect(store.getState().currentDragType).toBeNull()
      expect(store.getState().dragOverFolderId).toBeNull()
    })

    it('should reset counter after drop and clear drag state', () => {
      const store = createWorkflowStore({})
      const { result } = renderHook(() => useRootFileDrop({ treeChildren: EMPTY_TREE_CHILDREN }), {
        wrapper: createWrapper(store),
      })
      const beforeDropEvent = createDragEvent({ types: ['Files'], items: [] })
      const afterDropEvent = createDragEvent({ types: ['Files'], items: [] })

      act(() => {
        result.current.handleRootDragOver(beforeDropEvent)
        result.current.handleRootDragEnter(beforeDropEvent)
        result.current.handleRootDragEnter(beforeDropEvent)
        result.current.handleRootDrop(beforeDropEvent)
      })

      expect(store.getState().currentDragType).toBeNull()
      expect(store.getState().dragOverFolderId).toBeNull()
      expect(beforeDropEvent.preventDefault).toHaveBeenCalled()
      expect(beforeDropEvent.stopPropagation).toHaveBeenCalled()

      act(() => {
        result.current.handleRootDragOver(afterDropEvent)
      })
      expect(store.getState().currentDragType).toBe('upload')
      expect(store.getState().dragOverFolderId).toBe(ROOT_ID)

      act(() => {
        result.current.handleRootDragLeave(afterDropEvent)
      })
      expect(store.getState().currentDragType).toBeNull()
      expect(store.getState().dragOverFolderId).toBeNull()
    })
  })
})
