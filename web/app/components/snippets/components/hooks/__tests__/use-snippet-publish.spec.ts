import { act, waitFor } from '@testing-library/react'
import { renderWorkflowHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { useSnippetPublish } from '../use-snippet-publish'

const mockMutateAsync = vi.fn()

const mockResetWorkflowVersionHistory = vi.fn()
const mockHandleCheckBeforePublish = vi.fn<() => Promise<boolean>>()

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/service/use-workflow', () => ({
  useResetWorkflowVersionHistory: () => mockResetWorkflowVersionHistory,
}))

vi.mock('@/app/components/workflow/hooks/use-checklist', () => ({
  useChecklistBeforePublish: () => ({
    handleCheckBeforePublish: mockHandleCheckBeforePublish,
  }),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'snippets.bySnippetId.workflows.publish.post': (...args: unknown[]) =>
        mockMutateAsync(...args),
    }),
  }
})

const renderPublish = () => {
  const queryClient = createConsoleQueryClient()
  return {
    ...renderWorkflowHook(() => useSnippetPublish({ snippetId: 'snippet-1' }), {
      queryClient,
      resource: { kind: 'snippet', snippetId: 'snippet-1' },
    }),
    queryClient,
  }
}

describe('useSnippetPublish', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockHandleCheckBeforePublish.mockResolvedValue(true)
    mockMutateAsync.mockResolvedValue({ created_at: 1_712_345_678 })
  })

  describe('Publish action', () => {
    it('should publish the snippet and show success feedback', async () => {
      const request = createDeferred<{ created_at: number }>()
      mockMutateAsync.mockReturnValueOnce(request.promise)
      const { result, queryClient, store } = renderPublish()

      const detailKey = consoleQuery.workspaces.current.customizedSnippets.bySnippetId.get.queryKey(
        { input: { params: { snippet_id: 'snippet-1' } } },
      )
      queryClient.setQueryData(detailKey, {
        id: 'snippet-1',
        name: 'Snippet',
        description: '',
        type: 'node',
        version: 1,
        use_count: 0,
        tags: [],
        graph: {},
        input_fields: [],
        icon_info: null,
        created_at: 0,
        updated_at: 0,
        created_by: null,
        updated_by: null,
        is_published: false,
      })

      let publishing!: ReturnType<typeof result.current.handlePublish>
      act(() => {
        publishing = result.current.handlePublish()
      })
      await waitFor(() => expect(result.current.isPublishing).toBe(true))
      expect(queryClient.getQueryData(detailKey)).toMatchObject({ is_published: false })
      expect(store.getState().publishedAt).toBe(0)
      expect(toast.success).not.toHaveBeenCalled()
      await act(async () => {
        request.resolve({ created_at: 1_712_345_678 })
        await expect(publishing).resolves.toBe(true)
      })
      await waitFor(() => expect(result.current.isPublishing).toBe(false))

      expect(mockHandleCheckBeforePublish).toHaveBeenCalledTimes(1)
      expect(mockMutateAsync).toHaveBeenCalledWith({
        params: { snippet_id: 'snippet-1' },
        body: {},
      })
      expect(queryClient.getQueryData(detailKey)).toMatchObject({ is_published: true })
      expect(store.getState().publishedAt).toBe(1_712_345_678_000)
      expect(mockResetWorkflowVersionHistory).toHaveBeenCalledTimes(1)
      expect(toast.success).toHaveBeenCalledWith('snippet.publishSuccess')
    })

    it('should not publish the snippet when checklist validation fails', async () => {
      mockHandleCheckBeforePublish.mockResolvedValue(false)

      const { result, store } = renderPublish()

      await act(async () => {
        await result.current.handlePublish()
      })

      expect(mockHandleCheckBeforePublish).toHaveBeenCalledTimes(1)
      expect(mockMutateAsync).not.toHaveBeenCalled()
      expect(store.getState().publishedAt).toBe(0)
      expect(mockResetWorkflowVersionHistory).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('should surface publish errors through toast feedback', async () => {
      mockMutateAsync.mockRejectedValue(new Error('publish failed'))

      const { result, store } = renderPublish()

      await act(async () => {
        await result.current.handlePublish()
      })

      expect(toast.error).toHaveBeenCalledWith('publish failed')
      expect(store.getState().publishedAt).toBe(0)
      expect(mockResetWorkflowVersionHistory).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
    })
  })
})
