import type { ReactNode } from 'react'
import type { App, AppSSO } from '@/types/app'
import { act, renderHook } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { ROOT_ID } from '../../../../constants'
import { useFileDrop } from '../use-file-drop'

const {
  mockUploadMutateAsync,
  mockPrepareSkillUploadFile,
  mockEmitTreeUpdate,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockUploadMutateAsync: vi.fn(),
  mockPrepareSkillUploadFile: vi.fn(),
  mockEmitTreeUpdate: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@/service/use-app-asset', () => ({
  useUploadFileWithPresignedUrl: () => ({
    mutateAsync: mockUploadMutateAsync,
    isPending: false,
  }),
}))

vi.mock('../../../../utils/skill-upload-utils', () => ({
  prepareSkillUploadFile: mockPrepareSkillUploadFile,
}))

vi.mock('../../data/use-skill-tree-collaboration', () => ({
  useSkillTreeUpdateEmitter: () => mockEmitTreeUpdate,
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}))

type MockDataTransferItem = {
  kind: string
  getAsFile: () => File | null
  webkitGetAsEntry: () => { isDirectory: boolean } | null
}

type MockDragEvent = {
  preventDefault: ReturnType<typeof vi.fn>
  stopPropagation: ReturnType<typeof vi.fn>
  dataTransfer: {
    types: string[]
    items: DataTransferItem[]
    dropEffect: 'none' | 'copy' | 'move' | 'link'
  }
}

const createWrapper = (store: ReturnType<typeof createWorkflowStore>) => {
  return ({ children }: { children: ReactNode }) => (
    <WorkflowContext value={store}>
      {children}
    </WorkflowContext>
  )
}

const createDataTransferItem = (params: {
  file?: File | null
  kind?: string
  isDirectory?: boolean
} = {}): DataTransferItem => {
  const {
    file = null,
    kind = 'file',
    isDirectory,
  } = params

  const item: MockDataTransferItem = {
    kind,
    getAsFile: () => file,
    webkitGetAsEntry: () => {
      if (typeof isDirectory === 'boolean')
        return { isDirectory }
      return null
    },
  }

  return item as unknown as DataTransferItem
}

const createDragEvent = (params: {
  types?: string[]
  items?: DataTransferItem[]
} = {}): MockDragEvent => {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      types: params.types ?? ['Files'],
      items: params.items ?? [],
      dropEffect: 'none',
    },
  }
}

