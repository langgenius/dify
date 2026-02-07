import type { StoreApi } from 'zustand'
import type { SkillEditorSliceShape, UploadStatus } from '@/app/components/workflow/store/workflow/skill-editor/types'
import type { BatchUploadNodeInput } from '@/types/app-asset'
import { act, renderHook } from '@testing-library/react'
import { useCreateOperations } from './use-create-operations'

type UploadMutationPayload = {
  appId: string
  file: File
  parentId?: string | null
}

type BatchUploadMutationPayload = {
  appId: string
  tree: BatchUploadNodeInput[]
  files: Map<string, File>
  parentId?: string | null
  onProgress?: (uploaded: number, total: number) => void
}

type UploadProgress = {
  uploaded: number
  total: number
  failed: number
}

const mocks = vi.hoisted(() => ({
  createFolderPending: false,
  uploadPending: false,
  batchPending: false,
  uploadMutateAsync: vi.fn<(payload: UploadMutationPayload) => Promise<void>>(),
  batchMutateAsync: vi.fn<(payload: BatchUploadMutationPayload) => Promise<unknown>>(),
  prepareSkillUploadFile: vi.fn<(file: File) => Promise<File>>(),
  emitTreeUpdate: vi.fn<() => void>(),
}))

vi.mock('@/service/use-app-asset', () => ({
  useCreateAppAssetFolder: () => ({
    isPending: mocks.createFolderPending,
  }),
  useUploadFileWithPresignedUrl: () => ({
    mutateAsync: mocks.uploadMutateAsync,
    isPending: mocks.uploadPending,
  }),
  useBatchUpload: () => ({
    mutateAsync: mocks.batchMutateAsync,
    isPending: mocks.batchPending,
  }),
}))

vi.mock('../../../utils/skill-upload-utils', () => ({
  prepareSkillUploadFile: mocks.prepareSkillUploadFile,
}))

vi.mock('../data/use-skill-tree-collaboration', () => ({
  useSkillTreeUpdateEmitter: () => mocks.emitTreeUpdate,
}))

const createStoreApi = () => {
  const startCreateNode = vi.fn<(nodeType: 'file' | 'folder', parentId: string | null) => void>()
  const setUploadStatus = vi.fn<(status: UploadStatus) => void>()
  const setUploadProgress = vi.fn<(progress: UploadProgress) => void>()

  const state = {
    startCreateNode,
    setUploadStatus,
    setUploadProgress,
  } as Pick<SkillEditorSliceShape, 'startCreateNode' | 'setUploadStatus' | 'setUploadProgress'>

  const storeApi = {
    getState: () => state,
  } as unknown as StoreApi<SkillEditorSliceShape>

  return {
    storeApi,
    startCreateNode,
    setUploadStatus,
    setUploadProgress,
  }
}

const createInputChangeEvent = (files: File[] | null) => {
  return {
    target: {
      files,
      value: 'selected',
    },
  } as unknown as React.ChangeEvent<HTMLInputElement>
}

const withRelativePath = (file: File, relativePath: string): File => {
  Object.defineProperty(file, 'webkitRelativePath', {
    value: relativePath,
    configurable: true,
  })
  return file
}

