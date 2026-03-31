import type { StoreApi } from 'zustand'
import type { SkillEditorSliceShape, UploadProgress, UploadStatus } from '@/app/components/workflow/store/workflow/skill-editor/types'
import type { AppAssetNode } from '@/types/app-asset'
import { uploadFilesWithStatus } from '../upload-files-with-status'

const mocks = vi.hoisted(() => ({
  prepareSkillUploadFile: vi.fn<(file: File) => Promise<File>>(),
}))

vi.mock('../../../../utils/skill-upload-utils', () => ({
  prepareSkillUploadFile: mocks.prepareSkillUploadFile,
}))

type MockStoreState = {
  uploadStatus: UploadStatus
  uploadProgress: UploadProgress
  setUploadStatus: (status: UploadStatus) => void
  setUploadProgress: (progress: UploadProgress) => void
}

const createStoreApi = () => {
  const state: MockStoreState = {
    uploadStatus: 'idle',
    uploadProgress: { uploaded: 0, total: 0, failed: 0 },
    setUploadStatus: vi.fn((status: UploadStatus) => {
      state.uploadStatus = status
    }),
    setUploadProgress: vi.fn((progress: UploadProgress) => {
      state.uploadProgress = progress
    }),
  }

  return {
    state,
    storeApi: {
      getState: () => state,
    } as unknown as StoreApi<SkillEditorSliceShape>,
  }
}

const createNode = (id: string, name: string): AppAssetNode => ({
  id,
  name,
  node_type: 'file',
  parent_id: null,
  order: 0,
  size: 1,
  extension: name.split('.').pop() || '',
})

describe('uploadFilesWithStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('success flow', () => {
    it('should write uploading and success states when all files upload successfully', async () => {
      const { state, storeApi } = createStoreApi()
      const files = [
        new File(['a'], 'guide.md', { type: 'text/markdown' }),
        new File(['b'], 'notes.md', { type: 'text/markdown' }),
      ]
      const uploadFile = vi.fn(async ({ file }: { file: File }) => createNode(file.name, file.name))
      mocks.prepareSkillUploadFile.mockImplementation(async file => file)

      const result = await uploadFilesWithStatus({
        files,
        appId: 'app-id',
        parentId: 'folder-id',
        storeApi,
        uploadFile,
      })

      expect(result.status).toBe('success')
      expect(result.uploaded).toBe(2)
      expect(result.failed).toBe(0)
      expect(result.uploadedNodes).toHaveLength(2)
      expect(state.uploadStatus).toBe('success')
      expect(state.uploadProgress).toEqual({ uploaded: 2, total: 2, failed: 0 })
      expect(state.setUploadStatus).toHaveBeenNthCalledWith(1, 'uploading')
      expect(state.setUploadStatus).toHaveBeenLastCalledWith('success')
    })
  })

  describe('partial failure flow', () => {
    it('should keep progress and mark partial_error when preparation or upload fails', async () => {
      const { state, storeApi } = createStoreApi()
      const files = [
        new File(['ok'], 'ok.md', { type: 'text/markdown' }),
        new File(['bad-prepare'], 'prepare-fail.md', { type: 'text/markdown' }),
        new File(['bad-upload'], 'upload-fail.md', { type: 'text/markdown' }),
      ]
      const uploadFile = vi.fn(async ({ file }: { file: File }) => {
        if (file.name === 'upload-fail.md')
          throw new Error('upload failed')
        return createNode(file.name, file.name)
      })
      mocks.prepareSkillUploadFile.mockImplementation(async (file) => {
        if (file.name === 'prepare-fail.md')
          throw new Error('prepare failed')
        return file
      })

      const result = await uploadFilesWithStatus({
        files,
        appId: 'app-id',
        parentId: null,
        storeApi,
        uploadFile,
      })

      expect(result.status).toBe('partial_error')
      expect(result.uploaded).toBe(1)
      expect(result.failed).toBe(2)
      expect(result.uploadedNodes).toEqual([createNode('ok.md', 'ok.md')])
      expect(state.uploadStatus).toBe('partial_error')
      expect(state.uploadProgress).toEqual({ uploaded: 1, total: 3, failed: 2 })
      expect(state.setUploadStatus).toHaveBeenNthCalledWith(1, 'uploading')
      expect(state.setUploadStatus).toHaveBeenLastCalledWith('partial_error')
    })
  })
})