describe('useFileDrop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      appDetail: { id: 'app-1' } as App & Partial<AppSSO>,
    })
    mockPrepareSkillUploadFile.mockImplementation(async (file: File) => file)
    mockUploadMutateAsync.mockResolvedValue(undefined)
  })

  describe('Drag Over', () => {
    it('should set upload drag state when file drag enters root target', () => {
      const store = createWorkflowStore({})
      const { result } = renderHook(() => useFileDrop(), { wrapper: createWrapper(store) })
      const event = createDragEvent()

      act(() => {
        result.current.handleDragOver(event as unknown as React.DragEvent, {
          folderId: null,
          isFolder: false,
        })
      })

      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(event.stopPropagation).toHaveBeenCalledTimes(1)
      expect(event.dataTransfer.dropEffect).toBe('copy')
      expect(store.getState().currentDragType).toBe('upload')
      expect(store.getState().dragOverFolderId).toBe(ROOT_ID)
    })

    it('should ignore drag-over when dragged payload does not contain files', () => {
      const store = createWorkflowStore({})
      const { result } = renderHook(() => useFileDrop(), { wrapper: createWrapper(store) })
      const event = createDragEvent({ types: ['text/plain'] })

      act(() => {
        result.current.handleDragOver(event as unknown as React.DragEvent, {
          folderId: 'folder-1',
          isFolder: true,
        })
      })

      expect(store.getState().currentDragType).toBeNull()
      expect(store.getState().dragOverFolderId).toBeNull()
      expect(event.dataTransfer.dropEffect).toBe('none')
    })
  })

  describe('Folder Drop Rejection', () => {
    it('should reject dropped folders and show an error toast', async () => {
      const store = createWorkflowStore({})
      store.getState().setCurrentDragType('upload')
      store.getState().setDragOverFolderId('folder-1')
      const { result } = renderHook(() => useFileDrop(), { wrapper: createWrapper(store) })
      const event = createDragEvent({
        items: [createDataTransferItem({ isDirectory: true })],
      })

      await act(async () => {
        await result.current.handleDrop(event as unknown as React.DragEvent, 'folder-1')
      })

      expect(mockPrepareSkillUploadFile).not.toHaveBeenCalled()
      expect(mockUploadMutateAsync).not.toHaveBeenCalled()
      expect(mockToastError).toHaveBeenCalledWith('workflow.skillSidebar.menu.folderDropNotSupported')
      expect(store.getState().currentDragType).toBeNull()
      expect(store.getState().dragOverFolderId).toBeNull()
      expect(store.getState().uploadStatus).toBe('idle')
    })

    it('should upload valid files while rejecting directories in a mixed drop payload', async () => {
      const store = createWorkflowStore({})
      const { result } = renderHook(() => useFileDrop(), { wrapper: createWrapper(store) })
      const file = new File(['gamma'], 'gamma.md', { type: 'text/markdown' })
      const event = createDragEvent({
        items: [
          createDataTransferItem({ isDirectory: true }),
          createDataTransferItem({ file }),
        ],
      })

      await act(async () => {
        await result.current.handleDrop(event as unknown as React.DragEvent, 'folder-mixed')
      })

      expect(mockPrepareSkillUploadFile).toHaveBeenCalledTimes(1)
      expect(mockPrepareSkillUploadFile).toHaveBeenCalledWith(file)
      expect(mockUploadMutateAsync).toHaveBeenCalledTimes(1)
      expect(mockUploadMutateAsync).toHaveBeenCalledWith({
        appId: 'app-1',
        file,
        parentId: 'folder-mixed',
      })
      expect(mockEmitTreeUpdate).toHaveBeenCalledTimes(1)
      expect(mockToastError).toHaveBeenCalledWith('workflow.skillSidebar.menu.folderDropNotSupported')
      expect(mockToastSuccess).toHaveBeenCalledWith('workflow.skillSidebar.menu.filesUploaded:{"count":1}')
    })
  })

  describe('Upload Success', () => {
    it('should write upload success state when dropped files upload succeeds', async () => {
      const store = createWorkflowStore({})
      const { result } = renderHook(() => useFileDrop(), { wrapper: createWrapper(store) })
      const firstFile = new File(['alpha'], 'alpha.md', { type: 'text/markdown' })
      const secondFile = new File(['beta'], 'beta.txt', { type: 'text/plain' })
      const event = createDragEvent({
        items: [
          createDataTransferItem({ file: firstFile }),
          createDataTransferItem({ file: secondFile }),
        ],
      })

      await act(async () => {
        await result.current.handleDrop(event as unknown as React.DragEvent, 'folder-9')
      })

      expect(mockPrepareSkillUploadFile).toHaveBeenCalledTimes(2)
      expect(mockPrepareSkillUploadFile).toHaveBeenNthCalledWith(1, firstFile)
      expect(mockPrepareSkillUploadFile).toHaveBeenNthCalledWith(2, secondFile)
      expect(mockUploadMutateAsync).toHaveBeenCalledTimes(2)
      expect(mockUploadMutateAsync).toHaveBeenNthCalledWith(1, {
        appId: 'app-1',
        file: firstFile,
        parentId: 'folder-9',
      })
      expect(mockUploadMutateAsync).toHaveBeenNthCalledWith(2, {
        appId: 'app-1',
        file: secondFile,
        parentId: 'folder-9',
      })
      expect(mockEmitTreeUpdate).toHaveBeenCalledTimes(1)
      expect(mockToastSuccess).toHaveBeenCalledWith('workflow.skillSidebar.menu.filesUploaded:{"count":2}')
      expect(store.getState().uploadStatus).toBe('success')
      expect(store.getState().uploadProgress).toEqual({ uploaded: 2, total: 2, failed: 0 })
    })
  })

  describe('Upload Error', () => {
    it('should write partial error state when only part of the dropped files fail', async () => {
      const store = createWorkflowStore({})
      const { result } = renderHook(() => useFileDrop(), { wrapper: createWrapper(store) })
      const firstFile = new File(['ok'], 'ok.md', { type: 'text/markdown' })
      const secondFile = new File(['failed'], 'failed.md', { type: 'text/markdown' })
      const event = createDragEvent({
        items: [
          createDataTransferItem({ file: firstFile }),
          createDataTransferItem({ file: secondFile }),
        ],
      })
      mockUploadMutateAsync
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('upload failed'))

      await act(async () => {
        await result.current.handleDrop(event as unknown as React.DragEvent, 'folder-err')
      })

      expect(mockUploadMutateAsync).toHaveBeenCalledTimes(2)
      expect(mockEmitTreeUpdate).toHaveBeenCalledTimes(1)
      expect(mockToastSuccess).not.toHaveBeenCalled()
      expect(mockToastError).not.toHaveBeenCalled()
      expect(store.getState().uploadStatus).toBe('partial_error')
      expect(store.getState().uploadProgress).toEqual({ uploaded: 1, total: 2, failed: 1 })
    })

    it('should write partial error state and show error toast when all dropped files fail', async () => {
      const store = createWorkflowStore({})
      const { result } = renderHook(() => useFileDrop(), { wrapper: createWrapper(store) })
      const file = new File(['content'], 'failed.md', { type: 'text/markdown' })
      const event = createDragEvent({
        items: [createDataTransferItem({ file })],
      })
      mockUploadMutateAsync.mockRejectedValueOnce(new Error('upload failed'))

      await act(async () => {
        await result.current.handleDrop(event as unknown as React.DragEvent, 'folder-err')
      })

      expect(mockUploadMutateAsync).toHaveBeenCalledTimes(1)
      expect(mockEmitTreeUpdate).not.toHaveBeenCalled()
      expect(mockToastError).toHaveBeenCalledWith('workflow.skillSidebar.menu.uploadError')
      expect(store.getState().uploadStatus).toBe('partial_error')
      expect(store.getState().uploadProgress).toEqual({ uploaded: 0, total: 1, failed: 1 })
    })
  })
})
