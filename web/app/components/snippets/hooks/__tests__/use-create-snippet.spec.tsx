import { act, renderHook } from '@testing-library/react'
import { PipelineInputVarType } from '@/models/pipeline'
import { useCreateSnippet } from '../use-create-snippet'

const {
  mockMutateAsync,
  mockPush,
  mockSyncDraftWorkflow,
  mockToastError,
  mockToastSuccess,
  mockWorkspacePermissionKeys,
} = vi.hoisted(() => ({
  mockMutateAsync: vi.fn(),
  mockPush: vi.fn(),
  mockSyncDraftWorkflow: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockWorkspacePermissionKeys: vi.fn(() => ['snippets.create_and_modify']),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/service/use-snippets', () => ({
  useCreateSnippetMutation: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    snippets: {
      bySnippetId: {
        workflows: {
          draft: {
            post: mockSyncDraftWorkflow,
          },
        },
      },
    },
  },
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys(),
  }),
  useSelector: <T,>(selector: (state: { workspacePermissionKeys: string[] }) => T): T => selector({
    workspacePermissionKeys: mockWorkspacePermissionKeys(),
  }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

describe('useCreateSnippet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspacePermissionKeys.mockReturnValue(['snippets.create_and_modify'])
  })

  describe('State', () => {
    it('should open and close create snippet dialog', () => {
      const { result } = renderHook(() => useCreateSnippet())

      act(() => {
        result.current.handleOpenCreateSnippetDialog()
      })
      expect(result.current.isCreateSnippetDialogOpen).toBe(true)

      act(() => {
        result.current.handleCloseCreateSnippetDialog()
      })
      expect(result.current.isCreateSnippetDialogOpen).toBe(false)
    })
  })

  describe('Create Flow', () => {
    it('should create snippet with graph and navigate on success', async () => {
      mockMutateAsync.mockResolvedValue({ id: 'snippet-123' })
      mockSyncDraftWorkflow.mockResolvedValue({ result: 'success', hash: 'draft-hash', updated_at: 1704067200 })
      const graph = {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }

      const { result } = renderHook(() => useCreateSnippet())

      act(() => {
        result.current.handleOpenCreateSnippetDialog()
      })

      await act(async () => {
        await result.current.handleCreateSnippet({
          name: 'My snippet',
          description: 'desc',
          input_fields: [
            {
              label: 'topic',
              variable: 'topic',
              type: PipelineInputVarType.textInput,
              required: true,
            },
          ],
          graph,
        })
      })

      expect(mockMutateAsync).toHaveBeenCalledWith({
        body: {
          name: 'My snippet',
          description: 'desc',
          graph,
          input_fields: [
            {
              label: 'topic',
              variable: 'topic',
              type: PipelineInputVarType.textInput,
              required: true,
            },
          ],
        },
      })
      expect(mockSyncDraftWorkflow).toHaveBeenCalledWith({
        params: { snippet_id: 'snippet-123' },
        body: {
          graph,
          input_fields: [
            {
              label: 'topic',
              variable: 'topic',
              type: PipelineInputVarType.textInput,
              required: true,
            },
          ],
        },
      })
      expect(mockToastSuccess).toHaveBeenCalledWith('workflow.snippet.createSuccess')
      expect(mockPush).toHaveBeenCalledWith('/snippets/snippet-123/orchestrate')
      expect(result.current.isCreateSnippetDialogOpen).toBe(false)
      expect(result.current.isCreatingSnippet).toBe(false)
    })

    it('should rely on API error handling when create fails', async () => {
      mockMutateAsync.mockRejectedValue(new Error('create failed'))

      const { result } = renderHook(() => useCreateSnippet())

      await act(async () => {
        await result.current.handleCreateSnippet({
          name: 'My snippet',
          description: '',
          input_fields: [],
          graph: {
            nodes: [],
            edges: [],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
        })
      })

      expect(mockToastError).not.toHaveBeenCalled()
      expect(result.current.isCreatingSnippet).toBe(false)
    })
  })
})
