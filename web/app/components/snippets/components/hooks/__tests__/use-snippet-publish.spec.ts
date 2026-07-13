import { toast } from '@langgenius/dify-ui/toast'
import { act, renderHook } from '@testing-library/react'
import { useSnippetPublish } from '../use-snippet-publish'

const mockMutateAsync = vi.fn()
const mockSetPublishedAt = vi.fn()
const mockSetQueryData = vi.fn()
const mockResetWorkflowVersionHistory = vi.fn()
const mockHandleCheckBeforePublish = vi.fn<() => Promise<boolean>>()

let isPending = false

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    setQueryData: mockSetQueryData,
  }),
}))

vi.mock('@/service/use-workflow', () => ({
  useResetWorkflowVersionHistory: () => mockResetWorkflowVersionHistory,
}))

vi.mock('@/service/use-snippet-workflows', () => ({
  usePublishSnippetWorkflowMutation: () => ({
    mutateAsync: mockMutateAsync,
    isPending,
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      setPublishedAt: mockSetPublishedAt,
    }),
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-checklist', () => ({
  useChecklistBeforePublish: () => ({
    handleCheckBeforePublish: mockHandleCheckBeforePublish,
  }),
}))

describe('useSnippetPublish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isPending = false
    mockHandleCheckBeforePublish.mockResolvedValue(true)
    mockMutateAsync.mockResolvedValue({ created_at: 1_712_345_678 })
  })

  describe('Publish action', () => {
    it('should publish the snippet and show success feedback', async () => {
      const { result } = renderHook(() =>
        useSnippetPublish({
          snippetId: 'snippet-1',
        }),
      )

      await act(async () => {
        await result.current.handlePublish()
      })

      expect(mockHandleCheckBeforePublish).toHaveBeenCalledTimes(1)
      expect(mockMutateAsync).toHaveBeenCalledWith({
        params: { snippetId: 'snippet-1' },
      })
      expect(mockSetQueryData).toHaveBeenCalledTimes(1)
      const setQueryDataCall = mockSetQueryData.mock.calls[0]
      expect(setQueryDataCall).toBeDefined()
      const updateSnippetDetail = setQueryDataCall![1] as (old: { is_published: boolean }) => {
        is_published: boolean
      }
      expect(updateSnippetDetail({ is_published: false })).toEqual({ is_published: true })
      expect(mockSetPublishedAt).toHaveBeenCalledWith(1_712_345_678)
      expect(mockResetWorkflowVersionHistory).toHaveBeenCalledTimes(1)
      expect(toast.success).toHaveBeenCalledWith('snippet.publishSuccess')
    })

    it('should not publish the snippet when checklist validation fails', async () => {
      mockHandleCheckBeforePublish.mockResolvedValue(false)

      const { result } = renderHook(() =>
        useSnippetPublish({
          snippetId: 'snippet-1',
        }),
      )

      await act(async () => {
        await result.current.handlePublish()
      })

      expect(mockHandleCheckBeforePublish).toHaveBeenCalledTimes(1)
      expect(mockMutateAsync).not.toHaveBeenCalled()
      expect(mockSetQueryData).not.toHaveBeenCalled()
      expect(mockSetPublishedAt).not.toHaveBeenCalled()
      expect(mockResetWorkflowVersionHistory).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('should surface publish errors through toast feedback', async () => {
      mockMutateAsync.mockRejectedValue(new Error('publish failed'))

      const { result } = renderHook(() =>
        useSnippetPublish({
          snippetId: 'snippet-1',
        }),
      )

      await act(async () => {
        await result.current.handlePublish()
      })

      expect(toast.error).toHaveBeenCalledWith('publish failed')
    })
  })

  it('should expose publishing pending state', () => {
    isPending = true

    const { result } = renderHook(() =>
      useSnippetPublish({
        snippetId: 'snippet-1',
      }),
    )

    expect(result.current.isPublishing).toBe(true)
  })
})
