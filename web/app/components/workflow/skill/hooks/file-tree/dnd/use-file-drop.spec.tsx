import type { ReactNode } from 'react'
import type { App, AppSSO } from '@/types/app'
import { act, renderHook } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { ROOT_ID } from '../../../constants'
import { useFileDrop } from './use-file-drop'

const {
  mockUploadMutateAsync,
  mockPrepareSkillUploadFile,
  mockEmitTreeUpdate,
  mockToastNotify,
} = vi.hoisted(() => ({
  mockUploadMutateAsync: vi.fn(),
  mockPrepareSkillUploadFile: vi.fn(),
  mockEmitTreeUpdate: vi.fn(),
  mockToastNotify: vi.fn(),
}))

vi.mock('@/service/use-app-asset', () => ({
  useUploadFileWithPresignedUrl: () => ({
    mutateAsync: mockUploadMutateAsync,
    isPending: false,
  }),
}))

vi.mock('../../../utils/skill-upload-utils', () => ({
  prepareSkillUploadFile: mockPrepareSkillUploadFile,
}))

vi.mock('../data/use-skill-tree-collaboration', () => ({
  useSkillTreeUpdateEmitter: () => mockEmitTreeUpdate,
}))

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: mockToastNotify,
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
    <WorkflowContext.Provider value={store}>
      {children}
    </WorkflowContext.Provider>
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

  // Scenario: drag-over updates upload drag state for valid external file drags.
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

  // Scenario: directory drops are rejected and do not trigger upload mutations.
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
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflow.skillSidebar.menu.folderDropNotSupported',
      })
      expect(store.getState().currentDragType).toBeNull()
      expect(store.getState().dragOverFolderId).toBeNull()
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
      expect(mockToastNotify).toHaveBeenNthCalledWith(1, {
        type: 'error',
        message: 'workflow.skillSidebar.menu.folderDropNotSupported',
      })
      expect(mockToastNotify).toHaveBeenNthCalledWith(2, {
        type: 'success',
        message: 'workflow.skillSidebar.menu.filesUploaded:{"count":1}',
      })
    })
  })

  // Scenario: successful drops upload prepared files and emit collaboration updates.
  describe('Upload Success', () => {
    it('should upload dropped files and show success toast when upload succeeds', async () => {
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
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'workflow.skillSidebar.menu.filesUploaded:{"count":2}',
      })
    })
  })

  // Scenario: failed uploads surface an error toast and skip collaboration updates.
  describe('Upload Error', () => {
    it('should show error toast when upload fails', async () => {
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
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflow.skillSidebar.menu.uploadError',
      })
    })
  })
})
