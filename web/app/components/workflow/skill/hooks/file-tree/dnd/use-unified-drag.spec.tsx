import type { ReactNode } from 'react'
import type { App, AppSSO } from '@/types/app'
import { act, renderHook } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { INTERNAL_NODE_DRAG_TYPE } from '../../../constants'
import { useUnifiedDrag } from './use-unified-drag'

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

describe('useUnifiedDrag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    uploadHookState.isPending = false
    useAppStore.setState({
      appDetail: { id: 'app-1' } as App & Partial<AppSSO>,
    })
  })

  describe('handleDragOver', () => {
    it('should update drag state when drag source contains files', () => {
      const store = createWorkflowStore({})
      const { result } = renderHook(() => useUnifiedDrag(), {
        wrapper: createWrapper(store),
      })
      const dragEvent = createDragEvent({ types: ['Files'] })

      act(() => {
        result.current.handleDragOver(dragEvent, { folderId: 'folder-1', isFolder: true })
      })

      expect(store.getState().currentDragType).toBe('upload')
      expect(store.getState().dragOverFolderId).toBe('folder-1')
      expect(dragEvent.dataTransfer.dropEffect).toBe('copy')
    })

    it('should ignore dragOver when drag source does not contain files', () => {
      const store = createWorkflowStore({})
      const { result } = renderHook(() => useUnifiedDrag(), {
        wrapper: createWrapper(store),
      })
      const dragEvent = createDragEvent({ types: [INTERNAL_NODE_DRAG_TYPE] })

      act(() => {
        result.current.handleDragOver(dragEvent, { folderId: 'folder-1', isFolder: true })
      })

      expect(store.getState().currentDragType).toBeNull()
      expect(store.getState().dragOverFolderId).toBeNull()
      expect(dragEvent.dataTransfer.dropEffect).toBe('none')
    })
  })

  describe('handleDragLeave', () => {
    it('should clear drag state when drag source contains files', () => {
      const store = createWorkflowStore({})
      const { result } = renderHook(() => useUnifiedDrag(), {
        wrapper: createWrapper(store),
      })
      const dragEvent = createDragEvent({ types: ['Files'] })

      act(() => {
        result.current.handleDragOver(dragEvent, { folderId: 'folder-1', isFolder: true })
      })
      expect(store.getState().currentDragType).toBe('upload')
      expect(store.getState().dragOverFolderId).toBe('folder-1')

      act(() => {
        result.current.handleDragLeave(dragEvent)
      })

      expect(store.getState().currentDragType).toBeNull()
      expect(store.getState().dragOverFolderId).toBeNull()
    })

    it('should ignore dragLeave when drag source does not contain files', () => {
      const store = createWorkflowStore({})
      store.getState().setCurrentDragType('upload')
      store.getState().setDragOverFolderId('folder-1')

      const { result } = renderHook(() => useUnifiedDrag(), {
        wrapper: createWrapper(store),
      })
      const dragEvent = createDragEvent({ types: [INTERNAL_NODE_DRAG_TYPE] })

      act(() => {
        result.current.handleDragLeave(dragEvent)
      })

      expect(store.getState().currentDragType).toBe('upload')
      expect(store.getState().dragOverFolderId).toBe('folder-1')
    })
  })

  describe('handleDrop', () => {
    it('should delegate drop handling when drag source contains files', async () => {
      const store = createWorkflowStore({})
      store.getState().setCurrentDragType('upload')
      store.getState().setDragOverFolderId('folder-1')

      const { result } = renderHook(() => useUnifiedDrag(), {
        wrapper: createWrapper(store),
      })
      const dragEvent = createDragEvent({ types: ['Files'], items: [] })

      await act(async () => {
        await result.current.handleDrop(dragEvent, null)
      })

      expect(store.getState().currentDragType).toBeNull()
      expect(store.getState().dragOverFolderId).toBeNull()
      expect(dragEvent.preventDefault).toHaveBeenCalledTimes(1)
      expect(dragEvent.stopPropagation).toHaveBeenCalledTimes(1)
    })

    it('should return undefined and skip drop handling when drag source does not contain files', async () => {
      const store = createWorkflowStore({})
      store.getState().setCurrentDragType('upload')
      store.getState().setDragOverFolderId('folder-1')

      const { result } = renderHook(() => useUnifiedDrag(), {
        wrapper: createWrapper(store),
      })
      const dragEvent = createDragEvent({ types: [INTERNAL_NODE_DRAG_TYPE], items: [] })

      let dropResult: Promise<void> | undefined
      await act(async () => {
        dropResult = result.current.handleDrop(dragEvent, null)
      })

      expect(dropResult).toBeUndefined()
      expect(store.getState().currentDragType).toBe('upload')
      expect(store.getState().dragOverFolderId).toBe('folder-1')
      expect(dragEvent.preventDefault).not.toHaveBeenCalled()
      expect(dragEvent.stopPropagation).not.toHaveBeenCalled()
    })
  })

  describe('isUploading', () => {
    it('should expose uploading state from file drop hook', () => {
      uploadHookState.isPending = true
      const store = createWorkflowStore({})

      const { result } = renderHook(() => useUnifiedDrag(), {
        wrapper: createWrapper(store),
      })

      expect(result.current.isUploading).toBe(true)
    })
  })
})
