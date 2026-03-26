import { act, renderHook } from '@testing-library/react'
import { useCreateSnippet } from '../use-create-snippet'

const mockPush = vi.fn()
const mockMutateAsync = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
const mockSyncDraftWorkflow = vi.fn()

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
      syncDraftWorkflow: (...args: unknown[]) => mockSyncDraftWorkflow(...args),
    },
  },
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

describe('useCreateSnippet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    it('should create snippet, sync draft workflow, and navigate on success', async () => {
      mockMutateAsync.mockResolvedValue({ id: 'snippet-123' })
      mockSyncDraftWorkflow.mockResolvedValue(undefined)

      const { result } = renderHook(() => useCreateSnippet())

      act(() => {
        result.current.handleOpenCreateSnippetDialog()
      })

      await act(async () => {
        await result.current.handleCreateSnippet({
          name: 'My snippet',
          description: 'desc',
          icon: {
            type: 'emoji',
            icon: '🤖',
            background: '#FFEAD5',
          },
          graph: {
            nodes: [],
            edges: [],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
        })
      })

      expect(mockMutateAsync).toHaveBeenCalledWith({
        body: {
          name: 'My snippet',
          description: 'desc',
          icon_info: {
            icon: '🤖',
            icon_type: 'emoji',
            icon_background: '#FFEAD5',
            icon_url: undefined,
          },
        },
      })
      expect(mockSyncDraftWorkflow).toHaveBeenCalledWith({
        params: { snippetId: 'snippet-123' },
        body: {
          graph: {
            nodes: [],
            edges: [],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
        },
      })
      expect(mockToastSuccess).toHaveBeenCalledWith('workflow.snippet.createSuccess')
      expect(mockPush).toHaveBeenCalledWith('/snippets/snippet-123/orchestrate')
      expect(result.current.isCreateSnippetDialogOpen).toBe(false)
      expect(result.current.isCreatingSnippet).toBe(false)
    })

    it('should show error toast when create fails', async () => {
      mockMutateAsync.mockRejectedValue(new Error('create failed'))

      const { result } = renderHook(() => useCreateSnippet())

      await act(async () => {
        await result.current.handleCreateSnippet({
          name: 'My snippet',
          description: '',
          icon: {
            type: 'emoji',
            icon: '🤖',
            background: '#FFEAD5',
          },
          graph: {
            nodes: [],
            edges: [],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
        })
      })

      expect(mockToastError).toHaveBeenCalledWith('create failed')
      expect(result.current.isCreatingSnippet).toBe(false)
    })
  })
})
