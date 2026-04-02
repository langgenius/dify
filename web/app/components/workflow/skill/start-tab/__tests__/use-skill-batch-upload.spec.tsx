import type { App, AppSSO } from '@/types/app'
import { act, renderHook } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useSkillBatchUpload } from '../use-skill-batch-upload'

type MockWorkflowState = {
  setUploadStatus: ReturnType<typeof vi.fn>
  setUploadProgress: ReturnType<typeof vi.fn>
  openTab: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  emitTreeUpdate: vi.fn(),
  workflowState: {
    setUploadStatus: vi.fn(),
    setUploadProgress: vi.fn(),
    openTab: vi.fn(),
  } as MockWorkflowState,
}))

vi.mock('@/service/use-app-asset', () => ({
  useBatchUpload: () => ({
    mutateAsync: mocks.mutateAsync,
  }),
}))

vi.mock('../../hooks/file-tree/data/use-skill-tree-collaboration', () => ({
  useSkillTreeUpdateEmitter: () => mocks.emitTreeUpdate,
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => mocks.workflowState,
  }),
}))

describe('useSkillBatchUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mutateAsync.mockResolvedValue([])
    useAppStore.setState({
      appDetail: { id: 'app-1' } as App & Partial<AppSSO>,
    })
  })

  describe('Upload State', () => {
    it('should mark upload as in progress with the provided total', () => {
      const { result } = renderHook(() => useSkillBatchUpload())

      act(() => {
        result.current.startUpload(3)
      })

      expect(mocks.workflowState.setUploadStatus).toHaveBeenCalledWith('uploading')
      expect(mocks.workflowState.setUploadProgress).toHaveBeenCalledWith({ uploaded: 0, total: 3, failed: 0 })
    })

    it('should clamp negative totals to zero when starting an upload', () => {
      const { result } = renderHook(() => useSkillBatchUpload())

      act(() => {
        result.current.startUpload(-2)
      })

      expect(mocks.workflowState.setUploadProgress).toHaveBeenCalledWith({ uploaded: 0, total: 0, failed: 0 })
    })

    it('should update upload progress through the shared helper', () => {
      const { result } = renderHook(() => useSkillBatchUpload())

      act(() => {
        result.current.setUploadProgress(2, 5)
      })

      expect(mocks.workflowState.setUploadProgress).toHaveBeenCalledWith({ uploaded: 2, total: 5, failed: 0 })
    })

    it('should mark the upload as failed through the shared helper', () => {
      const { result } = renderHook(() => useSkillBatchUpload())

      act(() => {
        result.current.failUpload()
      })

      expect(mocks.workflowState.setUploadStatus).toHaveBeenCalledWith('partial_error')
    })
  })

  describe('Tree Upload', () => {
    it('should upload the tree and broadcast success when the batch upload succeeds', async () => {
      mocks.mutateAsync.mockResolvedValueOnce([
        { id: 'folder-id', name: 'alpha', node_type: 'folder', size: 0, children: [] },
      ])
      const { result } = renderHook(() => useSkillBatchUpload())
      const files = new Map([['alpha/SKILL.md', new File(['content'], 'SKILL.md')]])
      const tree = [{ name: 'alpha', node_type: 'folder' as const, children: [] }]

      let uploadedNodes: unknown
      await act(async () => {
        uploadedNodes = await result.current.uploadTree({ tree, files })
      })

      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        appId: 'app-1',
        tree,
        files,
        parentId: null,
        onProgress: expect.any(Function),
      })
      expect(mocks.workflowState.setUploadStatus).toHaveBeenCalledWith('success')
      expect(mocks.emitTreeUpdate).toHaveBeenCalledTimes(1)
      expect(uploadedNodes).toEqual([
        { id: 'folder-id', name: 'alpha', node_type: 'folder', size: 0, children: [] },
      ])
    })

    it('should skip the upload mutation when app id is missing', async () => {
      useAppStore.setState({ appDetail: undefined })
      const { result } = renderHook(() => useSkillBatchUpload())
      const files = new Map([['alpha/SKILL.md', new File(['content'], 'SKILL.md')]])

      let uploadedNodes: unknown
      await act(async () => {
        uploadedNodes = await result.current.uploadTree({
          tree: [{ name: 'alpha', node_type: 'folder', children: [] }],
          files,
        })
      })

      expect(mocks.mutateAsync).not.toHaveBeenCalled()
      expect(mocks.workflowState.setUploadStatus).not.toHaveBeenCalledWith('success')
      expect(uploadedNodes).toEqual([])
    })
  })

  describe('Skill Document Opening', () => {
    it('should open the first nested SKILL.md file when present', () => {
      const { result } = renderHook(() => useSkillBatchUpload())

      let openedId: string | null = null
      act(() => {
        openedId = result.current.openCreatedSkillDocument([
          {
            id: 'folder-id',
            name: 'alpha',
            node_type: 'folder',
            size: 0,
            children: [
              {
                id: 'skill-md-id',
                name: 'SKILL.md',
                node_type: 'file',
                size: 12,
                children: [],
              },
            ],
          },
        ])
      })

      expect(mocks.workflowState.openTab).toHaveBeenCalledWith('skill-md-id', { pinned: true })
      expect(openedId).toBe('skill-md-id')
    })

    it('should return null when no skill document exists in the created nodes', () => {
      const { result } = renderHook(() => useSkillBatchUpload())

      let openedId: string | null = 'placeholder'
      act(() => {
        openedId = result.current.openCreatedSkillDocument([
          {
            id: 'folder-id',
            name: 'alpha',
            node_type: 'folder',
            size: 0,
            children: [],
          },
        ])
      })

      expect(mocks.workflowState.openTab).not.toHaveBeenCalled()
      expect(openedId).toBeNull()
    })
  })
})