describe('useCreateOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createFolderPending = false
    mocks.uploadPending = false
    mocks.batchPending = false
    mocks.prepareSkillUploadFile.mockImplementation(async file => file)
    mocks.uploadMutateAsync.mockResolvedValue(undefined)
    mocks.batchMutateAsync.mockResolvedValue([])
  })

  // Scenario: loading state should combine all create-related pending flags.
  describe('State', () => {
    it('should expose isCreating false when no mutation is pending', () => {
      const { storeApi } = createStoreApi()

      const { result } = renderHook(() => useCreateOperations({
        parentId: 'folder-1',
        appId: 'app-1',
        storeApi,
        onClose: vi.fn(),
      }))

      expect(result.current.isCreating).toBe(false)
      expect(result.current.fileInputRef.current).toBeNull()
      expect(result.current.folderInputRef.current).toBeNull()
    })

    it('should expose isCreating true when any mutation is pending', () => {
      const { storeApi } = createStoreApi()
      mocks.createFolderPending = true

      const { result } = renderHook(() => useCreateOperations({
        parentId: 'folder-1',
        appId: 'app-1',
        storeApi,
        onClose: vi.fn(),
      }))

      expect(result.current.isCreating).toBe(true)
    })
  })

  // Scenario: new node handlers should initialize create mode and close menu.
  describe('New node handlers', () => {
    it('should start inline file creation when handleNewFile is called', () => {
      const { storeApi, startCreateNode } = createStoreApi()
      const onClose = vi.fn()
      const { result } = renderHook(() => useCreateOperations({
        parentId: 'parent-1',
        appId: 'app-1',
        storeApi,
        onClose,
      }))

      act(() => {
        result.current.handleNewFile()
      })

      expect(startCreateNode).toHaveBeenCalledWith('file', 'parent-1')
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should start inline folder creation when handleNewFolder is called', () => {
      const { storeApi, startCreateNode } = createStoreApi()
      const onClose = vi.fn()
      const { result } = renderHook(() => useCreateOperations({
        parentId: null,
        appId: 'app-1',
        storeApi,
        onClose,
      }))

      act(() => {
        result.current.handleNewFolder()
      })

      expect(startCreateNode).toHaveBeenCalledWith('folder', null)
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  // Scenario: file upload handler should process empty, success, partial-failure, and preparation-failure branches.
  describe('handleFileChange', () => {
    it('should close menu and no-op when no files are selected', async () => {
      const { storeApi, setUploadStatus, setUploadProgress } = createStoreApi()
      const onClose = vi.fn()
      const event = createInputChangeEvent([])
      const { result } = renderHook(() => useCreateOperations({
        parentId: 'parent-empty',
        appId: 'app-empty',
        storeApi,
        onClose,
      }))

      await act(async () => {
        await result.current.handleFileChange(event)
      })

      expect(setUploadStatus).not.toHaveBeenCalled()
      expect(setUploadProgress).not.toHaveBeenCalled()
      expect(mocks.uploadMutateAsync).not.toHaveBeenCalled()
      expect(mocks.emitTreeUpdate).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(event.target.value).toBe('selected')
    })

    it('should upload all files and set success status when all uploads succeed', async () => {
      const { storeApi, setUploadStatus, setUploadProgress } = createStoreApi()
      const onClose = vi.fn()
      const first = new File(['first'], 'first.md', { type: 'text/markdown' })
      const second = new File(['second'], 'second.txt', { type: 'text/plain' })
      const event = createInputChangeEvent([first, second])
      const { result } = renderHook(() => useCreateOperations({
        parentId: 'folder-success',
        appId: 'app-success',
        storeApi,
        onClose,
      }))

      await act(async () => {
        await result.current.handleFileChange(event)
      })

      expect(mocks.prepareSkillUploadFile).toHaveBeenNthCalledWith(1, first)
      expect(mocks.prepareSkillUploadFile).toHaveBeenNthCalledWith(2, second)
      expect(mocks.uploadMutateAsync).toHaveBeenCalledTimes(2)
      expect(mocks.uploadMutateAsync).toHaveBeenNthCalledWith(1, {
        appId: 'app-success',
        file: first,
        parentId: 'folder-success',
      })
      expect(mocks.uploadMutateAsync).toHaveBeenNthCalledWith(2, {
        appId: 'app-success',
        file: second,
        parentId: 'folder-success',
      })

      expect(setUploadStatus).toHaveBeenNthCalledWith(1, 'uploading')
      expect(setUploadStatus).toHaveBeenNthCalledWith(2, 'success')
      expect(setUploadProgress).toHaveBeenCalledWith({ uploaded: 0, total: 2, failed: 0 })
      expect(setUploadProgress).toHaveBeenCalledWith({ uploaded: 1, total: 2, failed: 0 })
      expect(setUploadProgress).toHaveBeenCalledWith({ uploaded: 2, total: 2, failed: 0 })

      expect(mocks.emitTreeUpdate).toHaveBeenCalledTimes(1)
      expect(event.target.value).toBe('')
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should set partial_error when some file uploads fail but still emit updates for uploaded files', async () => {
      const { storeApi, setUploadStatus, setUploadProgress } = createStoreApi()
      const onClose = vi.fn()
      const okFile = new File(['ok'], 'ok.md', { type: 'text/markdown' })
      const failedFile = new File(['nope'], 'nope.md', { type: 'text/markdown' })
      const event = createInputChangeEvent([okFile, failedFile])
      mocks.uploadMutateAsync
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('upload failed'))

      const { result } = renderHook(() => useCreateOperations({
        parentId: 'folder-partial',
        appId: 'app-partial',
        storeApi,
        onClose,
      }))

      await act(async () => {
        await result.current.handleFileChange(event)
      })

      expect(setUploadStatus).toHaveBeenNthCalledWith(1, 'uploading')
      expect(setUploadStatus).toHaveBeenNthCalledWith(2, 'partial_error')
      expect(setUploadProgress).toHaveBeenCalledWith({ uploaded: 1, total: 2, failed: 1 })
      expect(mocks.emitTreeUpdate).toHaveBeenCalledTimes(1)
      expect(event.target.value).toBe('')
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should set partial_error and skip API upload when file preparation fails', async () => {
      const { storeApi, setUploadStatus } = createStoreApi()
      const onClose = vi.fn()
      const file = new File(['broken'], 'broken.md', { type: 'text/markdown' })
      const event = createInputChangeEvent([file])
      mocks.prepareSkillUploadFile.mockRejectedValueOnce(new Error('prepare failed'))

      const { result } = renderHook(() => useCreateOperations({
        parentId: null,
        appId: 'app-prepare-error',
        storeApi,
        onClose,
      }))

      await act(async () => {
        await result.current.handleFileChange(event)
      })

      expect(mocks.uploadMutateAsync).not.toHaveBeenCalled()
      expect(setUploadStatus).toHaveBeenNthCalledWith(1, 'uploading')
      expect(setUploadStatus).toHaveBeenNthCalledWith(2, 'partial_error')
      expect(mocks.emitTreeUpdate).not.toHaveBeenCalled()
      expect(event.target.value).toBe('')
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  // Scenario: folder upload handler should build nested tree payload and handle success/failure branches.
  describe('handleFolderChange', () => {
    it('should close menu and no-op when no folder files are selected', async () => {
      const { storeApi, setUploadStatus, setUploadProgress } = createStoreApi()
      const onClose = vi.fn()
      const event = createInputChangeEvent([])
      const { result } = renderHook(() => useCreateOperations({
        parentId: 'parent-empty-folder',
        appId: 'app-empty-folder',
        storeApi,
        onClose,
      }))

      await act(async () => {
        await result.current.handleFolderChange(event)
      })

      expect(setUploadStatus).not.toHaveBeenCalled()
      expect(setUploadProgress).not.toHaveBeenCalled()
      expect(mocks.batchMutateAsync).not.toHaveBeenCalled()
      expect(mocks.emitTreeUpdate).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(event.target.value).toBe('selected')
    })

    it('should batch upload folder files, update progress callback, and emit success update', async () => {
      const { storeApi, setUploadStatus, setUploadProgress } = createStoreApi()
      const onClose = vi.fn()
      const fileA = withRelativePath(new File(['a'], 'a.md', { type: 'text/markdown' }), 'docs/a.md')
      const fileB = withRelativePath(new File(['b'], 'b.txt', { type: 'text/plain' }), 'docs/nested/b.txt')
      const rootFile = new File(['root'], 'root.md', { type: 'text/markdown' })
      const event = createInputChangeEvent([fileA, fileB, rootFile])

      mocks.batchMutateAsync.mockImplementationOnce(async ({ onProgress }) => {
        onProgress?.(1, 3)
        onProgress?.(3, 3)
        return []
      })

      const { result } = renderHook(() => useCreateOperations({
        parentId: 'folder-parent',
        appId: 'app-folder',
        storeApi,
        onClose,
      }))

      await act(async () => {
        await result.current.handleFolderChange(event)
      })

      expect(mocks.batchMutateAsync).toHaveBeenCalledTimes(1)
      const batchPayload = mocks.batchMutateAsync.mock.calls[0][0]

      expect(batchPayload.appId).toBe('app-folder')
      expect(batchPayload.parentId).toBe('folder-parent')
      expect(batchPayload.tree).toEqual([
        {
          name: 'docs',
          node_type: 'folder',
          children: [
            {
              name: 'a.md',
              node_type: 'file',
              size: fileA.size,
            },
            {
              name: 'nested',
              node_type: 'folder',
              children: [
                {
                  name: 'b.txt',
                  node_type: 'file',
                  size: fileB.size,
                },
              ],
            },
          ],
        },
        {
          name: 'root.md',
          node_type: 'file',
          size: rootFile.size,
        },
      ])
      expect([...batchPayload.files.keys()]).toEqual(['docs/a.md', 'docs/nested/b.txt', 'root.md'])
      expect(batchPayload.files.get('docs/a.md')).toBe(fileA)
      expect(batchPayload.files.get('docs/nested/b.txt')).toBe(fileB)
      expect(batchPayload.files.get('root.md')).toBe(rootFile)

      expect(setUploadStatus).toHaveBeenNthCalledWith(1, 'uploading')
      expect(setUploadStatus).toHaveBeenNthCalledWith(2, 'success')
      expect(setUploadProgress).toHaveBeenCalledWith({ uploaded: 1, total: 3, failed: 0 })
      expect(setUploadProgress).toHaveBeenCalledWith({ uploaded: 3, total: 3, failed: 0 })
      expect(mocks.emitTreeUpdate).toHaveBeenCalledTimes(1)
      expect(event.target.value).toBe('')
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should set partial_error when batch upload fails', async () => {
      const { storeApi, setUploadStatus } = createStoreApi()
      const onClose = vi.fn()
      const file = withRelativePath(new File(['f'], 'f.md', { type: 'text/markdown' }), 'folder/f.md')
      const event = createInputChangeEvent([file])
      mocks.batchMutateAsync.mockRejectedValueOnce(new Error('batch failed'))

      const { result } = renderHook(() => useCreateOperations({
        parentId: null,
        appId: 'app-folder-error',
        storeApi,
        onClose,
      }))

      await act(async () => {
        await result.current.handleFolderChange(event)
      })

      expect(setUploadStatus).toHaveBeenNthCalledWith(1, 'uploading')
      expect(setUploadStatus).toHaveBeenNthCalledWith(2, 'partial_error')
      expect(mocks.emitTreeUpdate).not.toHaveBeenCalled()
      expect(event.target.value).toBe('')
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
